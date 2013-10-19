var async = require('async'),
    Entry = require('./Entry'),
    fs = require('fs'),
    passError = require('passerror'),
    Path = require('path'),
    util = require('util');

function FsEntry(options) {
    if (!options || !options.lstats || typeof options.path !== 'string' || typeof options.fsPath !== 'string') {
        throw new Error('FsEntry: options.lstats, options.path, and options.fsPath are mandatory');
    }
    this.fsPath = options.fsPath;
    this.lstats = options.lstats;
    Entry.call(this, {
        seenSymbolicLinks: options.seenSymbolicLinks,
        path: options.path,
        name: options.name,
        mode: this.lstats.mode,
        size: this.lstats.size,
        type: this.lstats.isSymbolicLink() ? 'symbolicLink' : (this.lstats.isDirectory() ? 'directory' : 'file')
    });
}

util.inherits(FsEntry, Entry);

FsEntry.prototype.clone = function () {
    return new FsEntry({
        lstats: this.lstats,
        fsPath: this.fsPath,
        name: this.name,
        path: this.path,
        seenSymbolicLinks: [].concat(this.seenSymbolicLinks)
    });
};

FsEntry.prototype.getTarget = function (cb) {
    var that = this;
    if (that.type === 'directory') {
        fs.readdir(that.fsPath, passError(cb, function (names) {
            var entries = [];
            async.eachLimit(names, 10, function (name, cb) {
                var fsPath = Path.resolve(that.fsPath, name);
                fs.lstat(fsPath, passError(cb, function (lstats) {
                    entries.push(new FsEntry({
                        lstats: lstats,
                        fsPath: fsPath,
                        name: name,
                        path: Path.resolve(that.path, name)
                    }));
                    cb();
                }));
            }, passError(cb, function () {
                cb(null, entries);
            }));
        }));
    } else {
        fs.readFile(that.fsPath, cb);
    }
};

module.exports = FsEntry;
