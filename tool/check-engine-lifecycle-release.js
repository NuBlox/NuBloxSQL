'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.ENGINE_LIFECYCLE_SCHEMA_VERSION,1);
assert.deepStrictEqual(Array.from(sql.ENGINE_LIFECYCLE_ENGINES),['postgresql','mysql','sqlite','sqlserver']);
assert.strictEqual(sql.INSTALLATION_PROVIDER_SCHEMA_VERSION,1);
assert.strictEqual(sql.ENGINE_INSTALLATION_PLAN_SCHEMA_VERSION,1);
assert.strictEqual(sql.ENGINE_INITIALIZATION_PLAN_SCHEMA_VERSION,1);
[
  'engineLifecycleProfile',
  'selectDatabaseEngine',
  'validateInstallationProvider',
  'installationProviderDescriptor',
  'inspectEngineTarget',
  'planEngineInstallation',
  'engineInstallationProviderSteps',
  'engineInstallationExternalSteps',
  'planEngineInitialization'
].forEach(function(name){assert.strictEqual(typeof sql[name],'function',name+' public export missing');});

console.log('NuBloxSQL engine lifecycle foundation release qualification: PASS');
