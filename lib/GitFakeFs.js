var Path = require('path'),
    async = require('async'),
    nodeGit = require('nodegit-papandreou'),
    _ = require('underscore'),
    passError = require('passerror'),
    memoizeAsync = require('memoizeasync'),
    createError = require('createerror'),
    FakeStats = require('./FakeStats'),
    FakeTree = require('./FakeTree'),
    FakeTreeEntry = require('./FakeTreeEntry'),
    fakeFsErrors = require('./fakeFsErrors');

function isTree(obj) {
    return obj instanceof nodeGit.Tree || obj instanceof FakeTree;
}

function isBlob(obj) {
    return obj instanceof nodeGit.Blob || typeof obj.content === 'function';
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

    that.ref = config.ref || 'HEAD';
    if (config.index && that.ref !== 'HEAD') {
        throw new Error("GitFakeFs: The 'index' option is only supported when the 'ref' option is 'HEAD'");
    }

    var fs = config.fs || require('fs');

    if (config.changesInIndex && that.ref !== 'HEAD') {
        throw new Error("GitFakeFs: The 'changesInIndex' option is only supported when the 'ref' option is 'HEAD'");
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

    that.getWorkDir = memoizeAsync(function (cb) {
        that.getRepo(passError(cb, function (repo) {
            var workDir = repo.workdir();
            // For bare repositories nodegit reports the work dir to be the parent directory, which doesn't make sense:
            if (workDir && /[^\/]\.git/.test(repo.path())) {
                workDir = null;
            }
            cb(null, workDir);
        }));
    });

    that.toString = function () {
        return '[GitFakeFs ' + (typeof repositoryOrPath === 'string' ? repositoryOrPath : repositoryOrPath.path()).replace(/\/$/, '') + (config.ref ? '@' + config.ref : '') + ']';
    };

    var getIndexRootTree = memoizeAsync(function (cb) {
        that.getRepo(passError(cb, function (repo) {
            repo.openIndex(passError(cb, function (index) {
                var treeByDirName = {'/' : new FakeTree([])};
                index.entries().forEach(function (indexEntry) {
                    if (indexEntry.mode() !== 0xe000) { // Ignore submodules
                        var path = Path.dirname('/' + indexEntry.path());
                        if (!(path in treeByDirName)) {
                            var fakeTree = treeByDirName[path] = new FakeTree([indexEntry]),
                                pathFragments = path.split('/'); // ['', 'first', 'second']
                            for (var i = pathFragments.length - 1; i > 0 ; i -= 1) {
                                var ancestorDirName = pathFragments.slice(0, i).join('/') || '/',
                                    fakeTreeEntry = new FakeTreeEntry({
                                        path: pathFragments.slice(1, i + 1).join('/'),
                                        name: pathFragments[i],
                                        target: fakeTree
                                    });
                                if (ancestorDirName in treeByDirName) {
                                    if (treeByDirName[ancestorDirName].entries().some(function (indexEntry) {return indexEntry.path() === fakeTreeEntry.path();})) {
                                        // Already there, assume all parent directories have been added as well
                                        break;
                                    } else {
                                        fakeTree = treeByDirName[ancestorDirName];
                                        fakeTree.entries().push(fakeTreeEntry);
                                    }
                                } else {
                                    fakeTree = new FakeTree([fakeTreeEntry]);
                                    treeByDirName[ancestorDirName] = fakeTree;
                                }
                            }
                        } else {
                            treeByDirName[path].entries().push(indexEntry);
                        }
                    }
                });
                cb(null, treeByDirName['/']);
            }));
        }));
    });

    that.getRootTree = memoizeAsync(function (cb) {
        that.getRepo(passError(cb, function (repo) {
            if (that.ref === 'HEAD') {
                repo.getReference('HEAD', passError(cb, function (reference) {
                    repo.getCommit(reference.target(), passError(cb, function (commit) {
                        commit.getTree(cb);
                    }));
                }));
            } else {
                // Look for a branch first, then a tag, then a commit:
                repo.getBranch(that.ref, function (err, branch) {
                    if (err) {
                        if (/Reference .* not found/.test(err.message)) {
                            repo.getReference('refs/tags/' + that.ref, function (err, reference) {
                                if (err) {
                                    if (/The given reference name .*? is not valid|Reference .*? not found/.test(err.message)) {
                                        repo.getCommit(that.ref, passError(cb, function (commit) {
                                            commit.getTree(cb);
                                        }));
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
            }
        }));
    });

    that.getTreeOrBlobChangesInIndex = memoizeAsync(function (normalizedPath, dereferenceSymbolicLinks, cb) {
        that.getTreeOrBlobInIndex(normalizedPath, dereferenceSymbolicLinks, passError(cb, function (treeOrBlobInIndex, treeEntryInIndex, seenSymbolicLinks) {
            that.getTreeOrBlobInCurrentCommit(normalizedPath, dereferenceSymbolicLinks, function (err, treeOrBlobInCurrentCommit, treeEntryInCurrentCommit) {
                if (err) {
                    // Entry or parent directory missing in current commit, so this must be a new file:
                    return cb(null, treeOrBlobInIndex, treeEntryInIndex, seenSymbolicLinks);
                } else if (isBlob(treeOrBlobInIndex)) {
                    if (!isBlob(treeOrBlobInCurrentCommit) || treeOrBlobInIndex.oid().toString() !== treeOrBlobInCurrentCommit.oid().toString()) {
                        return cb(null, treeOrBlobInIndex, treeEntryInIndex, seenSymbolicLinks);
                    } else {
                        cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + normalizedPath + "'"));
                    }
                } else if (isTree(treeOrBlobInIndex)) {
                    async.filterSeries(treeOrBlobInIndex.entries(), function (entryInIndex, cb) {
                        that.getTreeOrBlobChangesInIndex(normalizePath(entryInIndex.path()), entryInIndex.mode() !== 0120000 && dereferenceSymbolicLinks, function (err, result) {
                            cb(!err || err.code !== 'ENOENT');
                        });
                    }, function (changedEntries) {
                        if (changedEntries.length > 0 || normalizedPath === '/') {
                            cb(null, new FakeTree(changedEntries), seenSymbolicLinks);
                        } else {
                            cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + normalizedPath + "'"));
                        }
                    });
                } else {
                    throw new Error('Internal error');
                }
            });
        }));
    });

    that.getTreeOrBlob = memoizeAsync(function (path, dereferenceSymbolicLinks, cb) {
        var normalizedPath = normalizePath(path);
        if (typeof deferenceSymbolicLinks === 'function') {
            cb = dereferenceSymbolicLinks;
            dereferenceSymbolicLinks = true;
        }
        var methodName = 'getTreeOrBlob' + (config.changesInIndex ? 'ChangesInIndex' : (config.index ? 'InIndex' : 'InCurrentCommit'));

        that[methodName](normalizedPath, dereferenceSymbolicLinks, function (treeOrBlobErr, treeOrBlob, treeEntry, seenSymbolicLinks) {
            if (!treeOrBlobErr && isBlob(treeOrBlob)) {
                cb(null, treeOrBlob, treeEntry, seenSymbolicLinks);
            } else if (config.fallBackToWorkingCopy) {
                that.getTreeOrBlobInCurrentCommit(path, false, function (currentCommitErr) {
                    var isStagedDelete = treeOrBlobErr && treeOrBlobErr.code === 'ENOENT' && !currentCommitErr;
                    if (isStagedDelete) {
                        cb(treeOrBlobErr, treeOrBlob, treeEntry, seenSymbolicLinks);
                    } else {
                        that.getWorkDir(passError(cb, function (workDir) {
                            if (workDir) {
                                var pathInWorkDir = Path.resolve(workDir, path.substr(1));
                                fs.lstat(pathInWorkDir, function (statErr, stats) {
                                    if (statErr) {
                                        cb(treeOrBlobErr, treeOrBlob, treeEntry, seenSymbolicLinks);
                                    } else if (treeOrBlobErr) {
                                        if (stats.isDirectory()) {
                                            // A directory in the working copy, and a directory (or errored) in the current commit/index
                                            // Make fake tree object...
                                            // Duplicated
                                            fs.readdir(pathInWorkDir, passError(cb, function (names) {
                                                var entries = [];
                                                async.eachLimit(names, 10, function (name, cb) {
                                                    that.getTreeOrBlobInCurrentCommit(Path.resolve(path, name), false, function (err) {
                                                        if (err) {
                                                            if (err.code === 'ENOENT') {
                                                                // Not found in current commit, so it's not a staged delete. Add it:
                                                                var pathToEntryInWorkDir = Path.resolve(pathInWorkDir, name);
                                                                fs.lstat(Path.resolve(pathInWorkDir, name), passError(cb, function (stats) {
                                                                    var fakeTreeEntryConfig = {
                                                                        name: name,
                                                                        mode: stats.mode,
                                                                        path: Path.resolve(path, name),
                                                                        isTree: stats.isDirectory(),
                                                                        isBlob: stats.isFile() || stats.isSymbolicLink()
                                                                    };
                                                                    fakeTreeEntryConfig[stats.isDirectory() ? 'getTree' : 'getBlob'] = function (cb) {
                                                                        that.getTreeOrBlob(Path.resolve(path, name), true, cb);
                                                                    };
                                                                    entries.push(new FakeTreeEntry(fakeTreeEntryConfig));
                                                                    cb();
                                                                }));
                                                            } else {
                                                                cb(err);
                                                            }
                                                        } else {
                                                            // Found in current commit, so it's a staged delete. Don't add the entry.
                                                            cb();
                                                        }
                                                    });
                                                }, passError(cb, function () {
                                                    cb(null, new FakeTree(entries));
                                                }));
                                            }));
                                        } else {
                                            fs.readFile(pathInWorkDir, passError(cb, function (contents) {
                                                var fakeBlob = {
                                                    isBlob: function () {
                                                        return true;
                                                    },
                                                    isTree: function () {
                                                        return false;
                                                    },
                                                    content: function () {
                                                        return contents;
                                                    }
                                                };
                                                cb(null, fakeBlob, new FakeTreeEntry({name: Path.basename(path), path: path.substr(1), mode: stats.mode, target: fakeBlob}, seenSymbolicLinks));
                                            }));
                                        }
                                    } else if (stats.isFile()) {
                                        // A directory in the index, but a file in the working copy
                                        cb(null, treeOrBlob, treeEntry, seenSymbolicLinks);
                                    } else {
                                        // A directory in both places. Merge the contents:
                                        fs.readdir(pathInWorkDir, passError(cb, function (names) {
                                            var isSeenByName = {},
                                                entries = [];
                                            treeOrBlob.entries().forEach(function (entry) {
                                                var name = entry.name ? entry.name() : Path.basename(entry.path());
                                                isSeenByName[name] = true;
                                                entries.push(entry);
                                            });
                                            async.eachLimit(names.filter(function (name) {return !isSeenByName[name];}), 10, function (name, cb) {
                                                var pathToEntry = Path.resolve(path, name);
                                                that.getTreeOrBlobInCurrentCommit(pathToEntry, false, function (err) {
                                                    if (err) {
                                                        if (err.code === 'ENOENT') {
                                                            // Not found in current commit, so it's not a staged delete. Add it:
                                                            var pathToEntryInWorkDir = Path.resolve(pathInWorkDir, name);
                                                            fs.lstat(Path.resolve(pathInWorkDir, name), passError(cb, function (stats) {
                                                                var fakeTreeEntryConfig = {
                                                                    name: name,
                                                                    mode: stats.mode,
                                                                    path: pathToEntry,
                                                                    isTree: stats.isDirectory(),
                                                                    isBlob: stats.isFile() || stats.isSymbolicLink()
                                                                };
                                                                fakeTreeEntryConfig[stats.isDirectory() ? 'getTree' : 'getBlob'] = function (cb) {
                                                                    that.getTreeOrBlob(Path.resolve(path, name), true, cb);
                                                                };
                                                                entries.push(new FakeTreeEntry(fakeTreeEntryConfig));
                                                                cb();
                                                            }));
                                                        } else {
                                                            cb(err);
                                                        }
                                                    } else {
                                                        // Found in current commit, so it's a staged delete. Don't add the entry.
                                                        cb();
                                                    }
                                                });
                                            }, passError(cb, function () {
                                                cb(null, new FakeTree(entries));
                                            }));
                                        }));
                                    }
                                });
                            } else {
                                cb(treeOrBlobErr, treeOrBlob, treeEntry, seenSymbolicLinks);
                            }
                        }));
                    }
                });
            } else {
                cb(treeOrBlobErr, treeOrBlob, treeEntry, seenSymbolicLinks);
            }
        });
    });

    that.getTreeOrBlobInIndex = memoizeAsync(function (normalizedPath, dereferenceSymbolicLinks, cb) {
        var fragments = normalizedPath.replace(/\/$/, '').split('/').slice(1),
            lastFragment = fragments.pop(),
            seenSymbolicLinks = [];
        if (normalizedPath === '/') {
            getIndexRootTree(cb);
        } else {
            var parentDirName = Path.dirname(normalizedPath),
                entryName = Path.basename(normalizedPath);
            this.getTreeOrBlobInIndex(parentDirName, true, passError(cb, function (parentTree, parentIndexEntry) {
                if (!isTree(parentTree)) {
                    return cb(new fakeFsErrors.Enotdir("ENOTDIR, not a directory '" + normalizedPath + "'"));
                }
                var parentEntries = parentTree.entries();
                for (var i = 0 ; i < parentEntries.length ; i += 1) {
                    var parentEntry = parentEntries[i];
                    if (Path.basename(parentEntry.path()) === entryName) {
                        if (parentEntry.oid) {
                            var oid = parentEntry.oid();
                            that.getRepo(passError(cb, function (repo) {
                                repo.getBlob(oid, passError(cb, function (blob) {
                                    if (getFileMode(parentEntry) === 0120000 && dereferenceSymbolicLinks) {
                                        var symbolicLinkTarget = normalizePath(Path.resolve('/' + fragments.join('/'), blob.content().toString('utf-8')));
                                        if (symbolicLinkTarget === normalizedPath || (seenSymbolicLinks && (seenSymbolicLinks.indexOf(symbolicLinkTarget) !== -1 || seenSymbolicLinks.length > 40))) {
                                            return cb(new fakeFsErrors.Eloop(that.toString() + ' Error: ELOOP, too many symbolic links encountered' + " '" + normalizedPath + "'"));
                                        }
                                        that.getTreeOrBlobInIndex(symbolicLinkTarget, true, passError(cb, function (treeOrBlob, symbolicLinkEntry, symbolicLinkSeenSymbolicLinks) {
                                            cb(null, treeOrBlob, symbolicLinkEntry, (seenSymbolicLinks || []).concat(symbolicLinkTarget));
                                        }));
                                    } else {
                                        cb(null, blob, parentEntry, seenSymbolicLinks);
                                    }
                                }));
                            }));
                        } else {
                            // parentEntry.isTree() (FakeTreeEntry)
                            cb(null, parentEntry._target, parentEntry);
                        }
                        return;
                    }
                }
                cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + normalizedPath + "'"));
            }));
        }
    });

    that.getTreeOrBlobInCurrentCommit = memoizeAsync(function (normalizedPath, dereferenceSymbolicLinks, cb) {
        var fragments = normalizedPath.replace(/\/$/, '').split('/').slice(1),
            lastFragment = fragments.pop(),
            seenSymbolicLinks = [];
        if (normalizedPath === '/') {
            that.getRootTree(cb);
        } else {
            that.getTreeOrBlobInCurrentCommit('/' + fragments.join('/'), true, passError(cb, function (parentTree, parentParentEntry, seenSymbolicLinks) {
                if (!isTree(parentTree)) {
                    return cb(new fakeFsErrors.Enotdir("ENOTDIR, not a directory '" + normalizedPath + "'"));
                }
                var parentEntries = parentTree.entries();
                for (var i = 0 ; i < parentEntries.length ; i += 1) {
                    var parentEntry = parentEntries[i];
                    if (parentEntry.name() === lastFragment) {
                        if (parentEntry.isBlob() || !parentEntry.isTree()) {
                            if (getFileMode(parentEntry) === 0xe000) { // Ignore submodules
                                cb(new fakeFsErrors.Enoent(that.toString() + " Error: ENOENT, no such file or directory '" + normalizedPath + "'"));
                            } else {
                                parentEntry.getBlob(passError(cb, function (blob) {
                                    if (getFileMode(parentEntry) === 0120000 && dereferenceSymbolicLinks) {
                                        var symbolicLinkTarget = normalizePath(Path.resolve('/' + fragments.join('/'), blob.content().toString('utf-8')));
                                        if (symbolicLinkTarget === normalizedPath || (seenSymbolicLinks && (seenSymbolicLinks.indexOf(symbolicLinkTarget) !== -1 || seenSymbolicLinks.length > 40))) {
                                            return cb(new fakeFsErrors.Eloop(that.toString() + ' Error: ELOOP, too many symbolic links encountered' + " '" + normalizedPath + "'"));
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
                return cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + normalizedPath + "'"));
            }));
        }
    });

    that.readFile = function (path, encoding, cb) {
        if (arguments.length === 2 && typeof encoding === 'function') {
            cb = encoding;
            encoding = null;
        }
        that.getTreeOrBlob(path, true, passError(cb, function (blob) {
            if (isBlob(blob)) {
                var gitFakeFs = blob.content();
                if (encoding) {
                    return cb(null, gitFakeFs.toString(encoding));
                } else {
                    return cb(null, gitFakeFs);
                }
            } else {
                return cb(new Error(that.toString() + ' ' + path + ' is not a file'));
            }
        }));
    };

    that.readdir = function (path, cb) {
        that.getTreeOrBlob(path, true, function (getTreeOrBlobErr, tree) {
            if (!isTree(tree)) {
                return cb(new fakeFsErrors.Enotdir("ENOTDIR, not a directory '" + path + "'"));
            }
            var names = [];
            tree.entries().forEach(function (entry) {
                if (getFileMode(entry) !== 0xe000) { // Ignore submodules
                    names.push(Path.basename(entry.path()));
                }
            });
            cb(null, names);
        });
    };

    ['stat', 'lstat'].forEach(function (methodName) {
        that[methodName] = function (path, cb) {
            that.getTreeOrBlob(path, methodName === 'stat', passError(cb, function (treeOrBlob, treeEntry) {
                var filemode = treeEntry && getFileMode(treeEntry),
                    isFile = filemode !== 0120000 && isBlob(treeOrBlob);
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

    that.realpath = function (path, cb) {
        that.getTreeOrBlob(path, true, passError(cb, function (treeOrBlob, treeEntry) {
            var realpath;
            if (treeEntry) {
                realpath = '/' + treeEntry.path();
            } else {
                realpath = '/';
            }
            cb(null, realpath);
        }));
    };
};

GitFakeFs.nodeGit = nodeGit;
GitFakeFs.FakeStats = FakeStats;
GitFakeFs.fakeFsErrors = fakeFsErrors;
