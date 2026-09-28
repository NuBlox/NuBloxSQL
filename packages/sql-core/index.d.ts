export type SqlDialectFamily =
  | 'mysql'
  | 'postgresql'
  | 'sqlite'
  | 'sqlserver'
  | 'oracle'
  | (string & {});

export interface SqlDialectIdentity {
  family: SqlDialectFamily;
  name: string;
  serverVersion?: string;
  protocolVersion?: string;
}

export type SqlCapabilityMap = Readonly<Record<string, boolean>>;

export interface SqlDialectServices {
  quoteIdentifier(identifier: string): string;
  placeholder(index: number, name?: string): string;
}

export interface SqlDialectDescriptor {
  readonly identity: Readonly<SqlDialectIdentity>;
  readonly capabilities: SqlCapabilityMap;
  readonly services: SqlDialectServices;
  supports(capability: string): boolean;
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
  POSTGRESQL: 'postgresql';
  SQLITE: 'sqlite';
  SQLSERVER: 'sqlserver';
  ORACLE: 'oracle';
}>;

export const CAPABILITIES: Readonly<{
  PREPARED_STATEMENTS: 'preparedStatements';
  SERVER_SIDE_CURSORS: 'serverSideCursors';
  SAVEPOINTS: 'savepoints';
  CATALOGS: 'catalogs';
  SCHEMAS: 'schemas';
  TRANSACTIONAL_DDL: 'transactionalDdl';
  QUERY_CANCELLATION: 'queryCancellation';
  CHANGE_DATA_CAPTURE: 'changeDataCapture';
  NATIVE_JSON: 'nativeJson';
  MULTIPLE_ACTIVE_RESULTS: 'multipleActiveResults';
}>;

export function createDialectDescriptor(options: {
  identity: SqlDialectIdentity;
  capabilities?: Record<string, boolean>;
  services: SqlDialectServices;
}): SqlDialectDescriptor;

export function assertDialectDescriptor(
  descriptor: SqlDialectDescriptor
): SqlDialectDescriptor;

export function createObjectName(name: SqlObjectName): Readonly<SqlObjectName>;
