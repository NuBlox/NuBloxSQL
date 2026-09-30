export type SqlDialectFamily =
  | 'mysql'
  | 'postgresql'
  | 'sqlite'
  | 'sqlserver'
  | 'oracle'
  | (string & {});

export interface SqlAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface SqlDialectIdentity {
  family: SqlDialectFamily;
  name: string;
  serverVersion?: string;
  protocolVersion?: string;
}

export type SqlCapabilityMap = Readonly<Record<string, boolean>>;

export interface SqlDecimalTypeSpec {
  readonly type: 'decimal' | 'numeric';
  readonly precision?: number;
  readonly scale?: number;
}

export interface SqlUuidTypeSpec {
  readonly type: 'uuid' | 'guid';
}

export type SqlPortableTypeSpec = SqlDecimalTypeSpec | SqlUuidTypeSpec;

export interface SqlNormalizedDecimalTypeSpec {
  readonly type: 'decimal';
  readonly precision: number;
  readonly scale: number;
}

export interface SqlNormalizedUuidTypeSpec {
  readonly type: 'uuid';
}

export type SqlNormalizedPortableTypeSpec = SqlNormalizedDecimalTypeSpec | SqlNormalizedUuidTypeSpec;

export class TypedValue<T = unknown> {
  readonly value: T;
  readonly spec: Readonly<SqlNormalizedPortableTypeSpec>;
  constructor(value: T, spec: SqlPortableTypeSpec | 'decimal' | 'numeric' | 'uuid' | 'guid');
}

export function typed<T>(value: T, spec: SqlPortableTypeSpec | 'decimal' | 'numeric' | 'uuid' | 'guid'): TypedValue<T>;
export function isTypedValue(value: unknown): value is TypedValue<unknown>;
export function normalizeTypeSpec(spec: SqlPortableTypeSpec | 'decimal' | 'numeric' | 'uuid' | 'guid'): Readonly<SqlNormalizedPortableTypeSpec>;
export function unwrapTypedValue<T>(value: T | TypedValue<T>): T;

export interface SqlDialectServices {
  quoteIdentifier(identifier: string): string;
  placeholder(index: number, name?: string): string;
  parameterTypeOid?(spec: Readonly<SqlNormalizedPortableTypeSpec>): number;
  bindParameter?(value: unknown, index?: number): unknown;
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
  timeout?: number;
  signal?: SqlAbortSignal;
}

export interface SqlResourceLimitOptions {
  maxRows?: number;
  maxResultBytes?: number;
  maxRowBytes?: number;
}

export interface SqlQueryOptions extends SqlOperationOptions, SqlResourceLimitOptions {}

export interface SqlExecutionRequest extends SqlQueryOptions {
  sql: string;
  parameters?: readonly unknown[];
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
  affectedRows?: number | bigint;
  rowCount?: number;
  insertId?: string | number | bigint;
  extension?: unknown;
}

export type SqlExecutionResult<Row = Record<string, unknown>> =
  | SqlRowsResult<Row>
  | SqlCommandResult;

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
  | 'state'
  | 'unknown';

export interface SqlErrorDetails {
  category: SqlErrorCategory;
  code?: string | number;
  sqlState?: string;
  retryable?: boolean;
  limit?: number;
  observed?: number;
  cause?: unknown;
  extension?: unknown;
}

export interface SqlAdapterExtension<T = unknown> {
  readonly native: T;
}

export const CONTRACT_VERSION: '1.0';

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
  NATIVE_JSON: 'nativeJson';
}>;

export const ISOLATION_LEVELS: Readonly<{
  READ_UNCOMMITTED: 'read-uncommitted';
  READ_COMMITTED: 'read-committed';
  REPEATABLE_READ: 'repeatable-read';
  SERIALIZABLE: 'serializable';
}>;

export const ERROR_CATEGORIES: Readonly<{
  CONNECTION: 'connection';
  AUTHENTICATION: 'authentication';
  TIMEOUT: 'timeout';
  CANCELLED: 'cancelled';
  CONSTRAINT: 'constraint';
  DEADLOCK: 'deadlock';
  SERIALIZATION: 'serialization';
  SYNTAX: 'syntax';
  RESOURCE_LIMIT: 'resource-limit';
  PROTOCOL: 'protocol';
  STATE: 'state';
  UNKNOWN: 'unknown';
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
