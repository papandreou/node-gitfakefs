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
        return '[GitFakeFs ' + (typeof repositoryOrPath === 'string' ? repositoryOrPath : repositoryOrPath.path()) + ']';
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
                        repo.getTag(treeish, function (err, tag) {
                            if (err) {
                                if (/The requested type does not match the type in the ODB/.test(err.message)) {
                                    repo.getCommit(treeish, passError(cb, function (commit) {
                                        commit.getTree(cb);
                                    }));

                                } else {
                                    cb(err);
                                }
                            } else {
                                tag.getTree(cb);
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

    that.getTreeOrBlob = memoizeAsync(function (path, cb) {
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
                                        cb(null, blob, parentIndexEntry);
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
            var fragments = path.replace(/\/$/, '').split('/'),
                lastFragment = fragments.pop();
            that.getTreeOrBlob(fragments.join('/') + '/', passError(cb, function (parentTree) {
                if (!(parentTree instanceof nodeGit.Tree || parentTree instanceof nodeGit.Index)) {
                    return cb(new Error(that.toString() + ' Error: ' + lastFragment + ' is not a directory'));
                }
                var parentEntries = parentTree.entries();
                for (var i = 0 ; i < parentEntries.length ; i += 1) {
                    var parentEntry = parentEntries[i];
                    if (parentEntry.name() === lastFragment) {
                        if (parentEntry.isBlob() || !parentEntry.isTree()) {
                            if (parentEntry.filemode() === 0xe000) { // Ignore submodules
                                cb(new fakeFsErrors.Enoent(that.toString() + " Error: ENOENT, no such file or directory '" + path + "'"));
                            } else {
                                parentEntry.getBlob(passError(cb, function (blob) {
                                    cb(null, blob, parentEntry);
                                }));
                            }
                        } else if (parentEntry.isTree()) {
                            parentEntry.getTree(passError(cb, function (tree) {
                                cb(null, tree, parentEntry);
                            }));
                        } else {
                            cb(new Error(that.toString() + ' Internal error, object is neither blob nor tree: ' + parentEntry));
                        }
                        return;
                    }
                }
                return cb(new Error(that.toString() + ' ' + lastFragment + ' not found'));
            }));
        }
    });

    that.readFile = function (fileName, encoding, cb) {
        if (arguments.length === 2 && typeof encoding === 'function') {
            cb = encoding;
            encoding = null;
        }
        that.getTreeOrBlob(fileName, passError(cb, function (blob) {
            if (blob instanceof nodeGit.Blob) {
                var contents = blob.content();
                if (encoding) {
                    return cb(null, contents.toString(encoding));
                } else {
                    return cb(null, contents);
                }
            } else {
                return cb(new Error(that.toString() + ' ' + dirName + ' is not a file'));
            }
        }));
    };

    that.readdir = function (dirName, cb) {
        that.getTreeOrBlob(dirName, passError(cb, function (tree) {
            if (!(tree instanceof nodeGit.Tree) && !(tree instanceof FakeTree)) {
                return cb(new Error(that.toString() + ' ' + dirName + ' is not a directory'));
            }
            var names = [];
            tree.entries().forEach(function (entry) {
                var filemode = entry.filemode ? entry.filemode() : entry.mode(); // FIXME: Rename indexEntry.mode => filemode
                if (filemode !== 0xe000) { // Ignore submodules
                    names.push(entry.path());
                }
            });
            return cb(null, names);
        }));
    };

    that.lstat = function (fileOrDirName, cb) {
        that.getTreeOrBlob(fileOrDirName, passError(cb, function (treeOrBlob, treeEntry) {
            var filemode = treeEntry.filemode(),
                isFile = filemode !== 0120000 && treeOrBlob instanceof nodeGit.Blob;
            cb(null, new FakeStats({
                mode: filemode,
                size: isFile && treeOrBlob.content().length,
                isDirectory: treeOrBlob instanceof nodeGit.Tree,
                isFile: isFile,
                isSymbolicLink: filemode === 0120000
            }));
        }));
    };

    // TODO: Report the originally stat'ed fileOrDirName in the error message when the target of a symlink cannot be found
    that.stat = function (fileOrDirName, maxSymlinks, cb) {
        if (typeof maxSymlinks !== 'number') {
            cb = maxSymlinks;
            maxSymlinks = 40;
        }
        that.lstat(fileOrDirName, passError(cb, function (stats) {
            if (stats.isSymbolicLink()) {
                if (maxSymlinks > 0) {
                    that.readFile(fileOrDirName, 'utf-8', passError(cb, function (contents) {
                        var symlinkTarget = Path.resolve(fileOrDirName.replace(/\/[^\/]+$/, '/'), contents);
                        that.stat(symlinkTarget, maxSymlinks - 1, cb);
                    }));
                } else {
                    cb(new fakeFsErrors.Eloop(that.toString() + ' Error: ELOOP, too many symbolic links encountered' + " '" + fileOrDirName + "'"));
                }
            } else {
                cb(null, stats);
            }
        }));
    };
};
