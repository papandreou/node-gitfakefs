function FakeTreeEntry(options) {
    this._name = options.name;
    this._path = options.path;
    this._mode = options.mode;
    this._target = options.target;
    this._isTree = options.isTree;
    this._isBlob = options.isBlob;
    this._getTarget = options.getTarget;
}

FakeTreeEntry.prototype.name = function () {
    return this._name;
};

FakeTreeEntry.prototype.path = function () {
    return this._path;
};

FakeTreeEntry.prototype.mode = function () {
    return this._mode;
};

FakeTreeEntry.prototype.isBlob = function () {
    return typeof this._isBlob === 'boolean' ? this._isBlob : isBlob(this._target);
};

FakeTreeEntry.prototype.getBlob = function () {
    process.nextTick(function () {
        if (this.isBlob()) {
            cb(null, this._target);
        } else {
            cb(new Error('Not a Blob'));
        }
    }.bind(this));
};

FakeTreeEntry.prototype.isTree = function () {
    return typeof this._isTree === 'boolean' ? this._isTree : isTree(this._target);
};

FakeTreeEntry.prototype.getTree = function () {
    process.nextTick(function () {
        if (this.isTree()) {
            cb(null, this._target);
        } else {
            cb(new Error('Not a Tree'));
        }
    }.bind(this));
};

module.exports = FakeTreeEntry;
