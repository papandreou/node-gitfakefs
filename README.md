GitFakeFs
=========

Emulate (a so far very small subset of) node.js' `fs` module on top of
a local git repository. Point GitFakeFs at a git repository, and optionally
a branch/tag/commit, and it'll give you back an `fs` implementation that gets its
data from the repo.

```javascript
var GitFakeFs = require('gitfakefs'),
    fs = new GitFakeFs('/path/to/repo.git');

fs.readFile('/foo.txt', function (err, contents) {
    // Got the contents of /foo.txt
});
```

To expose the contents of a branch, tag, or commit, use the 'ref' option:

```javascript
new GitFakeFs('/path/to/repo.git', {ref: 'HEAD'});
new GitFakeFs('/path/to/repo.git', {ref: 'branchName'});
new GitFakeFs('/path/to/repo.git', {ref: 'tagName'});
new GitFakeFs('/path/to/repo.git', {ref: 'commitId'});
```

The staged contents:

```
new GitFakeFs('/path/to/repo.git', {ref: 'HEAD', index: true});
```

For non-bare repositories you can use the contents of the working copy
as fallback when a file or directory doesn't exist:

```
new GitFakeFs('/path/to/repo.git', {ref: 'HEAD', fallBackToWorkingCopy: true});
new GitFakeFs('/path/to/repo.git', {ref: 'HEAD', index: true, fallBackToWorkingCopy: true});
```

Finally, you can configure a GitFakeFs instance to only contain the
files and directories that have changes in the index:

```javascript
new GitFakeFs('/path/to/repo.git', {ref: 'HEAD', changesInIndex: true});
```

Supported functions:

 * `readdir`
 * `readFile`
 * `stat`
 * `lstat`
 * `realpath`

Installation
------------

Make sure you have node.js and npm installed, then run:

    npm install gitfakefs

License
-------

3-clause BSD license -- see the `LICENSE` file for details.
