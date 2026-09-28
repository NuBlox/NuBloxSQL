'use strict';

var assert = require('assert');
var descriptor = require('../lib/SqlDialectDescriptor');

assert.strictEqual(descriptor.identity.family, 'mysql');
assert.strictEqual(descriptor.identity.name, 'MySQL');
assert.strictEqual(descriptor.services.quoteIdentifier('a`b'), '`a``b`');
assert.strictEqual(descriptor.services.placeholder(1), '?');
assert.strictEqual(descriptor.supports('preparedStatements'), true);
assert.strictEqual(descriptor.supports('serverSideCursors'), false);
assert.strictEqual(descriptor.supports('changeDataCapture'), false);
assert.strictEqual(descriptor.supports('multipleActiveResults'), false);

console.log('ok - canonical MySQL dialect contract');
