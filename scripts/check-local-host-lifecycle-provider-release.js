'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.LOCAL_HOST_INSTALLATION_PROVIDER_SCHEMA_VERSION,1);
assert.strictEqual(sql.LOCAL_HOST_INSTALLATION_PROVIDER_ID,'local-host');
assert.strictEqual(typeof sql.createLocalHostInstallationProvider,'function');
assert.strictEqual(sql.ENGINE_INSTALLATION_PREREQUISITE_SCHEMA_VERSION,1);
assert.deepStrictEqual(Array.from(sql.ENGINE_INSTALLATION_PREREQUISITE_STATUSES),['ready','attention','blocked']);
assert.strictEqual(typeof sql.assessEngineInstallationPrerequisites,'function');

var provider=sql.createLocalHostInstallationProvider({
  system:{platform:'linux',architecture:'x64',release:'test',hostname:'release-test',elevated:false},
  commandRunner:function(){return {available:false,status:null,stdout:'',stderr:'',error:{code:'ENOENT',message:'not found'}};}
});

assert.strictEqual(provider.kind,'local-host');
assert.deepStrictEqual(Array.from(provider.actions),['inspect-target']);
assert.strictEqual(provider.metadata.readOnly,true);
assert.strictEqual(provider.executeAction,undefined);

console.log('NuBloxSQL local-host lifecycle provider release qualification: PASS');
