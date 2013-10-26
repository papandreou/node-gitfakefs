var Path = require('path'),
    util = require('util'),
    async = require('async'),
    nodeGit = require('nodegit-papandreou'),
    _ = require('underscore'),
    passError = require('passerror'),
    memoizeAsync = require('memoizeasync'),
    createError = require('createerror'),
    FakeStats = require('./FakeStats'),
    FakeTree = require('./FakeTree'),
    FakeTreeEntry = require('./FakeTreeEntry'),
    fakeFsErrors = require('./fakeFsErrors'),
    GitTreeEntry = require('./GitTreeEntry'),
    GitIndexEntry = require('./GitIndexEntry'),
    FsEntry = require('./FsEntry');

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
                cb(null, GitIndexEntry.populate(repo, index));
            }));
        }));
    });

    function getEntriesFromNodeGitTree(nodeGitTree) {
        var entries = [];
        nodeGitTree.entries().forEach(function (treeEntry) {
            // Ignore submodules:
            if (treeEntry.filemode() !== 0xe000) {
                entries.push(new GitTreeEntry({nodeGitTreeEntry: treeEntry, parent: entries}));
            }
        });
        return entries;
    }

    that.getRootTree = memoizeAsync(function (cb) {
        that.getRepo(passError(cb, function (repo) {
            if (that.ref === 'HEAD') {
                repo.getReference('HEAD', passError(cb, function (reference) {
                    repo.getCommit(reference.target(), passError(cb, function (commit) {
                        commit.getTree(passError(cb, function (nodeGitTree) {
                            cb(null, getEntriesFromNodeGitTree(nodeGitTree));
                        }));
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
                                            commit.getTree(passError(cb, function (nodeGitTree) {
                                                cb(null, getEntriesFromNodeGitTree(nodeGitTree));
                                            }));
                                        }));
                                    } else {
                                        cb(err);
                                    }
                                } else if (reference.isConcrete()) {
                                    repo.getCommit(reference.target(), passError(cb, function (commit) {
                                        commit.getTree(passError(cb, function (nodeGitTree) {
                                            cb(null, getEntriesFromNodeGitTree(nodeGitTree));
                                        }));
                                    }));
                                } else {
                                    cb(new Error('Only concrete references are implemented'));
                                }
                            });
                        } else {
                            cb(err);
                        }
                    } else {
                        branch.getTree(passError(cb, function (nodeGitTree) {
                            cb(null, getEntriesFromNodeGitTree(nodeGitTree));
                        }));
                    }
                });
            }
        }));
    });

    that.getTreeOrBlobChangesInIndex = memoizeAsync(function (normalizedPath, dereferenceSymbolicLinks, cb) {
        that.getTreeOrBlobInIndex(normalizedPath, dereferenceSymbolicLinks, passError(cb, function (treeOrBlobInIndex, treeEntryInIndex) {
            that.getTreeOrBlobInCurrentCommit(normalizedPath, dereferenceSymbolicLinks, function (err, treeOrBlobInCurrentCommit, treeEntryInCurrentCommit) {
                if (err) {
                    // Entry or parent directory missing in current commit, so this must be a new file:
                    return cb(null, treeOrBlobInIndex, treeEntryInIndex);
                } else if (Buffer.isBuffer(treeOrBlobInIndex)) {
                    if (!Buffer.isBuffer(treeOrBlobInCurrentCommit) || treeEntryInIndex.oid.toString() !== treeEntryInCurrentCommit.oid.toString()) {
                        return cb(null, treeOrBlobInIndex, treeEntryInIndex);
                    } else {
                        cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + normalizedPath + "'"));
                    }
                } else if (Array.isArray(treeOrBlobInIndex)) {
                    async.filterSeries(treeOrBlobInIndex, function (entryInIndex, cb) {
                        that.getTreeOrBlobChangesInIndex(entryInIndex.path, entryInIndex.type !== 'symbolicLink' && dereferenceSymbolicLinks, function (err, result) {
                            cb(!err || err.code !== 'ENOENT');
                        });
                    }, function (changedEntries) {
                        if (changedEntries.length > 0 || normalizedPath === '/') {
                            cb(null, changedEntries);
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

        that[methodName](normalizedPath, dereferenceSymbolicLinks, function (treeOrBlobErr, treeOrBlob, treeEntry) {
            if (!treeOrBlobErr && Buffer.isBuffer(treeOrBlob)) {
                cb(null, treeOrBlob, treeEntry);
            } else if (config.fallBackToWorkingCopy) {
                that.getTreeOrBlobInCurrentCommit(path, false, function (currentCommitErr, treeOrBlobInCurrentCommit) {
                    var isStagedDelete = treeOrBlobErr && treeOrBlobErr.code === 'ENOENT' && !currentCommitErr;
                    if (isStagedDelete) {
                        cb(treeOrBlobErr, treeOrBlob, treeEntry);
                    } else {
                        that.getWorkDir(passError(cb, function (workDir) {
                            if (workDir) {
                                var pathInWorkDir = Path.resolve(workDir, path.substr(1));
                                fs.lstat(pathInWorkDir, function (statErr, lstats) {
                                    if (statErr) {
                                        return cb(treeOrBlobErr, treeOrBlob, treeEntry);
                                    }
                                    var fsEntry = new FsEntry({lstats: lstats, fsPath: pathInWorkDir, path: normalizedPath});
                                    if (treeOrBlobErr) {
                                        if (fsEntry.type === 'directory') {
                                            // A directory in the working copy, and a directory (or errored) in the current commit/index
                                            var entries = treeOrBlobErr ? [] : [].concat(treeOrBlob);
                                            fsEntry.getTarget(passError(cb, function (fsEntries) {
                                                fsEntries.forEach(function (fsEntry) {
                                                    var isInIndex = !treeOrBlobErr && entries.treeOrBlob.some(function (entryInIndex) {return entryInIndex.name === fsEntry.name;});
                                                    if (!isInIndex) {
                                                        var isInCurrentCommit = Array.isArray(treeOrBlobInCurrentCommit) && treeOrBlobInCurrentCommit.some(function (entryInCurrentCommit) {
                                                            return entryInCurrentCommit.name === entry.name;
                                                        });
                                                        if (!isInCurrentCommit) {
                                                            entries.push(fsEntry);
                                                        }
                                                    }
                                                });
                                                cb(null, entries, treeEntry);
                                            }));
                                        } else if (fsEntry.type === 'symbolicLink') {
                                            fs.readlink(fsEntry.fsPath, passError(cb, function (linkString) {
                                                if (!dereferenceSymbolicLinks) {
                                                    return cb(null, new Buffer(linkString, 'utf-8'), fsEntry);
                                                }
                                                // Duplicated...
                                                var workDirRelativePath = Path.relative(workDir, Path.resolve(Path.dirname(fsEntry.fsPath), linkString));
                                                if (/^\.\.\//.test(workDirRelativePath)) {
                                                    return cb(new Error('fallBackToWorkingCopy: Symbolic links that point outside the working copy are not supported yet: ' + fsEntry.fsPath + ' => ' + linkString + ' (' + workDirRelativePath + ')'));
                                                }
                                                var symbolicLinkTargetPath = '/' + workDirRelativePath;
                                                if (symbolicLinkTargetPath === normalizedPath || fsEntry.seenSymbolicLinks.indexOf(symbolicLinkTargetPath) !== -1 || fsEntry.seenSymbolicLinks.length > 40) {
                                                    return cb(new fakeFsErrors.Eloop(that.toString() + " Error: ELOOP, too many symbolic links encountered '" + normalizedPath + "'"));
                                                }
                                                that.getTreeOrBlob(symbolicLinkTargetPath, true, passError(cb, function (symbolicLinkTarget, symbolicLinkEntry) {
                                                    // Clone it so it can have its own seenSymbolicLinks housekeeping
                                                    if (Array.isArray(symbolicLinkEntry)) {
                                                        var seenSymbolicLinks = symbolicLinkEntry.seenSymbolicLinks;
                                                        symbolicLinkEntry = [].concat(symbolicLinkEntry);
                                                        symbolicLinkEntry.seenSymbolicLinks = [].concat(seenSymbolicLinks);
                                                    } else if (symbolicLinkEntry) {
                                                        symbolicLinkEntry = symbolicLinkEntry.clone();
                                                    }
                                                    Array.prototype.push.apply(symbolicLinkEntry.seenSymbolicLinks, fsEntry.seenSymbolicLinks);

                                                    cb(null, symbolicLinkTarget, symbolicLinkEntry);
                                                }));
                                            }));
                                        } else {
                                            // fsEntry.type === 'file'
                                            fsEntry.getTarget(passError(cb, function (target) {
                                                cb(null, target, fsEntry);
                                            }));
                                        }
                                    } else if (fsEntry.type === 'file' || fsEntry.type === 'symbolicLink') {
                                        // A directory in the index, but a file in the working copy
                                        cb(null, treeOrBlob, treeEntry);
                                    } else if (fsEntry.type === 'directory') {
                                        // A directory in both places. Merge the contents:
                                        fsEntry.getTarget(passError(cb, function (fsEntries) {
                                            var isSeenByName = {},
                                                entries = [];
                                            treeOrBlob.forEach(function (entry) {
                                                isSeenByName[entry.name] = true;
                                                entries.push(entry);
                                            });
                                            fsEntries.forEach(function (fsEntry) {
                                                if (isSeenByName[fsEntry.name]) {
                                                    return;
                                                }
                                                if (Array.isArray(treeOrBlobInCurrentCommit) && treeOrBlobInCurrentCommit.some(function (entryInCurrentCommit) {return entryInCurrentCommit.name === fsEntry.name;})) {
                                                    // Found in current commit, so it's a staged delete
                                                    return;
                                                }
                                                entries.push(fsEntry);
                                            });
                                            cb(null, entries, treeEntry);
                                        }));
                                    } else {
                                        cb(new Error('Internal error, unknown type for FsEntry: ' + fsEntry.type));
                                    }
                                });
                            } else {
                                cb(treeOrBlobErr, treeOrBlob, treeEntry);
                            }
                        }));
                    }
                });
            } else {
                cb(treeOrBlobErr, treeOrBlob, treeEntry);
            }
        });
    });

    ['Index', 'CurrentCommit'].forEach(function (source) {
        var methodName = 'getTreeOrBlobIn' + source;
        that[methodName] = memoizeAsync(function (normalizedPath, dereferenceSymbolicLinks, cb) {
            var fragments = normalizedPath.replace(/\/$/, '').split('/').slice(1),
                lastFragment = fragments.pop(),
                seenSymbolicLinks = [];
            if (normalizedPath === '/') {
                if (source === 'Index') {
                    getIndexRootTree(cb);
                } else {
                    that.getRootTree(cb);
                }
            } else {
                var parentDirName = Path.dirname(normalizedPath),
                    entryName = Path.basename(normalizedPath);
                this[methodName](parentDirName, true, passError(cb, function (entries, parentEntry) {
                    if (!Array.isArray(entries)) {
                        return cb(new fakeFsErrors.Enotdir("ENOTDIR, not a directory '" + normalizedPath + "'"));
                    }
                    for (var i = 0 ; i < entries.length ; i += 1) {
                        var entry = entries[i];
                        if (entry.name === entryName) {
                            entry.getTarget(passError(cb, function (target) {
                                if (entry.type === 'symbolicLink' && dereferenceSymbolicLinks) {
                                    var symbolicLinkTargetPath = normalizePath(Path.resolve('/' + fragments.join('/'), target.toString('utf-8')));
                                    if (symbolicLinkTargetPath === normalizedPath || entry.seenSymbolicLinks.indexOf(symbolicLinkTargetPath) !== -1 || entry.seenSymbolicLinks.length > 40) {
                                        return cb(new fakeFsErrors.Eloop(that.toString() + " Error: ELOOP, too many symbolic links encountered '" + normalizedPath + "'"));
                                    }
                                    that[methodName](symbolicLinkTargetPath, true, passError(cb, function (symbolicLinkTarget, symbolicLinkEntry) {
                                        // Clone it so it can have its own seenSymbolicLinks housekeeping
                                        if (Array.isArray(symbolicLinkEntry)) {
                                            var seenSymbolicLinks = symbolicLinkEntry.seenSymbolicLinks;
                                            symbolicLinkEntry = [].concat(symbolicLinkEntry);
                                            symbolicLinkEntry.seenSymbolicLinks = [].concat(seenSymbolicLinks);
                                        } else if (symbolicLinkEntry) {
                                            symbolicLinkEntry = symbolicLinkEntry.clone();
                                        }
                                        Array.prototype.push.apply(symbolicLinkEntry.seenSymbolicLinks, entry.seenSymbolicLinks);

                                        cb(null, symbolicLinkTarget, symbolicLinkEntry);
                                    }));
                                } else {
                                    cb(null, target, entry);
                                }
                            }));
                            return;
                        }
                    }
                    cb(new fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + normalizedPath + "'"));
                }));
            }
        });
    });

    that.readFile = function (path, encoding, cb) {
        if (arguments.length === 2 && typeof encoding === 'function') {
            cb = encoding;
            encoding = null;
        }
        that.getTreeOrBlob(path, true, passError(cb, function (blob, entry) {
           if (Buffer.isBuffer(blob)) {
                if (encoding) {
                    return cb(null, blob.toString(encoding));
                } else {
                    return cb(null, blob);
                }
            } else {
                return cb(new Error(that.toString() + ' ' + path + ' is not a file'));
            }
        }));
    };

    that.readdir = function (path, cb) {
        that.getTreeOrBlob(path, true, passError(cb, function (entries, parentEntry) {
            if (!Array.isArray(entries)) {
                return cb(new fakeFsErrors.Enotdir("ENOTDIR, not a directory '" + path + "'"));
            }
            var names = [];
            entries.forEach(function (entry) {
                if (entry.mode !== 0xe000) { // Ignore submodules
                    names.push(entry.name);
                }
            });
            cb(null, names);
        }));
    };

    ['stat', 'lstat'].forEach(function (methodName) {
        that[methodName] = function (path, cb) {
            that.getTreeOrBlob(path, methodName === 'stat', passError(cb, function (treeOrBlob, entry) {
                var mode = entry && entry.mode,
                    isSymbolicLink = entry && entry.type === 'symbolicLink',
                    isFile = !isSymbolicLink && entry && entry.type === 'file';
                cb(null, new FakeStats({
                    mode: mode,
                    size: isFile && treeOrBlob.length,
                    isDirectory: Array.isArray(treeOrBlob),
                    isFile: isFile,
                    isSymbolicLink: isSymbolicLink
                }));
            }));
        };
    });

    that.realpath = function (path, cb) {
        that.getTreeOrBlob(path, true, passError(cb, function (treeOrBlob, entry) {
            var realpath;
            if (entry) {
                realpath = entry.path;
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
