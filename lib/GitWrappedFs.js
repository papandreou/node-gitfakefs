var GitFakeFs = require('./GitFakeFs'),
    nodeGit = require('nodegit'),
    Path = require('path'),
    _ = require('underscore'),
    passError = require('passerror'),
    async = require('async'),
    memoizeAsync = require('memoizeasync'),
    createError = require('createerror'),
    FakeStats = require('./FakeStats'),
    fakeFsErrors = require('./fakeFsErrors'),
    virtualContentsDirectories = ['branches', 'tags', 'commits', 'index'];

var GitWrappedFs = module.exports = function GitWrappedFs(fs) {
    var that = this;

    // Don't require the new operator:
    if (!(that instanceof GitWrappedFs)) {
        return new GitWrappedFs(fs);
    }

    fs = fs || require('fs');

    var getRepo = memoizeAsync(function (pathToRepository, cb) {
        nodeGit.Repo.open(pathToRepository, cb);
    });

    var getNamesForObjectType = memoizeAsync(function (pathToRepository, objectType, cb) {
        getRepo(pathToRepository, passError(cb, function (repo) {
            repo.getReferences(nodeGit.Reference.Type.All, passError(cb, function (referenceNames) {
                if (objectType === 'commits') {
                    var revWalk = repo.createRevWalk();
                    revWalk.sorting(nodeGit.RevWalk.Sort.Topological, nodeGit.RevWalk.Sort.Reverse);
                    async.eachLimit(referenceNames, 1, function (referenceName, cb) {
                        repo.getReference(referenceName, passError(cb, function (reference) {
                            if (reference.isConcrete()) {
                                revWalk.push(reference.target(), cb);
                            } else {
                                cb();
                            }
                        }));
                    }, passError(cb, function () {
                        var commitSha1s = [];
                        (function walk() {
                            revWalk.next(passError(cb, function (oid) {
                                if (oid) {
                                    commitSha1s.push(oid.toString());
                                    walk();
                                } else {
                                    return cb(null, commitSha1s);
                                }
                            }));
                        }());
                    }));
                } else {
                    var referenceNamesOfTheCorrectType = [];
                    referenceNames.forEach(function (referenceName) {
                        var matchReferenceName = referenceName.match(/^refs\/(heads|tags)\/([^\/]+)$/);
                        if (matchReferenceName && (objectType === 'commits' || {heads: 'branches', tags: 'tags'}[matchReferenceName[1]] === objectType)) {
                            referenceNamesOfTheCorrectType.push(matchReferenceName[2]);
                        }
                    });
                    cb(null, referenceNamesOfTheCorrectType);

                }
            }));
        }));
    });

    var getGitFakeFs = memoizeAsync(function (pathToRepository, config, cb) {
        config = config || {};
        // Normalize config.index to false so that the memoized getRepo will return the same instance:
        if (!config.index) {
            config.index = false;
        }
        getRepo(pathToRepository, passError(cb, function (repo) {
            cb(null, new GitFakeFs(repo, config));
        }));
    }, {
        argumentsStringifier: function (args) {
            return args.map(function (arg) {
                if (arg && typeof arg === 'object') {
                    return JSON.stringify(arg);
                } else {
                    return String(arg);
                }
            }).join('\x1d');
        }
    });

    Object.keys(fs).forEach(function (fsMethodName) {
        var fsPropertyValue = fs[fsMethodName];
        if (typeof fsPropertyValue === 'function') {
            that[fsMethodName] = function (path) { // ...
                var args = [].slice.call(arguments),
                    lastArgument = args[args.length - 1],
                    cb = typeof lastArgument === 'function' ? lastArgument : function () {};

                function proxyToWrappedFs(cb) {
                    return fsPropertyValue.apply(fs, args);
                }

                // Absolutify and normalize path:
                var absolutePath = Path.resolve(process.cwd(), path),
                    matchGitRepoInPath = typeof absolutePath === 'string' && absolutePath.match(/^(.*?\/[^\/]*\.git)(\/contents($|\/.*$)|$)/);
                if (matchGitRepoInPath) {
                    if (!matchGitRepoInPath[2]) {
                        if (fsMethodName === 'readdir') {
                            // Intercept the result and add add the 'contents' dir
                            function addContentsDirectoryToReaddirResultAndCallOriginalCallback(err, entryNames) {
                                if (!err && Array.isArray(entryNames)) {
                                    entryNames = ['contents'].concat(entryNames);
                                }
                                cb.call(this, err, entryNames);
                            }
                            if (typeof lastArgument === 'function') {
                                args[args.length - 1] = addContentsDirectoryToReaddirResultAndCallOriginalCallback;
                            } else {
                                args.push(addContentsDirectoryToReaddirResultAndCallOriginalCallback);
                            }
                        }
                        return proxyToWrappedFs();
                    }
                    if (/Sync$/.test(fsMethodName)) {
                        throw new Error('GitWrappedFs.' + fsMethodName + ': Not implemented');
                    }
                    var pathToRepository = matchGitRepoInPath[1],
                        additionalFragments = (matchGitRepoInPath[3] || '/').split('/').slice(1),
                        ref = additionalFragments[0] || 'master';

                    function proxyToGitFakeFs(gitFakeFsConfig) {
                        return getGitFakeFs(pathToRepository, gitFakeFsConfig, passError(cb, function (gitFakeFs) {
                            var rootRelativePathInsideGitRepo = '/' + additionalFragments.join('/');
                            gitFakeFs[fsMethodName].apply(gitFakeFs, [rootRelativePathInsideGitRepo].concat(args.slice(1)));
                        }));
                    }

                    if (additionalFragments[additionalFragments.length - 1] === '') {
                        additionalFragments.pop();
                    }
                    getRepo(pathToRepository, passError(cb, function (repo) {
                        if (additionalFragments.length === 0) {
                            if (fsMethodName === 'readdir') {
                                cb(null, [].concat(virtualContentsDirectories));
                            } else if (fsMethodName === 'stat' || fsMethodName === 'lstat') {
                                cb(null, new FakeStats({isDirectory: true}));
                            } else {
                                cb(new Error('GitWrappedFs: ' + fsMethodName + ' not supported on the virtual contents directory'));
                            }
                        } else if (additionalFragments.length >= 1) {
                            var objectType = additionalFragments.shift();
                            if (objectType === 'index') {
                                // No further levels
                                return proxyToGitFakeFs({index: true, ref: 'HEAD'});
                            }
                            // objectType is 'branches', 'tags', or 'commits'
                            var objectName = additionalFragments.shift(); // Might be undefined

                            if (virtualContentsDirectories.indexOf(objectType) === -1) {
                                process.nextTick(function () {
                                    cb(fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + path + "'"));
                                });
                            } else if (fsMethodName === 'stat' || fsMethodName === 'lstat') {
                                if (objectName) {
                                    getNamesForObjectType(pathToRepository, objectType, passError(cb, function (namesForObjectType) {
                                        if (namesForObjectType.indexOf(objectName) === -1) {
                                            cb(fakeFsErrors.Enoent("Error: ENOENT, no such file or directory '" + path + "'"));
                                        } else {
                                            cb(null, new FakeStats({isDirectory: true}));
                                        }
                                    }));
                                } else {
                                    process.nextTick(function () {
                                        cb(null, new FakeStats({isDirectory: true}));
                                    });
                                }
                            } else if (!objectName && fsMethodName === 'readdir') {
                                getNamesForObjectType(pathToRepository, objectType, cb);
                            } else {
                                getGitFakeFs(pathToRepository, {index: objectType === 'index', ref: objectName}, passError(cb, function (gitFakeFs) {
                                    var rootRelativePathInsideGitRepo = '/' + additionalFragments.join('/');
                                    gitFakeFs[fsMethodName].apply(gitFakeFs, [rootRelativePathInsideGitRepo].concat(args.slice(1)));
                                }));
                            }
                        }
                    }));
                } else {
                    return proxyToWrappedFs();
                }
            };
        }
    });
};

GitWrappedFs.patchInPlace = function (fs) {
    fs = fs || require('fs');
    var fsShallowCopy = _.extend({}, fs),
        gitWrappedFs = new GitWrappedFs();
    _.extend(fs, gitWrappedFs);
    fs.unpatch = function () {
        Object.keys(gitWrappedFs).forEach(function (propertyName) {
            if (propertyName in fsShallowCopy) {
                fs[propertyName] = fsShallowCopy[propertyName];
            } else {
                delete fs[propertyName];
            }
        });
        delete fs.unwrap;
    };
};
