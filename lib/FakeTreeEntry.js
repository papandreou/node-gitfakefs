function FakeTreeEntry(options) {
    this._name = options.name;
    this._path = options.path;
    this._mode = options.mode;
    this._target = options.target;
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
    return isBlob(this._target);
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
    return isTree(this._target);
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
