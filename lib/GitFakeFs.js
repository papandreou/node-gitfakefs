var Path = require('path'),
    nodeGit = require('nodegit'),
    passError = require('passerror'),
    memoizeAsync = require('memoizeasync'),
    createError = require('createerror'),
    FakeStats = require('./FakeStats'),
    fakeFsErrors = require('./fakeFsErrors');

function FakeTree(entries) {
    this._entries = entries;
}

FakeTree.prototype.entries = function () {
    return this._entries;
};

function isTree(obj) {
    return obj instanceof nodeGit.Tree || obj instanceof FakeTree;
}

function normalizePath(path) {
    // Normalize: Add leading slash and remove trailing slash:
    if (path[0] !== '/') {
        path = '/' + path;
    }
    if (path.length > 1) {
        path = path.replace(/\/$/, '');
    }
    return path;
}

function getFileMode(treeEntryOrIndexEntry) {
    if (treeEntryOrIndexEntry.mode) {
        return treeEntryOrIndexEntry.mode();
    } else {
        return treeEntryOrIndexEntry.filemode();
    }
}

// Cannot use a regular constructor because the fs functions cannot assume
// the 'context' to be set correctly. People do things like this all the time:
// var stat = require('fs').stat;
var GitFakeFs = module.exports = function GitFakeFs(repositoryOrPath, config) {
    var that = this;

    // Don't require the new operator:
    if (!(that instanceof GitFakeFs)) {
        return new GitFakeFs(repositoryOrPath, config);
    }

    config = config || {};
    if (typeof repositoryOrPath !== 'string' && !(repositoryOrPath && typeof repositoryOrPath === 'object')) {
        throw new Error('GitFakeFs: The repository or the path to the repository must be provided as the first parameter');
    }

    that.getRepo = memoizeAsync(function (cb) {
        if (typeof repositoryOrPath === 'string') {
            nodeGit.Repo.open(repositoryOrPath, cb);
        } else {
            process.nextTick(function () {
                cb(null, repositoryOrPath);
            });
        }
    });

    that.toString = function () {
        return '[GitFakeFs ' + (typeof repositoryOrPath === 'string' ? repositoryOrPath : repositoryOrPath.path()).replace(/\/$/, '') + (config.ref ? '@' + config.ref : '') + ']';
    };

    var getIndexEntriesByDirName = memoizeAsync(function (cb) {
        that.getRepo(passError(cb, function (repo) {
            repo.openIndex(passError(cb, function (index) {
                var indexEntriesByDirName = {'/' : []};
                index.entries().forEach(function (indexEntry) {
                    if (indexEntry.mode() !== 0xe000) { // Ignore submodules
                        var path = '/' + indexEntry.path(),
                            dirName = Path.dirname(path);
                        (indexEntriesByDirName[dirName] = indexEntriesByDirName[dirName] || []).push(indexEntry);
                    }
                });
                cb(null, indexEntriesByDirName);
            }));
        }));
    });

    // Look for a branch first, then a tag, then a commit:
    that.getRootTree = memoizeAsync(function (cb) {
        that.getRepo(passError(cb, function (repo) {
            var treeish = config.ref || 'master';
            repo.getBranch(treeish, function (err, branch) {
                if (err) {
                    if (/Reference .* not found/.test(err.message)) {
                        repo.getReference('refs/tags/' + treeish, function (err, reference) {
                            if (err) {
                                if (/The given reference name .*? is not valid|Reference .*? not found/.test(err.message)) {
                                    repo.getCommit(treeish, function (err, commit) {
                                        if (err) {
                                            return cb(err);
                                        }
                                        commit.getTree(function (err, tree) {
                                            cb(err, tree);
                                        });
                                    });
                                } else {
                                    cb(err);
                                }
                            } else if (reference.isConcrete()) {
                                repo.getCommit(reference.target(), passError(cb, function (commit) {
                                    commit.getTree(cb);
                                }));
                            } else {
                                cb(new Error('Only concrete references are implemented'));
                            }
                        });
                    } else {
                        cb(err);
                    }
                } else {
                    branch.getTree(cb);
                }
            });
        }));
    });

    that.getTreeOrBlob = memoizeAsync(function (path, dereferenceSymbolicLink, cb) {
        if (typeof deferenceSymbolicLink === 'function') {
            cb = dereferenceSymbolicLink;
            dereferenceSymbolicLink = true;
        }
        path = normalizePath(path);
        var fragments = path.replace(/\/$/, '').split('/').slice(1),
            lastFragment = fragments.pop();
        var seenSymbolicLinks = [];
        if (config.index) {
            getIndexEntriesByDirName(passError(cb, function (indexEntriesByDirName) {
                var indexEntries = indexEntriesByDirName[path];
                if (indexEntries) {
                    cb(null, new FakeTree(indexEntries));
                } else {
                    // No directory of that name found. Look for a file in the parent directory.
                    var parentDirName = Path.dirname(path),
                        entryName = Path.basename(path),
                        parentIndexEntries = indexEntriesByDirName[parentDirName];
                    if (parentIndexEntries) {
                        for (var i = 0 ; i < parentIndexEntries.length ; i += 1) {
                            var parentIndexEntry = parentIndexEntries[i];
                            if (Path.basename(parentIndexEntry.path()) === entryName) {
                                var oid = parentIndexEntry.oid();
                                that.getRepo(passError(cb, function (repo) {
                                    repo.getBlob(oid, passError(cb, function (blob) {
                                        if (getFileMode(parentIndexEntry) === 0120000 && dereferenceSymbolicLink) {
                                            var symbolicLinkTarget = normalizePath(Path.resolve('/' + fragments.join('/'), blob.content().toString('utf-8')));
                                            if (symbolicLinkTarget === path || (seenSymbolicLinks && (seenSymbolicLinks.indexOf(symbolicLinkTarget) !== -1 || seenSymbolicLinks.length > 40))) {
                                                return cb(new fakeFsErrors.Eloop(that.toString() + ' Error: ELOOP, too many symbolic links encountered' + " '" + path + "'"));
                                            }
                                            that.getTreeOrBlob(symbolicLinkTarget, true, passError(cb, function (treeOrBlob, symbolicLinkEntry, symbolicLinkSeenSymbolicLinks) {
                                                cb(null, treeOrBlob, symbolicLinkEntry, (seenSymbolicLinks || []).concat(symbolicLinkTarget));
                                            }));
                                        } else {
                                            cb(null, blob, parentIndexEntry, seenSymbolicLinks);
                                        }
                                    }));
                                }));
                                return;
                            }
                        }
                    }
                    cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + path + "'"));
                }
            }));
        } else if (path === '/') {
            that.getRootTree(cb);
        } else {
            that.getTreeOrBlob('/' + fragments.join('/'), true, passError(cb, function (parentTree, parentParentEntry, seenSymbolicLinks) {
                if (!isTree(parentTree)) {
                    return cb(new fakeFsErrors.Enotdir("ENOTDIR, not a directory '" + path + "'"));
                }
                var parentEntries = parentTree.entries();
                for (var i = 0 ; i < parentEntries.length ; i += 1) {
                    var parentEntry = parentEntries[i];
                    if (parentEntry.name() === lastFragment) {
                        if (parentEntry.isBlob() || !parentEntry.isTree()) {
                            if (getFileMode(parentEntry) === 0xe000) { // Ignore submodules
                                cb(new fakeFsErrors.Enoent(that.toString() + " Error: ENOENT, no such file or directory '" + path + "'"));
                            } else {
                                parentEntry.getBlob(passError(cb, function (blob) {
                                    if (getFileMode(parentEntry) === 0120000 && dereferenceSymbolicLink) {
                                        var symbolicLinkTarget = normalizePath(Path.resolve('/' + fragments.join('/'), blob.content().toString('utf-8')));
                                        if (symbolicLinkTarget === path || (seenSymbolicLinks && (seenSymbolicLinks.indexOf(symbolicLinkTarget) !== -1 || seenSymbolicLinks.length > 40))) {
                                            return cb(new fakeFsErrors.Eloop(that.toString() + ' Error: ELOOP, too many symbolic links encountered' + " '" + path + "'"));
                                        }
                                        that.getTreeOrBlob(symbolicLinkTarget, true, passError(cb, function (treeOrBlob, symbolicLinkEntry, symbolicLinkSeenSymbolicLinks) {
                                            cb(null, treeOrBlob, symbolicLinkEntry, (seenSymbolicLinks || []).concat(symbolicLinkTarget));
                                        }));
                                    } else {
                                        cb(null, blob, parentEntry, seenSymbolicLinks);
                                    }
                                }));
                            }
                        } else if (parentEntry.isTree()) {
                            parentEntry.getTree(passError(cb, function (tree) {
                                cb(null, tree, parentEntry, seenSymbolicLinks);
                            }));
                        } else {
                            cb(new Error(that.toString() + ' Internal error, object is neither blob nor tree: ' + parentEntry));
                        }
                        return;
                    }
                }
                return cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + path + "'"));
            }));
        }
    });

    that.readFile = function (fileName, encoding, cb) {
        if (arguments.length === 2 && typeof encoding === 'function') {
            cb = encoding;
            encoding = null;
        }
        that.getTreeOrBlob(fileName, true, passError(cb, function (blob) {
            if (blob instanceof nodeGit.Blob) {
                var gitFakeFs = blob.content();
                if (encoding) {
                    return cb(null, gitFakeFs.toString(encoding));
                } else {
                    return cb(null, gitFakeFs);
                }
            } else {
                return cb(new Error(that.toString() + ' ' + fileName + ' is not a file'));
            }
        }));
    };

    that.readdir = function (dirName, cb) {
        that.getTreeOrBlob(dirName, true, passError(cb, function (tree) {
            if (!isTree(tree)) {
                return cb(new fakeFsErrors.Enotdir("ENOTDIR, not a directory '" + dirName + "'"));
            }
            var names = [];
            tree.entries().forEach(function (entry) {
                if (getFileMode(entry) !== 0xe000) { // Ignore submodules
                    names.push(Path.basename(entry.path()));
                }
            });
            return cb(null, names);
        }));
    };

    ['stat', 'lstat'].forEach(function (methodName) {
        that[methodName] = function (fileOrDirName, cb) {
            that.getTreeOrBlob(fileOrDirName, methodName === 'stat', passError(cb, function (treeOrBlob, treeEntry) {
                var filemode = treeEntry && getFileMode(treeEntry),
                    isFile = filemode !== 0120000 && treeOrBlob instanceof nodeGit.Blob;
                cb(null, new FakeStats({
                    mode: filemode,
                    size: isFile && treeOrBlob.content().length,
                    isDirectory: isTree(treeOrBlob),
                    isFile: isFile,
                    isSymbolicLink: filemode === 0120000
                }));
            }));
        };
    });
};
