export type SqlDialectFamily =
  | 'mysql'
  | 'mariadb'
  | 'postgresql'
  | 'cockroachdb'
  | 'sqlite'
  | 'duckdb'
  | 'sqlserver'
  | 'oracle'
  | 'db2'
  | 'snowflake'
  | 'redshift'
  | 'bigquery'
  | 'clickhouse'
  | (string & {});

export interface SqlDialectIdentity {
  family: SqlDialectFamily;
  name: string;
  serverVersion?: string;
  protocolVersion?: string;
  edition?: string;
  distribution?: string;
}

export type SqlCapabilityMap = Readonly<Record<string, boolean>>;

export type SqlCapabilityLevel =
  | 'native'
  | 'emulated'
  | 'conditional'
  | 'unsupported'
  | 'unknown';

export interface SqlCapabilityEntry {
  readonly name: string;
  readonly level: SqlCapabilityLevel;
  readonly since?: string;
  readonly until?: string;
  readonly requires?: readonly string[];
  readonly notes?: string;
  readonly extension?: unknown;
}

export type SqlCapabilityProfileInput = Readonly<Record<string,
  | boolean
  | {
      level?: SqlCapabilityLevel;
      since?: string;
      until?: string;
      requires?: readonly string[];
      notes?: string;
      extension?: unknown;
    }
>>;

export type SqlCapabilityProfile = Readonly<Record<string, SqlCapabilityEntry>>;

export interface SqlDialectServices {
  quoteIdentifier(identifier: string): string;
  placeholder(index: number, name?: string): string;
}

export interface SqlDialectDescriptor {
  readonly identity: Readonly<SqlDialectIdentity>;
  readonly capabilities: SqlCapabilityMap;
  readonly capabilityProfile: SqlCapabilityProfile | null;
  readonly services: SqlDialectServices;
  supports(capability: string): boolean;
  capability(capability: string): SqlCapabilityEntry;
}

export interface SqlObjectName {
  catalog?: string;
  schema?: string;
  name: string;
}

export interface SqlOperationOptions {
  signal?: AbortSignal;
  deadline?: number | Date;
}

export interface SqlExecutionRequest extends SqlOperationOptions {
  sql: string;
  parameters?: readonly unknown[] | Readonly<Record<string, unknown>>;
}

export interface SqlFieldMetadata {
  name: string;
  nativeType?: string | number;
  nullable?: boolean;
  precision?: number;
  scale?: number;
  length?: number;
  extension?: unknown;
}

export interface SqlRowsResult<Row = Record<string, unknown>> {
  kind: 'rows';
  rows: readonly Row[];
  fields: readonly SqlFieldMetadata[];
  rowCount?: number;
  extension?: unknown;
}

export interface SqlCommandResult {
  kind: 'command';
  affectedRows?: number;
  rowCount?: number;
  insertId?: string | number | bigint;
  extension?: unknown;
}

export interface SqlMultiResult<Row = Record<string, unknown>> {
  kind: 'multi';
  results: readonly SqlExecutionResult<Row>[];
  extension?: unknown;
}

export type SqlExecutionResult<Row = Record<string, unknown>> =
  | SqlRowsResult<Row>
  | SqlCommandResult
  | SqlMultiResult<Row>;

export type SqlIsolationLevel =
  | 'read-uncommitted'
  | 'read-committed'
  | 'repeatable-read'
  | 'serializable'
  | (string & {});

export interface SqlTransactionOptions extends SqlOperationOptions {
  isolationLevel?: SqlIsolationLevel;
  readOnly?: boolean;
}

export type SqlErrorCategory =
  | 'connection'
  | 'authentication'
  | 'timeout'
  | 'cancelled'
  | 'constraint'
  | 'deadlock'
  | 'serialization'
  | 'syntax'
  | 'resource-limit'
  | 'protocol'
  | 'unknown';

export interface SqlErrorDetails {
  category: SqlErrorCategory;
  code?: string | number;
  sqlState?: string;
  retryable?: boolean;
  extension?: unknown;
}

export interface SqlAdapterExtension<T = unknown> {
  readonly native: T;
}

