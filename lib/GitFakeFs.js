var nodeGit = require('nodegit'),
    passError = require('passerror'),
    memoizeAsync = require('memoizeasync');

// Cannot use a regular constructor because the fs functions cannot assume
// the 'context' to be set correctly. People do things like this all the time:
// var stat = require('fs').stat;
var GitFakeFs = module.exports = function GitFakeFs(pathToRepository, config) {
    var that = this;

    // Don't require the new operator:
    if (!(that instanceof GitFakeFs)) {
        return new GitFakeFs(pathToRepository, config);
    }

    config = config || {};
    if (typeof pathToRepository !== 'string') {
        throw new Error('GitFakeFs: The path to the repository must be provided as the first parameter');
    }

    var getRepo = memoizeAsync(function (cb) {
        nodeGit.Repo.open(pathToRepository, cb);
    });

    // Look for a branch first, then a tag, then a commit:
    var getTreeish = memoizeAsync(function (treeish, cb) {
        getRepo(passError(cb, function (repo) {
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

    var getTreeOrBlob = memoizeAsync(function (path, cb) {
        if (path === '/') {
            getTreeish(config.ref || 'master', cb);
        } else {
            var fragments = path.replace(/\/$/, '').split('/'),
                lastFragment = fragments.pop();
            getTreeOrBlob(fragments.join('/') + '/', passError(cb, function (parentTree) {
                if (!(parentTree instanceof nodeGit.Tree)) {
                    return cb(new Error(lastFragment + ' is not a directory'));
                }
                var parentEntries = parentTree.entries();
                for (var i = 0 ; i < parentEntries.length ; i += 1) {
                    var parentEntry = parentEntries[i];
                    if (parentEntry.name() === lastFragment) {
                        if (parentEntry.isBlob()) {
                            return parentEntry.getBlob(cb);
                        } else {
                            return parentEntry.getTree(cb);
                        }
                    }
                }
                return cb(new Error(lastFragment + ' not found'));
            }));
        }
    });

    that.readFile = function (fileName, encoding, cb) {
        if (arguments.length === 2 && typeof encoding === 'function') {
            cb = encoding;
            encoding = null;
        }
        getTreeOrBlob(fileName, passError(cb, function (blob) {
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
        getTreeOrBlob(dirName, passError(cb, function (tree) {
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
};
