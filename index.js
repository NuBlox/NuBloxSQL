'use strict';

var clientApi = require('./lib/client/Client');
var sqlApi = require('./lib/client/Sql');
var errorApi = require('./lib/client/Error');
var publicErrorApi = require('./lib/client/PublicError');
var streamApi = require('./lib/client/Stream');
var metadataApi = require('./lib/client/Metadata');
var observabilityApi = require('./lib/client/Observability');
var typesApi = require('./lib/client/Types');
var connectionUrlApi = require('./lib/client/ConnectionUrl');
var lifecycleApi = require('./lib/client/LifecycleIntegration');
var configurationApi = require('./lib/client/Configuration');
var capabilitiesApi = require('./lib/client/Capabilities');
var capabilityModelApi = require('./lib/capabilities');
var databaseTechnologyApi = require('./lib/catalog/DatabaseTechnologyRegistry');
var cloudDatabaseApi = require('./lib/catalog/CloudDatabaseRegistry');
var nativeNonSqlApi = require('./lib/runtime/NonSqlAdapterRouter');
var metadataIntegrationApi = require('./lib/client/MetadataIntegration');
var transactionPolicyApi = require('./lib/client/TransactionPolicy');
var diagnosticsApi = require('./lib/client/Diagnostics');
var structureTreeApi = require('./lib/client/StructureTree');
var typeSemanticsApi = require('./lib/client/TypeSemantics');
var objectIdentityApi = require('./lib/client/engineering/ObjectIdentity');
var dependencyGraphApi = require('./lib/client/engineering/DependencyGraph');
var schemaSnapshotApi = require('./lib/client/engineering/SchemaSnapshot');
var schemaDiffApi = require('./lib/client/engineering/SchemaDiff');
var migrationPlannerApi = require('./lib/client/engineering/MigrationPlanner');
var migrationExecutorApi = require('./lib/client/engineering/MigrationExecutor');
var dataMovementApi = require('./lib/client/engineering/DataMovement');
var databaseBootstrapPlannerApi = require('./lib/client/administration/DatabaseBootstrapPlanner');
var databaseBootstrapExecutorApi = require('./lib/client/administration/DatabaseBootstrapExecutor');
var databaseServerDiscoveryApi = require('./lib/client/discovery/DatabaseServerDiscovery');
var databaseConfigurationApi = require('./lib/client/administration/DatabaseConfiguration');
var databaseSecurityDiscoveryApi = require('./lib/client/discovery/DatabaseSecurityDiscovery');
var nativeJobDiscoveryApi = require('./lib/client/discovery/DatabaseNativeJobDiscovery');
var databaseConfigurationPlannerApi = require('./lib/client/administration/DatabaseConfigurationPlanner');
var databaseConfigurationExecutorApi = require('./lib/client/administration/DatabaseConfigurationExecutor');
var engineLifecycleApi = require('./lib/lifecycle/EngineLifecycle');
var installationProviderApi = require('./lib/lifecycle/InstallationProvider');
var engineInstallationPlannerApi = require('./lib/lifecycle/EngineInstallationPlanner');
var engineInitializationPlannerApi = require('./lib/lifecycle/EngineInitializationPlanner');
var engineLifecycleExecutorApi = require('./lib/lifecycle/EngineLifecycleExecutor');
var localHostInstallationProviderApi = require('./lib/lifecycle/LocalHostInstallationProvider');
var engineInstallationPrerequisitesApi = require('./lib/lifecycle/EngineInstallationPrerequisites');
streamApi.install(clientApi);
require('./lib/client/SqlServerStreamIntegration').install(streamApi);
diagnosticsApi.install(clientApi);
require('./lib/client/OperationControlIntegration').install(clientApi);
require('./lib/client/ErrorIntegration').install(clientApi);
observabilityApi.install(clientApi, streamApi);
require('./lib/client/TypesIntegration').install(clientApi, streamApi);
require('./lib/client/TransactionIntegration').install(clientApi);
require('./lib/client/discovery/SqlServerMetadataIntegration').install(metadataApi);
require('./lib/client/SQLiteAdvancedMetadataIntegration').install(metadataApi);
metadataIntegrationApi.install(clientApi, metadataApi);
lifecycleApi.install(clientApi);
capabilitiesApi.install(clientApi);
observabilityApi.install(clientApi, streamApi);