export const DIALECT_FAMILIES: Readonly<{
  MYSQL: 'mysql';
  MARIADB: 'mariadb';
  POSTGRESQL: 'postgresql';
  COCKROACHDB: 'cockroachdb';
  SQLITE: 'sqlite';
  DUCKDB: 'duckdb';
  SQLSERVER: 'sqlserver';
  ORACLE: 'oracle';
  DB2: 'db2';
  SNOWFLAKE: 'snowflake';
  REDSHIFT: 'redshift';
  BIGQUERY: 'bigquery';
  CLICKHOUSE: 'clickhouse';
}>;

export const CAPABILITY_LEVELS: Readonly<{
  NATIVE: 'native';
  EMULATED: 'emulated';
  CONDITIONAL: 'conditional';
  UNSUPPORTED: 'unsupported';
  UNKNOWN: 'unknown';
}>;

export const CAPABILITIES: Readonly<{
  CONNECTION_POOLING: 'connectionPooling';
  TLS: 'tls';
  MUTUAL_TLS: 'mutualTls';
  PREPARED_STATEMENTS: 'preparedStatements';
  SERVER_PREPARED: 'serverPreparedStatements';
  NAMED_PARAMETERS: 'namedParameters';
  POSITIONAL_PARAMETERS: 'positionalParameters';
  BINARY_PROTOCOL: 'binaryProtocol';
  SERVER_SIDE_CURSORS: 'serverSideCursors';
  STREAMING_RESULTS: 'streamingResults';
  QUERY_CANCELLATION: 'queryCancellation';
  QUERY_TIMEOUT: 'queryTimeout';
  MULTI_STATEMENT: 'multiStatement';
  MULTI_RESULT: 'multiResult';
  MULTIPLE_ACTIVE_RESULTS: 'multipleActiveResults';
  SAVEPOINTS: 'savepoints';
  TRANSACTION_ISOLATION: 'transactionIsolation';
  READ_ONLY_TRANSACTIONS: 'readOnlyTransactions';
  TWO_PHASE_COMMIT: 'twoPhaseCommit';
  TRANSACTIONAL_DDL: 'transactionalDdl';
  CATALOGS: 'catalogs';
  SCHEMAS: 'schemas';
  GENERATED_KEYS: 'generatedKeys';
  RETURNING: 'returning';
  UPSERT: 'upsert';
  MERGE: 'merge';
  CTE: 'cte';
  RECURSIVE_CTE: 'recursiveCte';
  WINDOW_FUNCTIONS: 'windowFunctions';
  NATIVE_JSON: 'nativeJson';
  ARRAYS: 'arrays';
  UUID: 'uuid';
  SPATIAL: 'spatial';
  FULL_TEXT_SEARCH: 'fullTextSearch';
  BULK_LOAD: 'bulkLoad';
  COPY_PROTOCOL: 'copyProtocol';
  CHANGE_DATA_CAPTURE: 'changeDataCapture';
  NOTIFICATIONS: 'notifications';
  SESSION_STATE: 'sessionState';
  ROLE_SWITCHING: 'roleSwitching';
  ADVISORY_LOCKS: 'advisoryLocks';
  STORED_PROCEDURES: 'storedProcedures';
  STORED_FUNCTIONS: 'storedFunctions';
  SEQUENCES: 'sequences';
  IDENTITY_COLUMNS: 'identityColumns';
  PARTITIONING: 'partitioning';
  MATERIALIZED_VIEWS: 'materializedViews';
  EXTENSIONS: 'extensions';
  EXPLAIN: 'explain';
  EXPLAIN_ANALYZE: 'explainAnalyze';
}>;

export function createCapabilityProfile(input: SqlCapabilityProfileInput): SqlCapabilityProfile;
export function capabilityProfileToBooleanMap(profile: SqlCapabilityProfile): SqlCapabilityMap;

export function createDialectDescriptor(options: {
  identity: SqlDialectIdentity;
  capabilities?: Record<string, boolean>;
  capabilityProfile?: SqlCapabilityProfileInput;
  services: SqlDialectServices;
}): SqlDialectDescriptor;

export function assertDialectDescriptor(
  descriptor: SqlDialectDescriptor
): SqlDialectDescriptor;

export function createObjectName(name: SqlObjectName): Readonly<SqlObjectName>;
