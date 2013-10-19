var expect = require('unexpected'),
    passError = require('passerror'),
    Path = require('path'),
    fs = require('fs'),
    GitIndexEntry = require('../lib/GitIndexEntry'),
    nodeGit = require('nodegit-papandreou');

describe('GitIndexEntry', function () {
    var pathToTestRepo = Path.resolve(__dirname, 'testRepo.git');

    describe('#populate()', function () {
        var indexRoot;
        beforeEach(function (done) {
            nodeGit.Repo.open(pathToTestRepo, passError(done, function (repo) {
                repo.openIndex(passError(done, function (index) {
                    indexRoot = GitIndexEntry.populate(repo, index);
                    done();
                }));
            }));
        });

        function find(path, directory) {
            directory = directory || indexRoot;
            path = path.replace(/^\//, ''); // Forwards compatibility
            var fragments = path.split('/'),
                firstFragment = fragments.shift(),
                entry;
            for (var i = 0 ; i < directory.length ; i += 1) {
                if (directory[i].name === firstFragment) {
                    entry = directory[i];
                    break;
                }
            }
            if (!entry) {
                throw new Error(path + ' not found');
            } else if (fragments.length > 0) {
                return find(fragments.join('/'), entry.subEntries);
            } else {
                return entry;
            }
        }

        it('should contain /another', function () {
            expect(find('/another').name, 'to equal', 'another');
        });

        it('should contain /another/subdir', function () {
            expect(find('/another/subdir').name, 'to equal', 'subdir');
        });

        it('should contain /subdir/stagedFileInSubdir.txt', function () {
            expect(find('/subdir/stagedFileInSubdir.txt').name, 'to equal', 'stagedFileInSubdir.txt');
        });
    });
});