var router = require('./lib/runtime/SqlAdapterRouter').create({
  loaders: {
    mysql: function () { return require('./lib/dialects/mysql'); },
    postgresql: function () { return require('./lib/dialects/postgresql'); },
    sqlite: function () { return require('./lib/dialects/sqlite'); },
    sqlserver: function () { return require('./lib/dialects/sqlserver'); }
  },
  connectionUrl: connectionUrlApi,
  errors: publicErrorApi
});
var DIALECTS = router.DIALECTS;
var normalizeDialect = router.normalizeDialect;
var loadAdapter = router.loadAdapter;
var resolveInvocation = router.resolveInvocation;

function adapter(dialect) { return loadAdapter(dialect); }
function createConnection(dialectOrConfig, maybeConfig) { var invocation = resolveInvocation(dialectOrConfig, maybeConfig); configurationApi.validateConnectionConfig(invocation.dialect, invocation.config); return invocation.adapter.createConnection(invocation.config); }
function createPool(dialectOrConfig, maybeConfig) { var invocation = resolveInvocation(dialectOrConfig, maybeConfig); if (typeof invocation.adapter.createPool !== 'function') throw errorApi.unsupportedError(invocation.dialect, 'connection pools'); configurationApi.validatePoolConfig(invocation.dialect, invocation.config); return invocation.adapter.createPool(invocation.config); }
function hideClientOption(config, name, validate) { var value = config[name]; if (value === undefined) return; if (validate) validate(value); Object.defineProperty(config, name, { value: value, enumerable: false, configurable: false, writable: false }); }
function createClient(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);
  hideClientOption(invocation.config, 'telemetry', function (telemetry) { if (telemetry === null || typeof telemetry !== 'object' || Array.isArray(telemetry)) throw publicErrorApi.configurationError('telemetry must be an options object', invocation.dialect); });
  hideClientOption(invocation.config, 'types', function (types) { if (types === null || typeof types !== 'object' || Array.isArray(types)) throw publicErrorApi.configurationError('types must be an options object', invocation.dialect); });
  configurationApi.validateClientConfig(invocation.dialect, invocation.config, typeof invocation.adapter.createPool === 'function');
  return new clientApi.Client(invocation.adapter, invocation.dialect, invocation.config);
}
async function introspect(dialectOrConfig, maybeConfig, maybeOptions) {
  var client, options;
  if (typeof dialectOrConfig === 'string' && !connectionUrlApi.isUrlLike(dialectOrConfig)) { client = createClient(dialectOrConfig, maybeConfig); options = maybeOptions || {}; }
  else { client = createClient(dialectOrConfig); options = maybeConfig || {}; }
  try { return await client.introspect(options); }
  finally { await client.close(); }
}
async function structureTree(dialectOrConfig, maybeConfig, maybeOptions) {
  var client, options;
  if (typeof dialectOrConfig === 'string' && !connectionUrlApi.isUrlLike(dialectOrConfig)) { client = createClient(dialectOrConfig, maybeConfig); options = maybeOptions || {}; }
  else { client = createClient(dialectOrConfig); options = maybeConfig || {}; }
  try { return await client.structureTree(options); }
  finally { await client.close(); }
}
function buildStructureTree(snapshot, options) { return structureTreeApi.build(snapshot, options); }
async function dependencyGraph(dialectOrConfig, maybeConfig, maybeOptions) {
  var client, options;
  if (typeof dialectOrConfig === 'string' && !connectionUrlApi.isUrlLike(dialectOrConfig)) { client = createClient(dialectOrConfig, maybeConfig); options = maybeOptions || {}; }
  else { client = createClient(dialectOrConfig); options = maybeConfig || {}; }
  try { return await client.dependencyGraph(options); }
  finally { await client.close(); }
}
function buildDependencyGraph(snapshot) { return dependencyGraphApi.build(snapshot); }
function objectId(kind, metadata, context) { return objectIdentityApi.objectId(kind, metadata, context); }
function parseObjectId(id) { return objectIdentityApi.parse(id); }
function graphDependencies(graph, id, options) { return dependencyGraphApi.dependencies(graph, id, options); }
function graphDependents(graph, id, options) { return dependencyGraphApi.dependents(graph, id, options); }
function impactAnalysis(graph, id, options) { return dependencyGraphApi.impact(graph, id, options); }
async function schemaSnapshot(dialectOrConfig, maybeConfig, maybeOptions) {
  var client, options;
  if (typeof dialectOrConfig === 'string' && !connectionUrlApi.isUrlLike(dialectOrConfig)) { client = createClient(dialectOrConfig, maybeConfig); options = maybeOptions || {}; }
  else { client = createClient(dialectOrConfig); options = maybeConfig || {}; }
  try { return await client.schemaSnapshot(options); }
  finally { await client.close(); }
}
function buildSchemaSnapshot(snapshot) { return schemaSnapshotApi.build(snapshot); }
function schemaFingerprint(snapshot) { return schemaSnapshotApi.fingerprint(snapshot); }
function schemasEquivalent(left, right) { return schemaSnapshotApi.equivalent(left, right); }
function sourceSchemasEquivalent(left, right) { return schemaSnapshotApi.sourceEquivalent(left, right); }
function schemaLogicalKey(kind, parts) { return schemaSnapshotApi.logicalKey(kind, parts); }
function supports(dialect, capability) { var implementation = loadAdapter(dialect); var dialectDescriptor = implementation.descriptor; return !!(dialectDescriptor && typeof dialectDescriptor.supports === 'function' && dialectDescriptor.supports(capability)); }
function descriptor(dialect) { var implementation = loadAdapter(dialect); return implementation.descriptor || null; }
function capabilityReport(dialect) { var normalized = normalizeDialect(dialect); var implementation = loadAdapter(normalized); return capabilitiesApi.buildReport(normalized, implementation.descriptor || null, null, false); }
function transactionPolicy(dialect) { var normalized = normalizeDialect(dialect); var implementation = loadAdapter(normalized); return transactionPolicyApi.describe(normalized, implementation.descriptor || null); }
function defineLazy(target, name, loader) { Object.defineProperty(target, name, { enumerable: true, configurable: false, get: loader }); }

