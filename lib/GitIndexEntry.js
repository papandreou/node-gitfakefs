var Entry = require('./Entry'),
    passError = require('passerror'),
    Path = require('path'),
    util = require('util');

function GitIndexEntry(options) {
    this.nodeGitIndexEntry = options.nodeGitIndexEntry;
    var mode = this.nodeGitIndexEntry && this.nodeGitIndexEntry.mode();
    this.oid = this.nodeGitIndexEntry && this.nodeGitIndexEntry.oid();
    Entry.call(this, {
        mode: mode,
        type: options.type || (this.oid ? (mode === 0120000 ? 'symbolicLink' : 'file') : 'directory'),
        path: this.nodeGitIndexEntry ? '/' + this.nodeGitIndexEntry.path() : options.path,
        name: options.name
    });
    this.repo = options.repo;
    if (!this.oid) {
        this.subEntries = options.subEntries || [];
    }
}

util.inherits(GitIndexEntry, Entry);

GitIndexEntry.prototype.clone = function () {
    return new GitIndexEntry({
        nodeGitIndexEntry: this.nodeGitIndexEntry,
        repo: this.repo,
        path: this.path,
        name: this.name,
        subEntries: this.subEntries && [].concat(this.subEntries),
        seenSymbolicLinks: [].concat(this.seenSymbolicLinks)
   });
};

GitIndexEntry.prototype.getTarget = function (cb) {
    if (this.type === 'symbolicLink' || this.type === 'file') {
        this.repo.getBlob(this.oid, passError(cb, function (blob) {
            cb(null, blob.content());
        }));
    } else {
        var subEntries = this.subEntries;
        process.nextTick(function () {
            cb(null, subEntries);
        });
    }
};

GitIndexEntry.populate = function (repo, index) {
    var entriesByDirName = {'/' : []};
    index.entries().forEach(function (nodeGitIndexEntry) {
        if (nodeGitIndexEntry.mode() !== 0xe000) { // Ignore submodules
            var dirName = Path.dirname('/' + nodeGitIndexEntry.path()),
                gitIndexEntry = new GitIndexEntry({
                    nodeGitIndexEntry: nodeGitIndexEntry,
                    repo: repo
                });
            if (dirName in entriesByDirName) {
                entriesByDirName[dirName].push(gitIndexEntry);
            } else {
                var entries = entriesByDirName[dirName] = [gitIndexEntry],
                    pathFragments = dirName.split('/'); // ['', 'first', 'second']
                for (var i = pathFragments.length - 1; i > 0 ; i -= 1) {
                    var ancestorDirName = pathFragments.slice(0, i).join('/') || '/',
                        entry = new GitIndexEntry({
                            type: 'directory',
                            name: pathFragments[i],
                            path: Path.join(ancestorDirName, pathFragments[i]),
                            subEntries: entries
                        });
                    if (ancestorDirName in entriesByDirName) {
                        if (entriesByDirName[ancestorDirName].some(function (existingEntry) {
                            return existingEntry.name === entry.name;
                        })) {
                            // Already there, assume all parent directories have been added as well
                            break;
                        } else {
                            entries = entriesByDirName[ancestorDirName];
                            entries.push(entry);
                        }
                    } else {
                        entries = [entry];
                        entriesByDirName[ancestorDirName] = entries;
                    }
                }
            }
        }
    });
    return entriesByDirName['/'];
};

module.exports = GitIndexEntry;