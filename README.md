GitFakeFs
=========

Emulate (a so far very small subset of) node.js' `fs` module on top of
a local git repository. Point GitFakeFs at a git repository, and optionally
a ref, and it'll give you back an `fs` implementation that gets its
data from the repo.

```javascript
var GitFakeFs = require('gitfakefs'),
    fs = new GitFakeFs('/path/to/repo.git');

fs.readFile('/foo.txt', function (err, contents) {
    // Got the contents of /foo.txt
});
```

Supported functions:

 * `readdir`
 * `readFile`
 * `stat`
 * `lstat`

Installation
------------

Make sure you have node.js and npm installed, then run:

    npm install gitfakefs

License
-------

3-clause BSD license -- see the `LICENSE` file for details.