var dialects = {};
defineLazy(dialects, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(dialects, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(dialects, 'sqlite', function () { return loadAdapter('sqlite'); });
defineLazy(dialects, 'sqlserver', function () { return loadAdapter('sqlserver'); });
Object.freeze(dialects);

exports.DIALECTS = DIALECTS;
exports.CLIENT_LIFECYCLE_STATES = lifecycleApi.STATES;
exports.TRANSACTION_ISOLATION_LEVELS = transactionPolicyApi.ISOLATION_LEVELS;
exports.SQLITE_TRANSACTION_MODES = transactionPolicyApi.SQLITE_MODES;
exports.OBSERVABILITY_SCHEMA_VERSION = observabilityApi.EVENT_SCHEMA_VERSION;
exports.OBSERVABILITY_EVENT_TYPES = observabilityApi.EVENT_TYPES;
exports.QUERY_DIAGNOSTICS_SCHEMA_VERSION = diagnosticsApi.SCHEMA_VERSION;
exports.ERROR_CODES = publicErrorApi.CODES;
exports.SQL_CAPABILITY_MODEL_SCHEMA_VERSION = capabilityModelApi.api.schemaVersion;
exports.SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION = capabilityModelApi.api.ontology.schemaVersion;
exports.PRODUCT_COVERAGE_SCHEMA_VERSION = capabilityModelApi.api.productCoverage.SCHEMA_VERSION;
exports.DIALECT_REGISTRY_SCHEMA_VERSION = capabilityModelApi.api.dialectRegistry.SCHEMA_VERSION;
exports.DIALECT_REGISTRY_MASTER_PROFILE_COUNT = capabilityModelApi.api.dialectRegistry.MASTER_PROFILE_COUNT;
exports.PROFILE_CAPABILITY_OVERLAY_SCHEMA_VERSION = capabilityModelApi.api.profileCapabilities.SCHEMA_VERSION;
exports.PROFILE_CAPABILITY_CHANGE_TYPES = capabilityModelApi.api.profileCapabilities.CHANGE_TYPES;
exports.PROFILE_CAPABILITY_RESOLUTIONS = capabilityModelApi.api.profileCapabilities.RESOLUTIONS;
exports.PRIMARY_SQL_DIALECTS = capabilityModelApi.api.dialectRegistry.PRIMARY_DIALECTS;
exports.TIER1_DIALECTS = capabilityModelApi.api.tier1Dialects;
exports.SQL_CAPABILITY_CATEGORIES = capabilityModelApi.api.categories;
exports.SQL_CAPABILITY_SUPPORT_LEVELS = capabilityModelApi.api.supportLevels;
exports.capabilityModel = capabilityModelApi.api;
exports.capabilityOntology = capabilityModelApi.api.ontology;
exports.productCoverage = capabilityModelApi.api.productCoverage;
exports.dialectRegistry = capabilityModelApi.api.dialectRegistry;
exports.DATABASE_TECHNOLOGY_REGISTRY_SCHEMA_VERSION = databaseTechnologyApi.SCHEMA_VERSION;
exports.databaseTechnologyRegistry = databaseTechnologyApi;
exports.CLOUD_DATABASE_REGISTRY_SCHEMA_VERSION = cloudDatabaseApi.SCHEMA_VERSION;
exports.cloudDatabaseRegistry = cloudDatabaseApi;
exports.planCloudDatabaseConnection = cloudDatabaseApi.planConnection;
exports.createNativeConnection = nativeNonSqlApi.createNativeConnection;
exports.profileCapabilities = capabilityModelApi.api.profileCapabilities;
exports.dialects = dialects;
exports.adapter = adapter;
exports.descriptor = descriptor;
exports.supports = supports;
exports.capabilityReport = capabilityReport;
exports.transactionPolicy = transactionPolicy;
exports.createConnection = createConnection;
exports.createPool = createPool;
exports.createClient = createClient;
exports.introspect = introspect;
exports.structureTree = structureTree;
exports.buildStructureTree = buildStructureTree;
exports.STRUCTURE_TREE_SCHEMA_VERSION = structureTreeApi.SCHEMA_VERSION;
exports.TYPE_SEMANTICS_SCHEMA_VERSION = typeSemanticsApi.SCHEMA_VERSION;
exports.TYPE_MAPPING_DECISIONS = typeSemanticsApi.DECISIONS;
exports.typeSemantics = typeSemanticsApi;
exports.canonicalType = typeSemanticsApi.infer;
exports.nativeTypeMapping = typeSemanticsApi.target;
exports.typeCompatibility = typeSemanticsApi.compatibility;
exports.canonicalTypeFromPortableSpec = typeSemanticsApi.fromPortableSpec;
exports.annotateTypes = typeSemanticsApi.annotate;
exports.OBJECT_IDENTITY_SCHEMA_VERSION = objectIdentityApi.SCHEMA_VERSION;
exports.DEPENDENCY_GRAPH_SCHEMA_VERSION = dependencyGraphApi.SCHEMA_VERSION;
exports.objectId = objectId;
exports.parseObjectId = parseObjectId;
exports.dependencyGraph = dependencyGraph;
exports.buildDependencyGraph = buildDependencyGraph;
exports.graphDependencies = graphDependencies;
exports.graphDependents = graphDependents;
exports.impactAnalysis = impactAnalysis;
exports.SCHEMA_SNAPSHOT_SCHEMA_VERSION = schemaSnapshotApi.SCHEMA_VERSION;
exports.schemaSnapshot = schemaSnapshot;
exports.buildSchemaSnapshot = buildSchemaSnapshot;
exports.schemaFingerprint = schemaFingerprint;
exports.schemasEquivalent = schemasEquivalent;
exports.sourceSchemasEquivalent = sourceSchemasEquivalent;
exports.schemaLogicalKey = schemaLogicalKey;
exports.SCHEMA_DIFF_SCHEMA_VERSION = schemaDiffApi.SCHEMA_VERSION;
exports.SCHEMA_CHANGE_SAFETY = schemaDiffApi.SAFETY;
exports.diffSchemas = schemaDiffApi.compare;
exports.schemaDiffChanged = schemaDiffApi.changed;
exports.schemaDiffHighestSafety = schemaDiffApi.highestSafety;
exports.DATABASE_BOOTSTRAP_PLAN_SCHEMA_VERSION = databaseBootstrapPlannerApi.SCHEMA_VERSION;
exports.DATABASE_BOOTSTRAP_EXECUTION_MODES = databaseBootstrapPlannerApi.EXECUTION;
exports.DATABASE_BOOTSTRAP_SCOPES = databaseBootstrapPlannerApi.SCOPES;
exports.DATABASE_BOOTSTRAP_EXECUTION_SCHEMA_VERSION = databaseBootstrapExecutorApi.SCHEMA_VERSION;
exports.DATABASE_BOOTSTRAP_STATUSES = databaseBootstrapExecutorApi.STATUSES;
exports.DATABASE_SERVER_DISCOVERY_SCHEMA_VERSION = databaseServerDiscoveryApi.SCHEMA_VERSION;
exports.DATABASE_BOOTSTRAP_PREREQUISITE_SCHEMA_VERSION = databaseServerDiscoveryApi.PREREQUISITE_SCHEMA_VERSION;
exports.DATABASE_BOOTSTRAP_PREREQUISITE_STATUSES = databaseServerDiscoveryApi.PREREQUISITE_STATUSES;
exports.DATABASE_SECURITY_DISCOVERY_SCHEMA_VERSION = databaseSecurityDiscoveryApi.SCHEMA_VERSION;
exports.NATIVE_DATABASE_JOB_DISCOVERY_SCHEMA_VERSION = nativeJobDiscoveryApi.SCHEMA_VERSION;
exports.DATABASE_CONFIGURATION_DISCOVERY_SCHEMA_VERSION = databaseConfigurationApi.SCHEMA_VERSION;
exports.DATABASE_CONFIGURATION_APPLY_MODES = databaseConfigurationApi.APPLY_MODES;
exports.DATABASE_CONFIGURATION_SCOPES = databaseConfigurationApi.SCOPES;
exports.DATABASE_CONFIGURATION_PLAN_SCHEMA_VERSION = databaseConfigurationPlannerApi.SCHEMA_VERSION;
exports.DATABASE_CONFIGURATION_PLAN_EXECUTION_MODES = databaseConfigurationPlannerApi.EXECUTION;
exports.DATABASE_CONFIGURATION_PLAN_ACTIONS = databaseConfigurationPlannerApi.ACTIONS;
exports.DATABASE_CONFIGURATION_EXECUTION_SCHEMA_VERSION = databaseConfigurationExecutorApi.SCHEMA_VERSION;
exports.DATABASE_CONFIGURATION_EXECUTION_STATUSES = databaseConfigurationExecutorApi.STATUSES;
exports.DATABASE_CONFIGURATION_EXECUTION_STEP_STATUSES = databaseConfigurationExecutorApi.STEP_STATUSES;
exports.DATABASE_CONFIGURATION_APPROVAL_MODES = databaseConfigurationExecutorApi.APPROVAL_MODES;
exports.ENGINE_LIFECYCLE_SCHEMA_VERSION = engineLifecycleApi.SCHEMA_VERSION;
exports.ENGINE_LIFECYCLE_ENGINES = engineLifecycleApi.ENGINES;
exports.ENGINE_LIFECYCLE_EXECUTION_MODES = engineLifecycleApi.EXECUTION;
exports.INSTALLATION_PROVIDER_SCHEMA_VERSION = installationProviderApi.SCHEMA_VERSION;
exports.INSTALLATION_PROVIDER_ACTIONS = engineLifecycleApi.PROVIDER_ACTIONS;
exports.ENGINE_INSTALLATION_PLAN_SCHEMA_VERSION = engineInstallationPlannerApi.SCHEMA_VERSION;
exports.ENGINE_INITIALIZATION_PLAN_SCHEMA_VERSION = engineInitializationPlannerApi.SCHEMA_VERSION;
exports.ENGINE_LIFECYCLE_EXECUTION_SCHEMA_VERSION = engineLifecycleExecutorApi.SCHEMA_VERSION;
exports.ENGINE_LIFECYCLE_EXECUTION_STATUSES = engineLifecycleExecutorApi.STATUSES;
exports.ENGINE_LIFECYCLE_EXECUTION_STEP_STATUSES = engineLifecycleExecutorApi.STEP_STATUSES;
exports.ENGINE_LIFECYCLE_APPROVAL_MODES = engineLifecycleExecutorApi.APPROVAL_MODES;
exports.ENGINE_LIFECYCLE_ACTION_RESULT_STATUSES = engineLifecycleExecutorApi.ACTION_RESULT_STATUSES;
exports.LOCAL_HOST_INSTALLATION_PROVIDER_SCHEMA_VERSION = localHostInstallationProviderApi.SCHEMA_VERSION;
exports.LOCAL_HOST_INSTALLATION_PROVIDER_ID = localHostInstallationProviderApi.PROVIDER_ID;
exports.ENGINE_INSTALLATION_PREREQUISITE_SCHEMA_VERSION = engineInstallationPrerequisitesApi.SCHEMA_VERSION;
exports.ENGINE_INSTALLATION_PREREQUISITE_STATUSES = engineInstallationPrerequisitesApi.STATUSES;
exports.planDatabaseBootstrap = databaseBootstrapPlannerApi.plan;
exports.bootstrapAutomaticSteps = databaseBootstrapPlannerApi.automaticSteps;
exports.bootstrapManualSteps = databaseBootstrapPlannerApi.manualSteps;
exports.inspectDatabaseBootstrap = databaseBootstrapExecutorApi.inspect;
exports.executeDatabaseBootstrap = databaseBootstrapExecutorApi.run;
exports.discoverDatabaseServer = databaseServerDiscoveryApi.discover;
exports.assessDatabaseBootstrapPrerequisites = databaseServerDiscoveryApi.assessBootstrapPrerequisites;
exports.discoverDatabaseSecurity = databaseSecurityDiscoveryApi.discover;
exports.discoverNativeDatabaseJobs = nativeJobDiscoveryApi.discover;
exports.discoverDatabaseConfiguration = databaseConfigurationApi.discover;
exports.findDatabaseConfiguration = databaseConfigurationApi.find;
exports.planDatabaseConfiguration = databaseConfigurationPlannerApi.plan;
exports.configurationAutomaticSteps = databaseConfigurationPlannerApi.automaticSteps;
exports.configurationManualSteps = databaseConfigurationPlannerApi.manualSteps;
exports.inspectDatabaseConfigurationPlan = databaseConfigurationExecutorApi.inspect;
exports.executeDatabaseConfiguration = databaseConfigurationExecutorApi.run;
exports.engineLifecycleProfile = engineLifecycleApi.profile;
exports.selectDatabaseEngine = engineLifecycleApi.select;
exports.validateInstallationProvider = installationProviderApi.validate;
exports.installationProviderDescriptor = installationProviderApi.descriptor;
exports.inspectEngineTarget = installationProviderApi.inspect;
exports.planEngineInstallation = engineInstallationPlannerApi.plan;
exports.engineInstallationProviderSteps = engineInstallationPlannerApi.providerSteps;
exports.engineInstallationExternalSteps = engineInstallationPlannerApi.externalSteps;
exports.planEngineInitialization = engineInitializationPlannerApi.plan;
exports.inspectEngineInstallationPlan = engineLifecycleExecutorApi.inspectInstallation;
exports.inspectEngineInitializationPlan = engineLifecycleExecutorApi.inspectInitialization;
exports.executeEngineInstallation = engineLifecycleExecutorApi.executeInstallation;
exports.executeEngineInitialization = engineLifecycleExecutorApi.executeInitialization;
exports.createLocalHostInstallationProvider = localHostInstallationProviderApi.create;
exports.assessEngineInstallationPrerequisites = engineInstallationPrerequisitesApi.assess;
exports.MIGRATION_PLAN_SCHEMA_VERSION = migrationPlannerApi.SCHEMA_VERSION;
exports.MIGRATION_EXECUTION_MODES = migrationPlannerApi.EXECUTION;
exports.MIGRATION_TRANSACTION_STRATEGIES = migrationPlannerApi.TRANSACTION;
exports.planMigration = migrationPlannerApi.plan;
exports.migrationAutomaticSteps = migrationPlannerApi.automaticSteps;
exports.migrationManualSteps = migrationPlannerApi.manualSteps;
exports.MIGRATION_EXECUTION_SCHEMA_VERSION = migrationExecutorApi.SCHEMA_VERSION;
exports.MIGRATION_EXECUTION_STATUSES = migrationExecutorApi.STATUSES;
exports.MIGRATION_APPROVAL_MODES = migrationExecutorApi.APPROVAL_MODES;
exports.MIGRATION_FAILURE_POLICIES = migrationExecutorApi.FAILURE_POLICIES;
exports.MIGRATION_TRANSACTION_MODES = migrationExecutorApi.TRANSACTION_MODES;
exports.executeMigration = migrationExecutorApi.run;
exports.resumeMigration = migrationExecutorApi.resume;
exports.DATA_MOVEMENT_SCHEMA_VERSION = dataMovementApi.SCHEMA_VERSION;
exports.DATA_MOVEMENT_CHECKPOINT_SCHEMA_VERSION = dataMovementApi.CHECKPOINT_SCHEMA_VERSION;
exports.DATA_MOVEMENT_STATUSES = dataMovementApi.STATUSES;
exports.DATA_MOVEMENT_INVALID_ROW_POLICIES = dataMovementApi.INVALID_ROW_POLICIES;
exports.DATA_MOVEMENT_PLAN_SCHEMA_VERSION = require('./lib/client/engineering/DataMovementPlanner').PLAN_SCHEMA_VERSION;
exports.DATA_MOVEMENT_STRATEGIES = require('./lib/client/engineering/DataMovementPlanner').STRATEGIES;
exports.DATA_MOVEMENT_STRATEGY_PREFERENCES = require('./lib/client/engineering/DataMovementPlanner').PREFERENCES;
exports.planDataMovement = dataMovementApi.plan;
exports.moveData = dataMovementApi.run;
exports.resumeDataMovement = dataMovementApi.resume;
exports.sql = sqlApi.sql;
exports.Client = clientApi.Client;
exports.ClientRowStream = streamApi.ClientRowStream;
exports.MetadataCatalog = metadataApi.Metadata;
exports.NuBloxSqlError = errorApi.NuBloxSqlError;
exports.ERROR_CATEGORIES = errorApi.CATEGORIES;
exports.Observer = observabilityApi.Observer;
exports.TypeRegistry = typesApi.TypeRegistry;

defineLazy(exports, 'sqlCore', function () { return require('./lib/core'); });
defineLazy(exports, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(exports, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(exports, 'sqlite', function () { return loadAdapter('sqlite'); });
defineLazy(exports, 'sqlserver', function () { return loadAdapter('sqlserver'); });
