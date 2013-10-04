var createError = require('createerror'),
    fakeFsErrors = module.exports = {
        Eloop: createError({name: 'ELOOP', code: 'ELOOP', errno: 51}),
        Enotdir: createError({name: 'ENOTDIR', code: 'ENOTDIR', errno: 27}),
        Enoent: createError({name: 'ENOENT', code: 'ENOENT', errno: 34})
    };
