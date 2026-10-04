'use strict';

var core = require('./Model');
var rawModels = {
  postgresql: require('./tier1/postgresql'),
  mysql: require('./tier1/mysql'),
  sqlite: require('./tier1/sqlite')
};
var policyModels = require('./ModelPolicy').apply(core, rawModels);
var advancedModels = require('./DdlAdvancedModelPolicy').apply(core, policyModels);
var foreignKeyModels = require('./DdlForeignKeyModelPolicy').apply(core, advancedModels);
var indexModels = require('./DdlIndexModelPolicy').apply(core, foreignKeyModels);
var identitySequenceModels = require('./DdlIdentitySequenceModelPolicy').apply(core, indexModels);
var models = require('./DmlAdvancedModelPolicy').apply(core, identitySequenceModels);

function normalizeDialect(dialect) {
  if (typeof dialect !== 'string' || dialect.trim().length === 0) throw new TypeError('SQL capability model requires a dialect');
  var value = dialect.trim().toLowerCase();
  if (value === 'postgres' || value === 'pg') value = 'postgresql';
  if (!Object.prototype.hasOwnProperty.call(models, value)) throw new RangeError('SQL capability model currently supports Tier-1 dialects: postgresql, mysql, sqlite');
  return value;
}

function dialect(dialectName) { return models[normalizeDialect(dialectName)]; }
function get(dialectName, path) { return core.getPath(dialect(dialectName), path); }
function supports(dialectName, path) { var value = get(dialectName, path); return core.isFeature(value) ? value.supported === true : false; }
function status(dialectName, path) { var value = get(dialectName, path); return core.isFeature(value) ? value : null; }

function compare(path, dialectNames) {
  var names = dialectNames === undefined ? core.TIER1_DIALECTS : dialectNames;
  if (!Array.isArray(names) || names.length === 0) throw new TypeError('SQL capability comparison requires at least one dialect');
  var result = {};
  var portable = true;
  var determinate = true;
  names.forEach(function (name) {
    var normalized = normalizeDialect(name);
    var entry = status(normalized, path);
    result[normalized] = entry;
    if (!entry || entry.supported !== true) portable = false;
    if (!entry || entry.supported === null) determinate = false;
  });
  return core.deepFreeze({ path: path, dialects: result, portable: portable, determinate: determinate });
}

var compatibilityApi = require('./Compatibility').create(core, normalizeDialect, models);
var runtimeApi = require('./RuntimeQualification').create(core, normalizeDialect, models);
var rewriteApi = require('./Rewrite').create(core, normalizeDialect, models);
var astBaseApi = require('./AstPipeline').create(core, normalizeDialect, rewriteApi);
var astPolicyApi = require('./AstPolicy').create(astBaseApi, normalizeDialect, rewriteApi);
var dmlApi = require('./DmlPipeline').create(astPolicyApi, normalizeDialect, rewriteApi);
var dmlSemanticApi = require('./DmlSemanticPipeline').create(dmlApi, normalizeDialect, rewriteApi);
var dmlPolicyApi = require('./DmlPolicy').create(dmlSemanticApi);
var dmlAdvancedApi = require('./DmlAdvancedPipeline').create(dmlPolicyApi, normalizeDialect, rewriteApi);
var dmlSourceCompositionApi = require('./DmlSourceCompositionPipeline').create(dmlAdvancedApi, normalizeDialect, rewriteApi);
var dmlMysqlMultiTableApi = require('./DmlMysqlMultiTablePipeline').create(dmlSourceCompositionApi, normalizeDialect, rewriteApi);
var dmlMysqlMutationControlApi = require('./DmlMysqlMutationControlPipeline').create(dmlMysqlMultiTableApi, normalizeDialect, rewriteApi);
var ddlApi = require('./DdlPipeline').create(dmlMysqlMutationControlApi, normalizeDialect, rewriteApi);
var ddlLifecycleApi = require('./DdlLifecyclePipeline').create(ddlApi, normalizeDialect, rewriteApi);
var ddlColumnConstraintApi = require('./DdlColumnConstraintPipeline').create(ddlLifecycleApi, normalizeDialect, rewriteApi);
var ddlObjectLifecycleApi = require('./DdlObjectLifecyclePipeline').create(ddlColumnConstraintApi, normalizeDialect, rewriteApi);
var ddlDependencyConcurrentApi = require('./DdlDependencyConcurrentPipeline').create(ddlObjectLifecycleApi, normalizeDialect, rewriteApi);
var ddlGeneratedIdentityApi = require('./DdlGeneratedIdentityPipeline').create(ddlDependencyConcurrentApi, normalizeDialect, rewriteApi);
var ddlForeignKeyApi = require('./DdlForeignKeyPipeline').create(ddlGeneratedIdentityApi, normalizeDialect, rewriteApi);
var ddlIndexApi = require('./DdlIndexSemanticsPipeline').create(ddlForeignKeyApi, normalizeDialect, rewriteApi);
var ddlCreateTableAsApi = require('./DdlCreateTableAsPipeline').create(ddlIndexApi, normalizeDialect, rewriteApi);
var astApi = require('./DdlIdentitySequencePipeline').create(ddlCreateTableAsApi, normalizeDialect, rewriteApi);
var ontologyBaseApi = require('./Ontology').create(core, normalizeDialect, models);
var ontologyApi = require('./OntologyPolicy').create(ontologyBaseApi);

var api = Object.freeze({
  schemaVersion: core.SCHEMA_VERSION,
  tier1Dialects: core.TIER1_DIALECTS,
  categories: core.CATEGORIES,
  supportLevels: core.SUPPORT_LEVELS,
  ontology: ontologyApi,
  dialect: dialect,
  get: get,
  status: status,
  supports: supports,
  compare: compare,
  compatibility: compatibilityApi.compatibility,
  paths: compatibilityApi.paths,
  compareCategory: compatibilityApi.compareCategory,
  matrix: compatibilityApi.matrix,
  migrationSurface: compatibilityApi.migrationSurface,
  compareDialects: compatibilityApi.compareDialects,
  qualify: runtimeApi.qualify,
  qualifyClient: runtimeApi.qualifyClient,
  compareVersion: runtimeApi.compareVersion,
  rewriteDecision: rewriteApi.decision,
  planRewrite: rewriteApi.plan,
  rewriteSql: rewriteApi.rewriteSql,
  parseSql: astApi.parseSql,
  analyzeAst: astApi.analyzeAst,
  compileAst: astApi.compileAst,
  transpileSql: astApi.transpileSql
});

exports.api = api;
exports.models = models;
exports.ontology = ontologyApi;
exports.normalizeDialect = normalizeDialect;
