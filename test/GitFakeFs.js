var expect = require('unexpected'),
    passError = require('passerror'),
    Path = require('path'),
    GitFakeFs = require('../lib/GitFakeFs');

describe('GitFakeFs', function () {
    var fsGit;
    beforeEach(function () {
        fsGit = new GitFakeFs(Path.resolve(__dirname, 'testrepo.git'));
    });

    describe('#readdir()', function () {
        it('should list the files in the most recent commit', function (done) {
            fsGit.readdir('/', passError(done, function (results) {
                expect(results, 'to equal', ['foo.txt']);
                done();
            }));
        });
    });

    it('readFile("/foo.txt") should produce the most recent version of foo.txt as a buffer', function (done) {
        fsGit.readFile('/foo.txt', passError(done, function (buf) {
            expect(buf, 'to be a', Buffer);
            expect(buf.toString('utf-8'), 'to equal', 'This is the second revision of foo.txt\n\nIt also has non-ASCII chars: æøÅ\n\nAnd some more text...\n');
            done();
        }));
    });

    it('readFile("/foo.txt", "utf-8") should produce the most recent version of foo.txt as a string', function (done) {
        fsGit.readFile('/foo.txt', 'utf-8', passError(done, function (str) {
            expect(str, 'to be a string');
            expect(str, 'to equal', 'This is the second revision of foo.txt\n\nIt also has non-ASCII chars: æøÅ\n\nAnd some more text...\n');
            done();
        }));
    });
});
