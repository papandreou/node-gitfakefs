var expect = require('unexpected'),
    passError = require('passerror'),
    Path = require('path'),
    GitFakeFs = require('../lib/GitFakeFs');

describe('GitFakeFs', function () {
    var gitFakeFs;
    beforeEach(function () {
        gitFakeFs = new GitFakeFs(Path.resolve(__dirname, 'testrepo.git'));
    });

    describe('#readdir()', function () {
        it('should list the files in the most recent commit', function (done) {
            gitFakeFs.readdir('/', passError(done, function (results) {
                expect(results, 'to equal', ['foo.txt', 'subdir']);
                done();
            }));
        });
    });

    it('readFile("/foo.txt") should produce the most recent version of foo.txt as a buffer', function (done) {
        gitFakeFs.readFile('/foo.txt', passError(done, function (buf) {
            expect(buf, 'to be a', Buffer);
            expect(buf.toString('utf-8'), 'to equal', 'This is the second revision of foo.txt\n\nIt also has non-ASCII chars: æøÅ\n\nAnd some more text...\n');
            done();
        }));
    });

    it('readFile("/foo.txt", "utf-8") should produce the most recent version of foo.txt as a string', function (done) {
        gitFakeFs.readFile('/foo.txt', 'utf-8', passError(done, function (str) {
            expect(str, 'to be a string');
            expect(str, 'to equal', 'This is the second revision of foo.txt\n\nIt also has non-ASCII chars: æøÅ\n\nAnd some more text...\n');
            done();
        }));
    });

    it('should be able to load a file located in a sub-subdirectory', function (done) {
        gitFakeFs.readFile('/subdir/subdir/bar.txt', 'utf-8', passError(done, function (str) {
            expect(str, 'to be a string');
            expect(str, 'to equal', 'The contents of bar.txt\n');
            done();
        }));
    });


    describe('pointed at the first commit in testrepo.git', function () {
        var gitFakeFs;
        beforeEach(function () {
            gitFakeFs = new GitFakeFs(Path.resolve(__dirname, 'testrepo.git'), {ref: '738876c70f4f5243a6672def4233911678ce38db'});
        });

        it('should contain the initial version of foo.txt', function (done) {
            gitFakeFs.readFile('/foo.txt', 'utf-8', passError(done, function (contents) {
                expect(contents, 'to equal', 'This is the first revision of foo.txt\n\nIt has non-ASCII chars: æøÅ\n');
                done();
            }));
        });
    });
});
