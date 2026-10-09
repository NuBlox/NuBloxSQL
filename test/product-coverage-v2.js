'use strict';

var assert=require('assert');
var sql=require('..');

assert.strictEqual(sql.PRODUCT_COVERAGE_SCHEMA_VERSION,2);
assert.strictEqual(sql.productCoverage.SCHEMA_VERSION,2);
assert.strictEqual(sql.capabilityModel.productCoverage,sql.productCoverage);

var validation=sql.productCoverage.validate();
assert.strictEqual(validation.valid,true);
assert.strictEqual(validation.schemaVersion,2);
assert.ok(validation.areas>=10);

var report=sql.productCoverage.report();
assert.strictEqual(report.schemaVersion,2);
assert.strictEqual(report.summary.total,report.areas.length);
assert.ok(report.summary.strong>0);
assert.ok(report.summary.gap>0);
assert.ok(Array.isArray(report.pillars.runtime));
assert.ok(Array.isArray(report.pillars.language));
assert.ok(Array.isArray(report.pillars.intelligence));
assert.ok(Array.isArray(report.pillars.portability));
assert.ok(Array.isArray(report.pillars.platform));
assert.ok(Array.isArray(report.pillars['dialect-depth']));
assert.ok(Array.isArray(report.pillars.administration));
assert.ok(Array.isArray(report.pillars.operations));
assert.ok(Array.isArray(report.pillars.lifecycle));

var dialectRegistry=sql.productCoverage.area('portability.dialect-registry');
assert.strictEqual(dialectRegistry.status,'established');
assert.strictEqual(dialectRegistry.stages.publicApi,'implemented');
assert.strictEqual(dialectRegistry.dialects.sqlserver,'implemented');

var profileOverlays=sql.productCoverage.area('portability.profile-overlays');
assert.strictEqual(profileOverlays.status,'established');
assert.strictEqual(profileOverlays.stages.validator,'implemented');
assert.strictEqual(profileOverlays.stages.diagnostics,'implemented');

var metadata=sql.productCoverage.area('intelligence.metadata');
assert.strictEqual(metadata.status,'strong');
assert.strictEqual(metadata.stages.introspection,'implemented');
assert.strictEqual(metadata.dialects.postgresql,'implemented');

var sqlServer=sql.productCoverage.area('dialect.sqlserver-parity');
assert.strictEqual(sqlServer.status,'partial');
assert.strictEqual(sqlServer.dialects.sqlserver,'partial');

var migration=sql.productCoverage.area('platform.migrations');
assert.strictEqual(migration.status,'established');
assert.strictEqual(migration.stages.publicApi,'implemented');

var schemaDiff=sql.productCoverage.area('platform.schema-diff');
assert.strictEqual(schemaDiff.status,'established');
assert.strictEqual(schemaDiff.stages.publicApi,'implemented');

var migrationExecution=sql.productCoverage.area('platform.migration-execution');
assert.strictEqual(migrationExecution.status,'established');
assert.strictEqual(migrationExecution.stages.runtime,'implemented');

var migrationExecution=sql.productCoverage.area('platform.migration-execution');
assert.strictEqual(migrationExecution.status,'established');
assert.strictEqual(migrationExecution.stages.runtime,'implemented');

var bootstrap=sql.productCoverage.area('administration.bootstrap');
assert.strictEqual(bootstrap.status,'partial');
assert.strictEqual(bootstrap.stages.publicApi,'implemented');
assert.strictEqual(bootstrap.stages.runtime,'implemented');
assert.strictEqual(bootstrap.stages.introspection,'implemented');
assert.strictEqual(bootstrap.stages.contractTest,'implemented');

var configuration=sql.productCoverage.area('administration.configuration');
assert.strictEqual(configuration.status,'partial');
assert.strictEqual(configuration.stages.publicApi,'implemented');
assert.strictEqual(configuration.stages.introspection,'implemented');
assert.strictEqual(configuration.stages.contractTest,'implemented');

var health=sql.productCoverage.area('operations.health-sessions');
assert.strictEqual(health.status,'partial');

var maintenance=sql.productCoverage.area('operations.maintenance');
assert.strictEqual(maintenance.status,'partial');

var backup=sql.productCoverage.area('operations.backup-recovery');
assert.strictEqual(backup.status,'gap');

var installation=sql.productCoverage.area('lifecycle.installation');
assert.strictEqual(installation.status,'partial');
assert.strictEqual(installation.stages.publicApi,'implemented');
assert.strictEqual(installation.stages.validator,'implemented');
assert.strictEqual(installation.stages.contractTest,'implemented');
assert.strictEqual(installation.stages.runtime,'partial');
assert.strictEqual(installation.stages.diagnostics,'implemented');

var initialization=sql.productCoverage.area('lifecycle.initialization');
assert.strictEqual(initialization.status,'partial');
assert.strictEqual(initialization.stages.publicApi,'implemented');
assert.strictEqual(initialization.stages.validator,'implemented');
assert.strictEqual(initialization.stages.contractTest,'implemented');
assert.strictEqual(initialization.stages.runtime,'partial');
assert.strictEqual(initialization.stages.diagnostics,'implemented');

var engineUpgrade=sql.productCoverage.area('lifecycle.engine-upgrade');
assert.strictEqual(engineUpgrade.status,'gap');

var retirement=sql.productCoverage.area('lifecycle.retirement');
assert.strictEqual(retirement.status,'gap');

var jobs=sql.productCoverage.area('automation.jobs');
assert.strictEqual(jobs.status,'gap');
assert.strictEqual(jobs.stages.documentation,'implemented');
assert.ok(jobs.evidence.includes('docs/strategy/DATABASE-JOB-ARCHITECTURE.md'));

var gaps=sql.productCoverage.gaps();
assert.strictEqual(gaps.some(function(area){return area.id==='platform.schema-diff';}),false);
assert.strictEqual(gaps.some(function(area){return area.id==='platform.migrations';}),false);
assert.ok(gaps.some(function(area){return area.id==='dialect.sqlserver-parity';}));
['lifecycle.installation','lifecycle.initialization','lifecycle.engine-upgrade','administration.bootstrap','administration.configuration','administration.security','operations.backup-recovery','operations.replication-ha','operations.capacity-storage','operations.upgrade-readiness','lifecycle.retirement'].forEach(function(id){
  assert.ok(gaps.some(function(area){return area.id===id;}),'expected lifecycle gap '+id);
});

var impl=sql.capabilityOntology.implementation('statements.select');
['parser','ast','validator','renderer','rewrite','runtime','introspection','diagnostics','contractTest','liveQualification','packagedPublic','documentation'].forEach(function(stage){
  assert.ok(Object.prototype.hasOwnProperty.call(impl.stages,stage),'missing ontology stage '+stage);
});
assert.strictEqual(impl.stages.contractTest,'implemented');
assert.strictEqual(impl.stages.liveQualification,'implemented');
assert.strictEqual(impl.stages.packagedPublic,'implemented');
assert.strictEqual(impl.stages.documentation,'implemented');

console.log('NuBloxSQL product coverage model v2 contract: PASS');
