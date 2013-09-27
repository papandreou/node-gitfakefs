function FakeStats(config) {
    var that = this;
    this.config = config || {};

    ['mode', 'size'].forEach(function (propertyName) {
        that[propertyName] = config[propertyName];
    });
};

['isFile', 'isDirectory', 'isSymbolicLink', 'isFIFO', 'isSocket', 'isBlockDevice', 'isCharacterDevice'].forEach(function (propertyName) {
    FakeStats.prototype[propertyName] = function () {
        var value = this.config[propertyName];
        return typeof value === 'undefined' ? false : value;
    };
});

module.exports = FakeStats;