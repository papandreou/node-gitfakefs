var Path = require('path'),
    nodeGit = require('nodegit'),
    passError = require('passerror'),
    memoizeAsync = require('memoizeasync'),
    createError = require('createerror'),
    FakeStats = require('./FakeStats'),
    EloopError = createError({name: 'ELOOP', code: 'ELOOP', errno: 51});

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

    var getRepoAndIndexEntryByPath = memoizeAsync(function (cb) {
        that.getRepo(passError(cb, function (repo) {
            if (config.index) {
                repo.openIndex(passError(cb, function (index) {
                    var indexEntryByPath = {};
                    index.entries().forEach(function (indexEntry) {
                        indexEntryByPath['/' + indexEntry.path()] = indexEntry;
                    });
                    cb(null, repo, indexEntryByPath);
                }));
            } else {
                // Pretend that the index is empty if config.index isn't specified
                process.nextTick(function () {
                    cb(null, repo, {});
                });
            }
        }));
    });

    // Look for a branch first, then a tag, then a commit:
    that.getRootTree = memoizeAsync(function (cb) {
        getRepoAndIndexEntryByPath(passError(cb, function (repo) {
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
        getRepoAndIndexEntryByPath(passError(cb, function (repo, indexEntryByPath) {
            var indexEntry = indexEntryByPath[path];
            if (indexEntry) {
                repo.getBlob(indexEntry.oid(), passError(cb, function (blob) {
                    cb(null, blob, indexEntry);
                }));
            } else if (path === '/') {
                that.getRootTree(cb);
            } else {
                var fragments = path.replace(/\/$/, '').split('/'),
                    lastFragment = fragments.pop();
                that.getTreeOrBlob(fragments.join('/') + '/', passError(cb, function (parentTree) {
                    if (!(parentTree instanceof nodeGit.Tree || parentTree instanceof nodeGit.Index)) {
                        return cb(new Error(lastFragment + ' is not a directory'));
                    }
                    var parentEntries = parentTree.entries();
                    for (var i = 0 ; i < parentEntries.length ; i += 1) {
                        var parentEntry = parentEntries[i];
                        if (parentEntry.name() === lastFragment) {
                            if (parentEntry.isBlob() || !parentEntry.isTree()) {
                                parentEntry.getBlob(passError(cb, function (blob) {
                                    cb(null, blob, parentEntry);
                                }));
                            } else if (parentEntry.isTree()) {
                                parentEntry.getTree(passError(cb, function (tree) {
                                    cb(null, tree, parentEntry);
                                }));
                            } else {
                                cb(new Error('what is it!?'));
                            }
                            return;
                        }
                    }
                    return cb(new Error(lastFragment + ' not found'));
                }));
            }
        }));
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
                return cb(new Error(dirName + ' is not a file'));
            }
        }));
    };

    that.readdir = function (dirName, cb) {
        that.getTreeOrBlob(dirName, passError(cb, function (tree) {
            if (!(tree instanceof nodeGit.Tree)) {
                return cb(new Error(dirName + ' is not a directory'));
            }
            var names = [];
            tree.entries().forEach(function (entry) {
                names.push(entry.path());
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
                    cb(new EloopError('Error: ELOOP, too many symbolic links encountered' + " '" + fileOrDirName + "'"));
                }
            } else {
                cb(null, stats);
            }
        }));
    };
};
