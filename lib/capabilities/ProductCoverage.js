'use strict';

var SCHEMA_VERSION=2;
var STAGES=Object.freeze([
  'publicApi','parser','ast','validator','renderer','rewrite','runtime',
  'introspection','diagnostics','contractTest','liveQualification','packagedPublic','documentation'
]);
var LEVELS=Object.freeze(['implemented','partial','unsupported','not-applicable']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}
function stages(values){
  var result={};
  STAGES.forEach(function(stage){result[stage]=values[stage]||'not-applicable';});
  return freeze(result);
}
function area(id,pillar,status,values,dialects,evidence,next){
  return freeze({
    id:id,
    pillar:pillar,
    status:status,
    stages:stages(values),
    dialects:freeze(Object.assign({postgresql:'not-applicable',mysql:'not-applicable',sqlite:'not-applicable',sqlserver:'not-applicable'},dialects||{})),
    evidence:freeze((evidence||[]).slice()),
    next:next||null
  });
}

var AREAS=freeze([
  area('runtime.client','runtime','strong',{
    publicApi:'implemented',runtime:'implemented',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'implemented'},[
    'test/client-api.js','test/client-lifecycle.js','docs/guides/01-getting-started.md','docs/guides/02-connections-and-pooling.md'
  ]),
  area('runtime.transactions','runtime','established',{
    publicApi:'implemented',runtime:'implemented',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'implemented'},[
    'test/client-transactions.js','test/transaction-policy.js','docs/guides/05-transactions.md'
  ],'Integrate transaction/isolation semantics more deeply with the capability ontology and future TCL compiler.'),
  area('runtime.streaming-control','runtime','strong',{
    publicApi:'implemented',runtime:'implemented',diagnostics:'partial',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'partial',sqlserver:'implemented'},[
    'test/operation-control.js','lib/dialects/mysql/test/streaming.js','lib/dialects/postgresql/test/portal.js','lib/dialects/sqlserver/test/incremental-stream.js','docs/guides/06-streaming-and-operation-control.md'
  ]),
  area('language.query','language','established',{
    publicApi:'implemented',parser:'implemented',ast:'implemented',validator:'partial',renderer:'implemented',rewrite:'partial',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'unsupported'},[
    'test/sql-ast-compiler.js','test/sql-ast-wave3.js','test/compiler-query-live.js','docs/API.md'
  ],'Broaden query-family coverage before returning to narrow statement grammar.'),
  area('language.dml','language','strong',{
    publicApi:'implemented',parser:'implemented',ast:'implemented',validator:'partial',renderer:'implemented',rewrite:'partial',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'unsupported'},[
    'test/sql-ast-wave4.js','test/sql-ast-wave6-merge-rich-source.js','docs/API.md'
  ],'Pause isolated DML waves until higher-priority platform gaps are addressed.'),
  area('language.ddl','language','strong',{
    publicApi:'implemented',parser:'implemented',ast:'implemented',validator:'implemented',renderer:'implemented',rewrite:'partial',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'unsupported'},[
    'test/sql-ast-wave5.js','test/sql-ast-wave5-identity-sequence.js','docs/guides/14-ddl-compiler.md'
  ],'Broaden object families after schema-diff/migration foundations are in place.'),
  area('intelligence.metadata','intelligence','strong',{
    publicApi:'implemented',runtime:'implemented',introspection:'implemented',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'partial'},[
    'test/metadata-introspection.js','test/portable-metadata-vocabulary.js','lib/dialects/postgresql/test/deep-metadata.js','lib/dialects/mysql/test/deep-metadata.js','docs/guides/07-metadata-and-introspection.md'
  ],'Close SQL Server portable metadata parity.'),
  area('intelligence.structure-tree','intelligence','established',{
    publicApi:'implemented',runtime:'implemented',introspection:'implemented',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'partial'},[
    'lib/client/StructureTree.js','test/database-structure-tree.js','docs/strategy/COMPETITIVE-BENCHMARK.md'
  ],'Add object descriptions and richer object families to the canonical structure model.'),
  area('intelligence.dependencies','intelligence','established',{
    publicApi:'implemented',runtime:'implemented',introspection:'implemented',diagnostics:'partial',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'partial'},[
    'lib/client/ObjectIdentity.js','lib/client/DependencyGraph.js','test/object-identity-dependency-graph.js','docs/guides/07-metadata-and-introspection.md'
  ],'Expand beyond foreign-key/structural dependencies to views, routines, triggers, sequences and vendor-native dependency evidence.'),
  area('intelligence.diagnostics','intelligence','strong',{
    publicApi:'implemented',runtime:'implemented',diagnostics:'implemented',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'partial'},[
    'test/client-diagnostics.js','lib/dialects/postgresql/test/diagnostics.js','lib/dialects/mysql/test/diagnostics.js','lib/dialects/sqlite/test/query-diagnostics.js'
  ],'Bring SQL Server into the shared portable diagnostics contract.'),
  area('portability.ontology','portability','strong',{
    publicApi:'implemented',rewrite:'implemented',runtime:'implemented',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'unsupported'},[
    'test/sql-capability-ontology.js','test/sql-capability-runtime.js','docs/guides/11-capabilities-and-portability.md'
  ],'Promote SQL Server into the common ontology and compatibility model.'),
  area('portability.rewrite','portability','established',{
    publicApi:'implemented',validator:'partial',rewrite:'implemented',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'unsupported'},[
    'test/sql-capability-rewrite.js','docs/guides/11-capabilities-and-portability.md'
  ],'Develop broader semantic transformation architecture and explicit lossiness policy.'),
  area('platform.types','platform','established',{
    publicApi:'implemented',runtime:'implemented',introspection:'partial',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'partial',mysql:'partial',sqlite:'partial',sqlserver:'partial'},[
    'lib/client/TypeSemantics.js','test/canonical-type-semantics.js','docs/guides/15-canonical-type-semantics.md','test/client-typed-binds.js','test/client-types.js','lib/dialects/postgresql/test/type-decoding.js','lib/dialects/sqlserver/test/type-fidelity.js'
  ],'Expand canonical type semantics into arrays, spatial/range/domain/enum/user-defined families and deeper metadata-driven precision/length evidence.'),
  area('platform.schema-snapshot','platform','established',{
    publicApi:'implemented',runtime:'implemented',introspection:'implemented',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'partial'},[
    'lib/client/SchemaSnapshot.js','test/canonical-schema-snapshot.js','docs/guides/16-canonical-schema-snapshots.md'
  ],'Use canonical snapshots as the source model for schema diff and migration planning; expand richer vendor object families as metadata coverage grows.'),
  area('platform.schema-diff','platform','established',{
    publicApi:'implemented',introspection:'implemented',validator:'implemented',renderer:'not-applicable',rewrite:'not-applicable',runtime:'not-applicable',diagnostics:'partial',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'partial'},[
    'lib/client/SchemaDiff.js','test/canonical-schema-diff.js','docs/guides/17-canonical-schema-diff.md'
  ],'Add rename inference, richer vendor object families and migration-plan generation on top of the safety-classified change model.'),
  area('platform.migrations','platform','established',{
    publicApi:'implemented',validator:'implemented',renderer:'partial',rewrite:'not-applicable',runtime:'not-applicable',diagnostics:'partial',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'partial',sqlite:'partial',sqlserver:'partial'},[
    'lib/client/MigrationPlanner.js','test/migration-planner.js','docs/guides/18-migration-planner.md'
  ],'Expand automatic DDL coverage, add runtime/version qualification, data-backfill orchestration and an execution/checkpoint layer.'),
  area('platform.migration-execution','platform','established',{
    publicApi:'implemented',validator:'implemented',renderer:'not-applicable',rewrite:'not-applicable',runtime:'implemented',diagnostics:'implemented',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'implemented'},[
    'lib/client/MigrationExecutor.js','test/migration-executor.js','docs/guides/19-migration-execution-engine.md'
  ],'Persist checkpoints/audit logs through generic job infrastructure, add distributed lock policies, richer live migration qualification and orchestration for data backfills.'),
  area('platform.data-movement','platform','established',{
    publicApi:'implemented',runtime:'implemented',introspection:'not-applicable',diagnostics:'implemented',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'implemented',mysql:'implemented',sqlite:'implemented',sqlserver:'implemented'},[
    'lib/client/DataMovement.js','lib/client/DataMovementPlanner.js','test/data-movement.js','test/data-movement-planner.js','docs/guides/20-data-movement.md','lib/dialects/postgresql/test/copy-protocol.js','lib/dialects/mysql/test/local-infile.js'
  ],'Native PostgreSQL COPY and explicitly opted-in MySQL LOCAL INFILE now accelerate qualified batches beneath the stable API. Next: live large-transfer qualification, SQL Server bulk-writer promotion, SQLite prepared-write tuning and durable external checkpoint storage through future job infrastructure.'),
  area('tooling.sql','platform','partial',{
    publicApi:'partial',parser:'implemented',ast:'implemented',validator:'partial',renderer:'implemented',rewrite:'partial',diagnostics:'partial',contractTest:'implemented',liveQualification:'partial',packagedPublic:'implemented',documentation:'partial'
  },{postgresql:'partial',mysql:'partial',sqlite:'partial',sqlserver:'partial'},[
    'lib/capabilities/Tokenizer.js','lib/capabilities/Parser.js','lib/capabilities/Compiler.js','docs/strategy/COMPETITIVE-BENCHMARK.md'
  ],'Add formatter, linter, editor diagnostics and metadata-aware completion primitives.'),
  area('automation.jobs','platform','gap',{
    publicApi:'unsupported',runtime:'unsupported',diagnostics:'unsupported',contractTest:'unsupported',liveQualification:'unsupported',packagedPublic:'unsupported',documentation:'partial'
  },{},['docs/strategy/COMPETITIVE-BENCHMARK.md'],'Define reusable database job plans, logging, resumability and CLI execution contracts.'),
  area('reporting.export','platform','gap',{
    publicApi:'unsupported',runtime:'unsupported',validator:'unsupported',renderer:'unsupported',contractTest:'unsupported',liveQualification:'unsupported',packagedPublic:'unsupported',documentation:'partial'
  },{},['docs/strategy/COMPETITIVE-BENCHMARK.md'],'Define dataset/report/export contracts after data-movement foundations are stable.'),
  area('dialect.sqlserver-parity','dialect-depth','partial',{
    publicApi:'implemented',runtime:'implemented',introspection:'partial',diagnostics:'partial',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{sqlserver:'partial'},[
    'lib/dialects/sqlserver/test/capability-honesty.js','lib/dialects/sqlserver/test/type-fidelity.js','docs/SUPPORT.md'
  ],'Promote SQL Server toward Tier 1 ontology, metadata and diagnostics parity.')
]);

function areaById(id){
  if(typeof id!=='string'||!id.trim())throw new TypeError('Product coverage area id must be a non-empty string');
  id=id.trim();
  for(var i=0;i<AREAS.length;i+=1)if(AREAS[i].id===id)return AREAS[i];
  return null;
}
function summarize(list){
  var summary={total:list.length,strong:0,established:0,partial:0,gap:0};
  list.forEach(function(entry){if(Object.prototype.hasOwnProperty.call(summary,entry.status))summary[entry.status]+=1;});
  return freeze(summary);
}
function report(){
  var pillars={};
  AREAS.forEach(function(entry){
    if(!pillars[entry.pillar])pillars[entry.pillar]=[];
    pillars[entry.pillar].push(entry);
  });
  Object.keys(pillars).forEach(function(key){pillars[key]=freeze(pillars[key].slice());});
  return freeze({schemaVersion:SCHEMA_VERSION,summary:summarize(AREAS),pillars:freeze(pillars),areas:AREAS});
}
function gaps(){
  return freeze(AREAS.filter(function(entry){return entry.status==='gap'||entry.status==='partial';}));
}
function validate(){
  var ids=Object.create(null);
  AREAS.forEach(function(entry){
    if(ids[entry.id])throw new Error('Duplicate product coverage area: '+entry.id);
    ids[entry.id]=true;
    if(['strong','established','partial','gap'].indexOf(entry.status)<0)throw new Error('Invalid product coverage status: '+entry.status);
    STAGES.forEach(function(stage){
      if(LEVELS.indexOf(entry.stages[stage])<0)throw new Error('Invalid product coverage stage '+entry.id+': '+stage);
    });
  });
  return freeze({valid:true,schemaVersion:SCHEMA_VERSION,areas:AREAS.length});
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.STAGES=STAGES;
exports.LEVELS=LEVELS;
exports.areas=AREAS;
exports.area=areaById;
exports.report=report;
exports.gaps=gaps;
exports.validate=validate;
