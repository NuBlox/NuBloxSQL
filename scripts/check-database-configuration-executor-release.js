'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.DATABASE_CONFIGURATION_EXECUTION_SCHEMA_VERSION,1);
assert.deepStrictEqual(Array.from(sql.DATABASE_CONFIGURATION_EXECUTION_STATUSES),[
  'dry-run','succeeded','failed','blocked','drifted','pending-verification'
]);
assert.deepStrictEqual(Array.from(sql.DATABASE_CONFIGURATION_APPROVAL_MODES),['required','none']);
assert.strictEqual(typeof sql.inspectDatabaseConfigurationPlan,'function');
assert.strictEqual(typeof sql.executeDatabaseConfiguration,'function');

console.log('NuBloxSQL database configuration execution release qualification: PASS');
