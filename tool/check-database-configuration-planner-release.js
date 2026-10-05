'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.DATABASE_CONFIGURATION_PLAN_SCHEMA_VERSION,1);
assert.deepStrictEqual(Array.from(sql.DATABASE_CONFIGURATION_PLAN_EXECUTION_MODES),['automatic','manual','satisfied']);
assert.deepStrictEqual(Array.from(sql.DATABASE_CONFIGURATION_PLAN_ACTIONS),['set','reload','restart']);
assert.strictEqual(typeof sql.planDatabaseConfiguration,'function');
assert.strictEqual(typeof sql.configurationAutomaticSteps,'function');
assert.strictEqual(typeof sql.configurationManualSteps,'function');

console.log('NuBloxSQL database configuration change planner release qualification: PASS');
