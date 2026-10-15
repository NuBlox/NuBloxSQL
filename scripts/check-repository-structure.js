'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var root=path.resolve(__dirname,'..');

function exists(relative){return fs.existsSync(path.join(root,relative));}

[
  'apps/shell',
  'docs/architecture',
  'docs/cookbook',
  'docs/guides',
  'docs/product',
  'docs/releases',
  'lib/capabilities',
  'lib/client',
  'lib/core',
  'lib/dialects',
  'lib/lifecycle',
  'lib/jobs',
  'scripts',
  'test',
  'types'
].forEach(function(relative){
  assert(exists(relative),'required repository path missing: '+relative);
});

[
  'packages',
  'shell',
  'tool',
  'docs/strategy',
  'docs/archive',
  'docs/releases/product-lifecycle-v1.json',
  '.eslintrc',
  '.eslintignore'
].forEach(function(relative){
  assert.strictEqual(exists(relative),false,'obsolete repository path must not exist: '+relative);
});

[
  'docs/product/BLUEPRINT.md',
  'docs/product/CAPABILITY-REGISTER.md',
  'docs/product/ROADMAP.md',
  'docs/architecture/DATABASE-LIFECYCLE.md',
  'docs/architecture/DATABASE-JOBS.md',
  'docs/architecture/REPOSITORY-STRUCTURE.md',
  'apps/shell/package.json',
  'scripts/suites/platform.json',
  'scripts/suites/release.json'
].forEach(function(relative){
  assert(exists(relative),'repository authority file missing: '+relative);
});

var pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.strictEqual(pkg.scripts['test:platform'],'node scripts/run-suite.js scripts/suites/platform.json');
assert.strictEqual(pkg.scripts['release:qualify'],'node scripts/run-suite.js scripts/suites/release.json');

// Prevent release-checker sprawl and stale qualification evidence.
var suite = JSON.parse(fs.readFileSync(path.join(root,'scripts/suites/release.json'),'utf8'));
var evidence = JSON.parse(fs.readFileSync(path.join(root,'docs/releases/tier1-stable-evidence.json'),'utf8'));
var languageQualifiers = [];
for (var ddlVersion=1;ddlVersion<=11;ddlVersion++) {
  languageQualifiers.push('ddl/check-ddl-v'+ddlVersion+'-release.js');
}
for (var dmlVersion=2;dmlVersion<=10;dmlVersion++) {
  languageQualifiers.push('dml/check-dml-v'+dmlVersion+'-release.js');
}
assert.strictEqual(languageQualifiers.length,20);
languageQualifiers.forEach(function(relative){
  var basename=path.basename(relative);
  var full='scripts/release/'+relative;
  assert(exists(full),'grouped SQL release checker missing: '+full);
  assert.strictEqual(exists('scripts/'+basename),false,
    'obsolete flat SQL release checker must not exist: scripts/'+basename);
  assert(suite.steps.includes(full),'release suite missing grouped SQL checker: '+full);
  assert(evidence.sharedRequiredFiles.includes(full),'Tier-1 evidence missing grouped SQL checker: '+full);
});
assert.strictEqual(suite.steps.filter(function(step){
  return step.startsWith('scripts/release/ddl/') || step.startsWith('scripts/release/dml/');
}).length,languageQualifiers.length,'unexpected SQL checker duplication in release suite');
for (var file of fs.readdirSync(path.join(root,'scripts'))) {
  if ((file.startsWith('check-ddl-v') || file.startsWith('check-dml-v')) &&
      file.endsWith('-release.js')) {
    assert.fail('flat SQL release checker is not permitted: scripts/'+file);
  }
}
// SQL language files are grouped by semantic responsibility; reject the
// previous flat hierarchy and ensure every pipeline is still loadable.
var ddlModules=['DdlAdvancedModelPolicy','DdlColumnConstraintPipeline','DdlCreateTableAsPipeline','DdlDependencyConcurrentPipeline','DdlForeignKeyModelPolicy','DdlForeignKeyPipeline','DdlGeneratedIdentityPipeline','DdlIdentitySequenceModelPolicy','DdlIdentitySequencePipeline','DdlIndexModelPolicy','DdlIndexSemanticsPipeline','DdlLifecyclePipeline','DdlObjectLifecyclePipeline','DdlPipeline','ForeignKeySemantics'];
var dmlModules=['DmlAdvancedModelPolicy','DmlAdvancedPipeline','DmlMergeActionsPipeline','DmlMergeModelPolicy','DmlMysqlMultiTablePipeline','DmlMysqlMutationControlPipeline','DmlPipeline','DmlPolicy','DmlSemanticPipeline','DmlSourceCompositionPipeline'];
[['ddl',ddlModules],['dml',dmlModules]].forEach(function(group){
  group[1].forEach(function(name){
    var modulePath='lib/capabilities/'+group[0]+'/'+name+'.js';
    assert(exists(modulePath),'SQL language module is missing: '+modulePath);
    assert.strictEqual(exists('lib/capabilities/'+name+'.js'),false,
      'legacy flat SQL language module must not exist: '+name);
  });
});
fs.readdirSync(path.join(root,'lib/capabilities')).forEach(function(name){
  assert(!((name.startsWith('Ddl')||name.startsWith('Dml')||
    name==='ForeignKeySemantics.js')&&name.endsWith('.js')),
    'SQL DDL/DML modules belong in language subdirectories: '+name);
});
// Native read-only metadata services are discovery-owned, not flat client files.
['MySQLSecurityMetadataIntegration','SqlServerMetadataIntegration'].forEach(function(name){
  var grouped='lib/client/discovery/'+name+'.js';
  assert(exists(grouped),'discovery-owned metadata integration missing: '+grouped);
  assert.strictEqual(exists('lib/client/'+name+'.js'),false,
    'vendor metadata discovery integration must not be in flat client root: '+name);
});
console.log('NuBloxSQL repository structure: PASS');
