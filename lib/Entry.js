var Path = require('path');

function Entry(options) {
    this.parent = options.parent || null;
    this.mode = options.mode;
    this.type = options.type; // 'file', 'directory', or 'symbolicLink'
    this.size = options.size; // Only available for FsEntry when the entry has been statted
    this.seenSymbolicLinks = options.seenSymbolicLinks || [];
    if (typeof options.path !== 'string') {
        throw new Error('Entry: options.path is mandatory');
    }
    this.path = options.path;
    if (typeof options.name === 'string') {
        this.name = options.name;
    } else {
        this.name = Path.basename(options.path);
    }
}

module.exports = Entry;
