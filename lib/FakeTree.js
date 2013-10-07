function FakeTree(entries) {
    this._entries = entries;
}

FakeTree.prototype.entries = function () {
    return this._entries;
};

module.exports = FakeTree;
