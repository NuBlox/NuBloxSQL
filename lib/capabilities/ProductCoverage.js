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
  area('platform.types','platform','partial',{
    publicApi:'implemented',runtime:'implemented',introspection:'partial',contractTest:'implemented',liveQualification:'implemented',packagedPublic:'implemented',documentation:'implemented'
  },{postgresql:'partial',mysql:'partial',sqlite:'partial',sqlserver:'partial'},[
    'test/client-typed-binds.js','test/client-types.js','lib/dialects/postgresql/test/type-decoding.js','lib/dialects/sqlserver/test/type-fidelity.js'
  ],'Build canonical cross-dialect type semantics and mapping decisions.'),
  area('platform.schema-diff','platform','gap',{
    publicApi:'unsupported',introspection:'partial',validator:'unsupported',renderer:'unsupported',rewrite:'unsupported',contractTest:'unsupported',liveQualification:'unsupported',packagedPublic:'unsupported',documentation:'partial'
  },{},['docs/strategy/STRATEGIC-ROADMAP.md'],'Build canonical schema diff model from metadata plus DDL AST.'),
  area('platform.migrations','platform','gap',{
    publicApi:'unsupported',validator:'unsupported',renderer:'unsupported',rewrite:'unsupported',runtime:'unsupported',contractTest:'unsupported',liveQualification:'unsupported',packagedPublic:'unsupported',documentation:'partial'
  },{},['docs/strategy/STRATEGIC-ROADMAP.md'],'Build safety-classified migration planner after canonical type and schema-diff foundations.'),
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
