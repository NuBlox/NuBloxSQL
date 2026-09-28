'use strict';

var assert = require('assert');
var NamedPlaceholders = require('../../lib/NamedPlaceholders');

var enabled = {namedPlaceholders: true};
var disabled = {namedPlaceholders: false};
var options;

options = {
  sql    : 'SELECT :x + :x AS total, :label AS label',
  values : {x: 21, label: 'NuBloxSQL'}
};
NamedPlaceholders.resolve(enabled, options);
assert.strictEqual(options.sql, 'SELECT ? + ? AS total, ? AS label');
assert.deepStrictEqual(options.values, [21, 21, 'NuBloxSQL']);

options = {
  sql    : 'SELECT ? AS positional',
  values : [42]
};
NamedPlaceholders.resolve(enabled, options);
assert.strictEqual(options.sql, 'SELECT ? AS positional');
assert.deepStrictEqual(options.values, [42]);

options = {
  sql               : 'SELECT :x AS untouched',
  values            : {x: 7},
  namedPlaceholders : false
};
NamedPlaceholders.resolve(enabled, options);
assert.strictEqual(options.sql, 'SELECT :x AS untouched');
assert.deepStrictEqual(options.values, {x: 7});

options = {
  sql               : "SELECT ':ignored' AS literal, :x AS value",
  values            : {x: 9},
  namedPlaceholders : true
};
NamedPlaceholders.resolve(disabled, options);
assert.strictEqual(options.sql, "SELECT ':ignored' AS literal, ? AS value");
assert.deepStrictEqual(options.values, [9]);
