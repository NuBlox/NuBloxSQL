'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.DATABASE_SERVER_DISCOVERY_SCHEMA_VERSION,1);
assert.strictEqual(sql.DATABASE_BOOTSTRAP_PREREQUISITE_SCHEMA_VERSION,1);
assert.deepStrictEqual(Array.from(sql.DATABASE_BOOTSTRAP_PREREQUISITE_STATUSES),['ready','attention','blocked']);
assert.strictEqual(typeof sql.discoverDatabaseServer,'function');
assert.strictEqual(typeof sql.assessDatabaseBootstrapPrerequisites,'function');

console.log('NuBloxSQL database server discovery release qualification: PASS');
