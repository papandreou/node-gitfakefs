var Entry = require('./Entry'),
    passError = require('passerror'),
    util = require('util');

function GitTreeEntry(options) {
    this.nodeGitTreeEntry = options.nodeGitTreeEntry;
    var name = this.nodeGitTreeEntry.name(),
        mode = this.nodeGitTreeEntry.filemode();
    Entry.call(this, {
        mode: mode,
        name: name,
        path: options.path || '/' + this.nodeGitTreeEntry.path(),
        type: (this.nodeGitTreeEntry.isBlob() || !this.nodeGitTreeEntry.isTree()) ? (mode === 0120000 ? 'symbolicLink' : 'file') : 'directory'
    });
    if (this.type === 'file' || this.type === 'symbolicLink') {
        this.oid = this.nodeGitTreeEntry.oid();
    }
}

util.inherits(GitTreeEntry, Entry);

GitTreeEntry.prototype.clone = function () {
    return new GitTreeEntry({
        nodeGitTreeEntry: this.nodeGitTreeEntry,
        name: this.name,
        path: this.path,
        seenSymbolicLinks: [].concat(this.seenSymbolicLinks)
    });
};

GitTreeEntry.prototype.getTarget = function (cb) {
    if (this.type === 'directory') {
        this.nodeGitTreeEntry.getTree(passError(cb, function (tree) {
            cb(null, tree.entries().map(function (nodeGitTreeEntry) {
                return new GitTreeEntry({nodeGitTreeEntry: nodeGitTreeEntry});
            }));
        }));
    } else {
        // this.type === 'file' || this.type === 'symbolicLink'
        this.nodeGitTreeEntry.getBlob(passError(cb, function (blob) {
            cb(null, blob.content());
        }));
    }
};

module.exports = GitTreeEntry;
