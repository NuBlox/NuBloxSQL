'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.DATABASE_CONFIGURATION_DISCOVERY_SCHEMA_VERSION,1);
assert.deepStrictEqual(Array.from(sql.DATABASE_CONFIGURATION_APPLY_MODES),['immediate','reload','restart','new-session','immutable','unknown']);
assert.deepStrictEqual(Array.from(sql.DATABASE_CONFIGURATION_SCOPES),['server','database','session','connection','unknown']);
assert.strictEqual(typeof sql.discoverDatabaseConfiguration,'function');
assert.strictEqual(typeof sql.findDatabaseConfiguration,'function');

console.log('NuBloxSQL database configuration discovery release qualification: PASS');
