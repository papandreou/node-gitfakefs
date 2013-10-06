var expect = require('unexpected-sinon'),
    sinon = require('sinon'),
    passError = require('passerror'),
    _ = require('underscore'),
    glob = require('glob'),
    Path = require('path'),
    GitWrappedFs = require('../lib/GitWrappedFs');

describe('GitWrappedFs', function () {
    var pathToTestRepo = Path.resolve(__dirname, 'testrepo.git'),
        gitWrappedFs;

    describe('applied to the built-in fs module', function () {
        var fs;
        beforeEach(function () {
            fs = _.extend({}, require('fs'));
            Object.keys(fs).forEach(function (propertyName) {
                if (typeof fs[propertyName] === 'function') {
                    sinon.spy(fs, propertyName);
                }
            });
            gitWrappedFs = new GitWrappedFs(fs);
        });

        ['stat', 'lstat'].forEach(function (methodName) {
            describe('#' + methodName + '()', function () {
                it('should report /contents/ as a directory', function (done) {
                    gitWrappedFs.stat(Path.resolve(pathToTestRepo, 'contents'), passError(done, function (stats) {
                        expect(stats.isDirectory(), 'to be', true);
                        expect(stats.isFile(), 'to be', false);
                        done();
                    }));
                });

                it('should report /contents/branches/ as a directory', function (done) {
                    gitWrappedFs.stat(Path.resolve(pathToTestRepo, 'contents', 'branches'), passError(done, function (stats) {
                        expect(stats.isDirectory(), 'to be', true);
                        expect(stats.isFile(), 'to be', false);
                        done();
                    }));
                });

                it('should report /contents/branches/master/ as a directory', function (done) {
                    gitWrappedFs.stat(Path.resolve(pathToTestRepo, 'contents', 'branches', 'master'), passError(done, function (stats) {
                        expect(stats.isDirectory(), 'to be', true);
                        expect(stats.isFile(), 'to be', false);
                        done();
                    }));
                });

                it('should report /contents/commits/738876c70f4f5243a6672def4233911678ce38db/ as a directory', function (done) {
                    gitWrappedFs.stat(Path.resolve(pathToTestRepo, 'contents', 'commits', '738876c70f4f5243a6672def4233911678ce38db'), passError(done, function (stats) {
                        expect(stats.isDirectory(), 'to be', true);
                        expect(stats.isFile(), 'to be', false);
                        done();
                    }));
                });

                it('should return an ENOENT error for an unsupported entry in /contents/', function (done) {
                    gitWrappedFs.stat(Path.resolve(pathToTestRepo, 'contents', 'foo'), function (err) {
                        expect(err, 'to be an', Error);
                        done();
                    });
                });
            });
        });

        describe('#readdir()', function () {
            it('should include the /contents/ directory when applied to the .git folder', function (done) {
                gitWrappedFs.readdir(Path.resolve(pathToTestRepo), passError(done, function (entryNames) {
                    expect(entryNames, 'to be an array');
                    expect(entryNames, 'to contain', 'contents');
                    done();
                }));
            });

            it('should return the types of objects when applied to the virtual /contents/ directory', function (done) {
                gitWrappedFs.readdir(Path.resolve(pathToTestRepo, 'contents'), passError(done, function (entryNames) {
                    expect(entryNames, 'to be an array');
                    expect(entryNames, 'to equal', ['branches', 'tags', 'commits', 'index']);
                    done();
                }));
            });

            it('should list the branches when applied to the virtual /contents/branches/ directory', function (done) {
                gitWrappedFs.readdir(Path.resolve(pathToTestRepo, 'contents', 'branches'), passError(done, function (entryNames) {
                    expect(entryNames, 'to be an array');
                    expect(entryNames, 'to contain', 'master');
                    done();
                }));
            });

            it('should list the tags when applied to the virtual /contents/tag/ directory', function (done) {
                gitWrappedFs.readdir(Path.resolve(pathToTestRepo, 'contents', 'tags'), passError(done, function (entryNames) {
                    expect(entryNames, 'to be an array');
                    expect(entryNames, 'to contain', 'myTag');
                    done();
                }));
            });

            it('should list the commits when applied to the virtual /contents/commits/ directory', function (done) {
                gitWrappedFs.readdir(Path.resolve(pathToTestRepo, 'contents', 'commits'), passError(done, function (entryNames) {
                    expect(entryNames, 'to be an array');
                    expect(entryNames, 'to contain', '91fe03e2a9f37e49ddc0cf1a1fd19ef44d9b7c4b');
                    done();
                }));
            });

            it('should work outside the .git repository', function (done) {
                gitWrappedFs.readdir(__dirname, passError(done, function (entryNames) {
                    expect(entryNames, 'to be an array');
                    expect(entryNames, 'to contain', Path.basename(__filename));
                    done();
                }));
            });
        });

        describe('#readFile()', function () {
            it('should proxy a path outside a .git repository to the wrapped fs implementation', function (done) {
                gitWrappedFs.readFile(__filename, 'utf-8', passError(done, function (contents) {
                    expect(fs.readFile, 'was called once');
                    expect(fs.readFile, 'was always called with', __filename, 'utf-8');
                    expect(contents, 'to match', /GitWrappedFs/);
                    done();
                }));
            });

            it('should proxy a path inside a branch to the GitFakeFs', function (done) {
                gitWrappedFs.readFile(Path.resolve(pathToTestRepo, 'contents', 'branches', 'master', 'foo.txt'), 'utf-8', passError(done, function (contents) {
                    expect(fs.readFile, 'was not called');
                    expect(contents, 'to match', /This is the second revision of foo\.txt/);
                    done();
                }));
            });

            it('should proxy a path inside a commit to the GitFakeFs', function (done) {
                gitWrappedFs.readFile(Path.resolve(pathToTestRepo, 'contents', 'commits', '738876c70f4f5243a6672def4233911678ce38db', 'foo.txt'), 'utf-8', passError(done, function (contents) {
                    expect(fs.readFile, 'was not called');
                    expect(contents, 'to match', /This is the first revision of foo\.txt/);
                    done();
                }));
            });
        });
    });

    describe('patching the built-in fs module "in-place"', function () {
        var originalReadFile = require('fs').readFile;
        before(function () {
            GitWrappedFs.patchInPlace();
        });

        it('should replace the original readFile', function () {
            var readFile = require('fs').readFile;
            expect(readFile, 'to be a', Function);
            expect(readFile, 'not to be', originalReadFile);
        });

        describe('#readdir()', function () {
            it('should include the /contents/ directory when applied to the .git folder', function (done) {
                require('fs').readdir(pathToTestRepo, passError(done, function (entryNames) {
                    expect(entryNames, 'to be an array');
                    expect(entryNames, 'to contain', 'contents');
                    done();
                }));
            });
        });

        it('should make the glob work on the contents directory', function (done) {
            require('glob')('**/*', {mark: true, cwd: pathToTestRepo + '/contents'}, passError(done, function (fileNames) {
                expect(fileNames, 'to be an array');
                expect(fileNames, 'to contain', Path.resolve(pathToTestRepo, 'contents', 'commits', '39c5c09d660b1bac8eb66898e88f72907ccbb223', 'foo.txt'));
                expect(fileNames, 'to contain', Path.resolve(pathToTestRepo, 'contents', 'tags', 'myTag', 'symlinkToSymlinkToNonExistentFile'));
                expect(fileNames, 'to contain', Path.resolve(pathToTestRepo, 'contents', 'branches', 'master', 'symlinkToSubdir/subsubdir/bar.txt'));
                done();
            }));
        });

        after(function () {
            require('fs').unpatch();
            expect(require('fs').readFile, 'to be', originalReadFile);
        });
    });
});
