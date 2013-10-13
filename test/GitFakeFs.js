var expect = require('unexpected'),
    passError = require('passerror'),
    Path = require('path'),
    GitFakeFs = require('../lib/GitFakeFs');

describe('GitFakeFs', function () {
    var pathToTestRepo = Path.resolve(__dirname, 'testrepo.git');

    describe('pointed at a the most recent commit in testrepo.git', function () {
        var gitFakeFs;
        beforeEach(function () {
            gitFakeFs = new GitFakeFs(pathToTestRepo);
        });

        describe('#readdir()', function () {
            it('should list the files in the most recent commit', function (done) {
                gitFakeFs.readdir('/', passError(done, function (results) {
                    expect(results.sort(), 'to equal', [
                        '.gitmodules',
                        'executable.sh',
                        'fileStagedForDeletion.txt',
                        'foo.txt',
                        'subdir',
                        'symlinkToExecutable.sh',
                        'symlinkToFoo.txt',
                        'symlinkToNonExistentFile',
                        'symlinkToSelf',
                        'symlinkToSubdir',
                        'symlinkToSymlinkToNonExistentFile'
                    ]);
                    done();
                }));
            });

            it('should dereference symlinks to directories', function (done) {
                gitFakeFs.readdir('/symlinkToSubdir', passError(done, function (results) {
                    expect(results.sort(), 'to equal', [
                        'quux.txt',
                        'subsubdir'
                    ]);
                    done();
                }));
            });
        });

        describe('#readFile()', function () {
            it('should read the most recent version of foo.txt as a buffer', function (done) {
                gitFakeFs.readFile('/foo.txt', passError(done, function (buf) {
                    expect(buf, 'to be a', Buffer);
                    expect(buf.toString('utf-8'), 'to equal', 'This is the second revision of foo.txt\n\nIt also has non-ASCII chars: æøÅ\n\nAnd some more text...\n');
                    done();
                }));
            });

            it('should read the most recent version of foo.txt as a string', function (done) {
                gitFakeFs.readFile('/foo.txt', 'utf-8', passError(done, function (str) {
                    expect(str, 'to be a string');
                    expect(str, 'to equal', 'This is the second revision of foo.txt\n\nIt also has non-ASCII chars: æøÅ\n\nAnd some more text...\n');
                    done();
                }));
            });

            it('should read a file located in a sub-subdirectory', function (done) {
                gitFakeFs.readFile('/subdir/subsubdir/bar.txt', 'utf-8', passError(done, function (str) {
                    expect(str, 'to be a string');
                    expect(str, 'to equal', 'The contents of bar.txt\n');
                    done();
                }));
            });

            it('should dereference symlinks', function (done) {
                gitFakeFs.readFile('/subdir/quux.txt', 'utf-8', passError(done, function (gitFakeFs) {
                    expect(gitFakeFs, 'to equal', 'quux\n');
                    done();
                }));
            });

            it('should dereference multiple levels of symlinks', function (done) {
                gitFakeFs.readFile('/symlinkToSubdir/quux.txt', 'utf-8', passError(done, function (gitFakeFs) {
                    expect(gitFakeFs, 'to equal', 'quux\n');
                    done();
                }));
            });
        });

        describe('#stat()', function () {
            it('should report foo.txt as a 99 byte long file', function (done) {
                gitFakeFs.stat('/foo.txt', passError(done, function (stats) {
                    expect(stats.size, 'to equal', 99);
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report executable.sh as a 42 byte executable file', function (done) {
                gitFakeFs.stat('/executable.sh', passError(done, function (stats) {
                    expect(stats.size, 'to equal', 42);
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be truthy');
                    done();
                }));
            });

            it('should report subdir as a directory', function (done) {
                gitFakeFs.stat('/subdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', true);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report symlinkToFoo.txt as a file', function (done) {
                gitFakeFs.stat('/symlinkToFoo.txt', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report symlinkToSubdir as a directory', function (done) {
                gitFakeFs.stat('/symlinkToSubdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', true);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report symlinkToExecutable.sh as an executable file', function (done) {
                gitFakeFs.stat('/symlinkToExecutable.sh', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be truthy');
                    done();
                }));
            });

            it('should throw an ELOOP error for symlinkToSelf', function (done) {
                gitFakeFs.stat('/symlinkToSelf', function (err) {
                    expect(err, 'to be an', Error);
                    expect(err.code, 'to equal', 'ELOOP');
                    expect(err.errno, 'to equal', 51);
                    expect(err.message, 'to equal', "[GitFakeFs " + pathToTestRepo + "] Error: ELOOP, too many symbolic links encountered '/symlinkToSelf'");
                    done();
                });
            });
        });

        describe('#lstat()', function () {
            it('should report foo.txt as a 99 byte long file', function (done) {
                gitFakeFs.lstat('/foo.txt', passError(done, function (stats) {
                    expect(stats.size, 'to equal', 99);
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    done();
                }));
            });

            it('should report subdir as a directory', function (done) {
                gitFakeFs.lstat('/subdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', true);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    done();
                }));
            });

            it('should report symlinkToFoo.txt as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToFoo.txt', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    done();
                }));
            });

            it('should report symlinkToSubdir as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToSubdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    done();
                }));
            });

            it('should report symlinkToExecutable.sh as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToExecutable.sh', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    done();
                }));
            });

            it('should report symlinkToSelf as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToSelf', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report submodule as not existing', function (done) {
                gitFakeFs.lstat('/submodule', function (err) {
                    expect(err, 'to be an', Error);
                    expect(err.code, 'to equal', 'ENOENT');
                    done();
                });
            });
        });

        describe('#realpath()', function () {
            it('should report /foo.txt as /foo.txt', function (done) {
                gitFakeFs.realpath('/foo.txt', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/foo.txt');
                    done();
                }));
            });

            it('should report /subdir as /subdir', function (done) {
                gitFakeFs.realpath('/subdir', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir');
                    done();
                }));
            });

            it('should report /subdir/quux.txt as /subdir.txt', function (done) {
                gitFakeFs.realpath('/subdir/quux.txt', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir/quux.txt');
                    done();
                }));
            });

            it('should report /symlinkToSubdir as /subdir', function (done) {
                gitFakeFs.realpath('/symlinkToSubdir', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir');
                    done();
                }));
            });

            it('should report /symlinkToSubdir/quux.txt as /subdir/quux.txt', function (done) {
                gitFakeFs.realpath('/symlinkToSubdir/quux.txt', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir/quux.txt');
                    done();
                }));
            });

            it('should report / as /', function (done) {
                gitFakeFs.realpath('/', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/');
                    done();
                }));
            });
        });
    });

    describe('pointed at the first commit in testrepo.git', function () {
        var gitFakeFs;
        beforeEach(function () {
            gitFakeFs = new GitFakeFs(Path.resolve(__dirname, 'testrepo.git'), {ref: '738876c70f4f5243a6672def4233911678ce38db'});
        });

        it('should contain the initial version of foo.txt', function (done) {
            gitFakeFs.readFile('/foo.txt', 'utf-8', passError(done, function (gitFakeFs) {
                expect(gitFakeFs, 'to equal', 'This is the first revision of foo.txt\n\nIt has non-ASCII chars: æøÅ\n');
                done();
            }));
        });
    });

    describe('pointed at the index of testrepo.git', function () {
        var gitFakeFs;
        beforeEach(function () {
            gitFakeFs = new GitFakeFs(Path.resolve(__dirname, 'testrepo.git'), {index: true});
        });

        describe('#readFile()', function () {
            it('should return the staged gitFakeFs of /stagedFile.txt', function (done) {
                gitFakeFs.readFile('/stagedFile.txt', 'utf-8', passError(done, function (gitFakeFs) {
                    expect(gitFakeFs, 'to equal', 'Contents of staged file\n');
                    done();
                }));
            });
        });

        describe('#readdir()', function () {
            it('should include stagedFile.txt and another in the listing of the root directory', function (done) {
                gitFakeFs.readdir('/', passError(done, function (gitFakeFs) {
                    expect(gitFakeFs, 'to contain', 'stagedFile.txt');
                    expect(gitFakeFs, 'to contain', 'another');
                    done();
                }));
            });

            it('should include subdir in the directory listing of /another', function (done) {
                gitFakeFs.readdir('/another', passError(done, function (gitFakeFs) {
                    expect(gitFakeFs, 'to contain', 'subdir');
                    done();
                }));
            });

            it('should not include fileStagedForDeletion.txt in the listing of the root directory', function (done) {
                gitFakeFs.readdir('/', passError(done, function (gitFakeFs) {
                    expect(gitFakeFs, 'not to contain', 'fileStagedForDeletion.txt');
                    done();
                }));
            });
        });

        describe('#stat()', function () {
            it('should report foo.txt as a 99 byte long file', function (done) {
                gitFakeFs.stat('/foo.txt', passError(done, function (stats) {
                    expect(stats.size, 'to equal', 99);
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report executable.sh as a 42 byte executable file', function (done) {
                gitFakeFs.stat('/executable.sh', passError(done, function (stats) {
                    expect(stats.size, 'to equal', 42);
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be truthy');
                    done();
                }));
            });

            it('should report subdir as a directory', function (done) {
                gitFakeFs.stat('/subdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', true);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report symlinkToFoo.txt as a file', function (done) {
                gitFakeFs.stat('/symlinkToFoo.txt', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report symlinkToSubdir as a directory', function (done) {
                gitFakeFs.stat('/symlinkToSubdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', true);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report symlinkToExecutable.sh as an executable file', function (done) {
                gitFakeFs.stat('/symlinkToExecutable.sh', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    expect(stats.mode & 0111, 'to be truthy');
                    done();
                }));
            });

            it('should throw an ELOOP error for symlinkToSelf', function (done) {
                gitFakeFs.stat('/symlinkToSelf', function (err) {
                    expect(err, 'to be an', Error);
                    expect(err.code, 'to equal', 'ELOOP');
                    expect(err.errno, 'to equal', 51);
                    expect(err.message, 'to equal', "[GitFakeFs " + pathToTestRepo + "] Error: ELOOP, too many symbolic links encountered '/symlinkToSelf'");
                    done();
                });
            });
        });

        describe('#lstat()', function () {
            it('should report foo.txt as a 99 byte long file', function (done) {
                gitFakeFs.lstat('/foo.txt', passError(done, function (stats) {
                    expect(stats.size, 'to equal', 99);
                    expect(stats.isFile(), 'to be', true);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    done();
                }));
            });

            it('should report subdir as a directory', function (done) {
                gitFakeFs.lstat('/subdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', true);
                    expect(stats.isSymbolicLink(), 'to be', false);
                    done();
                }));
            });

            it('should report symlinkToFoo.txt as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToFoo.txt', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    done();
                }));
            });

            it('should report symlinkToSubdir as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToSubdir', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    done();
                }));
            });

            it('should report symlinkToExecutable.sh as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToExecutable.sh', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    done();
                }));
            });

            it('should report symlinkToSelf as a symbolic link', function (done) {
                gitFakeFs.lstat('/symlinkToSelf', passError(done, function (stats) {
                    expect(stats.isFile(), 'to be', false);
                    expect(stats.isDirectory(), 'to be', false);
                    expect(stats.isSymbolicLink(), 'to be', true);
                    expect(stats.mode & 0111, 'to be falsy');
                    done();
                }));
            });

            it('should report submodule as not existing', function (done) {
                gitFakeFs.lstat('/submodule', function (err) {
                    expect(err, 'to be an', Error);
                    expect(err.code, 'to equal', 'ENOENT');
                    done();
                });
            });
        });

        describe('#realpath()', function () {
            it('should report /foo.txt as /foo.txt', function (done) {
                gitFakeFs.realpath('/foo.txt', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/foo.txt');
                    done();
                }));
            });

            it('should report /symlinkToSubdir as /subdir', function (done) {
                gitFakeFs.realpath('/symlinkToSubdir', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir');
                    done();
                }));
            });

            it('should report /symlinkToSubdir/quux.txt as /subdir/quux.txt', function (done) {
                gitFakeFs.realpath('/symlinkToSubdir/quux.txt', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir/quux.txt');
                    done();
                }));
            });

            it('should report / as /', function (done) {
                gitFakeFs.realpath('/', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/');
                    done();
                }));
            });

            it('should report /subdir as /subdir', function (done) {
                gitFakeFs.realpath('/subdir', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir');
                    done();
                }));
            });

            it('should report /subdir/quux.txt as /subdir/quux.txt', function (done) {
                gitFakeFs.realpath('/subdir/quux.txt', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/subdir/quux.txt');
                    done();
                }));
            });
        });
    });

    describe('pointed at the index of testrepo.git with the changesInIndex option set to true', function () {
        var gitFakeFs;
        beforeEach(function () {
            gitFakeFs = new GitFakeFs(Path.resolve(__dirname, 'testrepo.git'), {index: true, changesInIndex: true});
        });

        describe('#readdir()', function () {
            it('should list the changed entries in the root', function (done) {
                gitFakeFs.readdir('/', passError(done, function (entries) {
                    expect(entries, 'to equal', ['another', 'stagedFile.txt', 'subdir']);
                    done();
                }));
            });

            it('should list the changed entries in /subdir', function (done) {
                gitFakeFs.readdir('/subdir', passError(done, function (entries) {
                    expect(entries, 'to equal', ['stagedFileInSubdir.txt']);
                    done();
                }));
            });
        });

        describe('#stat()', function () {
            it('should report /stagedFile.txt as a file', function (done) {
                gitFakeFs.stat('/stagedFile.txt', passError(done, function (stats) {
                    expect(stats.isFile(), 'to equal', true);
                    done();
                }));
            });

            it('should report /subdir/stagedFileInSubdir.txt as a file', function (done) {
                gitFakeFs.stat('/subdir/stagedFileInSubdir.txt', passError(done, function (stats) {
                    expect(stats.isFile(), 'to equal', true);
                    done();
                }));
            });

            it('should return ENOENT for /fileStagedForDeletion.txt', function (done) {
                gitFakeFs.stat('/fileStagedForDeletion.txt', function (err, stats) {
                    expect(err, 'to be an', Error);
                    expect(err.message, 'to match', /ENOENT/);
                    done();
                });
            });

            it('should return ENOENT for /foo.txt', function (done) {
                gitFakeFs.stat('/foo.txt', function (err, stats) {
                    expect(err, 'to be an', Error);
                    expect(err.message, 'to match', /ENOENT/);
                    done();
                });
            });
        });

        describe('#realpath()', function () {
            it('should return ENOENT for /foo.txt', function (done) {
                gitFakeFs.realpath('/foo.txt', function (err, realpath) {
                    expect(err, 'to be an', Error);
                    expect(err.message, 'to match', /ENOENT/);
                    done();
                });
            });

            it('should return ENOENT for /fileStagedForDeletion.txt', function (done) {
                gitFakeFs.realpath('/fileStagedForDeletion.txt', function (err, realpath) {
                    expect(err, 'to be an', Error);
                    expect(err.message, 'to match', /ENOENT/);
                    done();
                });
            });

            it('should report /another as /another', function (done) {
                gitFakeFs.realpath('/another', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/another');
                    done();
                }));
            });

            it('should report /another/subdir as /another/subdir', function (done) {
                gitFakeFs.realpath('/another/subdir', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/another/subdir');
                    done();
                }));
            });

            it('should report /another/subdir as /another/subdir', function (done) {
                gitFakeFs.realpath('/another/subdir', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/another/subdir');
                    done();
                }));
            });

            it('should report /another/subdir/that/only/exists/because/of/a/stagedFile.txt as itself', function (done) {
                gitFakeFs.realpath('/another/subdir/that/only/exists/because/of/a/stagedFile.txt', passError(done, function (realpath) {
                    expect(realpath, 'to equal', '/another/subdir/that/only/exists/because/of/a/stagedFile.txt');
                    done();
                }));
            });
        });
    });

    it('should throw an error with illegal combinations of the ref/index/changesInIndex options', function () {
        expect(function () {
            new GitFakeFs(pathToTestRepo, {ref: 'master', index: true});
        }, 'to throw exception', "GitFakeFs: The 'index' option is only supported when the 'ref' option is 'HEAD'");

        expect(function () {
            new GitFakeFs(pathToTestRepo, {ref: 'someTag', changesInIndex: true});
        }, 'to throw exception', "GitFakeFs: The 'changesInIndex' option is only supported when the 'ref' option is 'HEAD'");
    });
});
