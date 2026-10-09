'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.ENGINE_LIFECYCLE_EXECUTION_SCHEMA_VERSION,1);
assert.deepStrictEqual(Array.from(sql.ENGINE_LIFECYCLE_APPROVAL_MODES),['required','none']);
assert.ok(sql.ENGINE_LIFECYCLE_EXECUTION_STATUSES.includes('drifted'));
assert.ok(sql.ENGINE_LIFECYCLE_EXECUTION_STATUSES.includes('pending-reboot'));
assert.ok(sql.ENGINE_LIFECYCLE_EXECUTION_STATUSES.includes('pending-restart'));
assert.ok(sql.ENGINE_LIFECYCLE_ACTION_RESULT_STATUSES.includes('pending-verification'));

[
  'inspectEngineInstallationPlan',
  'inspectEngineInitializationPlan',
  'executeEngineInstallation',
  'executeEngineInitialization'
].forEach(function(name){
  assert.strictEqual(typeof sql[name],'function',name+' public export missing');
});

console.log('NuBloxSQL controlled engine lifecycle execution release qualification: PASS');
