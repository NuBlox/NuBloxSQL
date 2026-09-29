import mysql = require('./lib/dialects/mysql');
import postgresql = require('./lib/dialects/postgresql');
import sqlite = require('./lib/dialects/sqlite');
import sqlCore = require('./lib/core');

type Dialect = 'mysql' | 'postgresql' | 'sqlite';
type DialectAlias = Dialect | 'postgres' | 'pg';
type ErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'connection'
  | 'timeout'
  | 'cancelled'
  | 'constraint'
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'not_null_violation'
  | 'syntax'
  | 'deadlock'
  | 'serialization'
  | 'resource_limit'
  | 'state'
  | 'cardinality'
  | 'unsupported'
  | 'unknown';

type MySqlConfig = ConstructorParameters<typeof mysql.Connection>[0] & { dialect: 'mysql' };
type PostgreSqlConfig = ConstructorParameters<typeof postgresql.Connection>[0] & { dialect: 'postgresql' | 'postgres' | 'pg' };
type SqliteConfig = ConstructorParameters<typeof sqlite.Connection>[0] & { dialect: 'sqlite' };
type ConnectionConfig = MySqlConfig | PostgreSqlConfig | SqliteConfig;

interface ClientPoolOptions {
  max?: number;
  connectionLimit?: number;
  maxIdle?: number;
  idleTimeout?: number;
  acquireTimeout?: number;
  queueLimit?: number;
  resetOnRelease?: boolean;
}

type ClientConfig = ConnectionConfig & { pool?: boolean | ClientPoolOptions };

interface SqlFragment {}
interface SqlIdentifier {}
interface SqlParameter {}
interface CompiledSql {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment;
  identifier(...parts: string[]): SqlIdentifier;
  parameter(name: string): SqlParameter;
  join(fragments: readonly SqlFragment[], separator?: string): SqlFragment;
}

interface ClientResult<Row = Record<string, unknown>> {
  readonly rows: Row[];
  readonly fields: unknown[];
  readonly rowCount: number;
  readonly affectedRows: number | bigint | null;
  readonly insertId: number | bigint | null;
  readonly command: string;
  readonly dialect: Dialect;
  readonly native: unknown;
}

interface ClientPrepareOptions extends Record<string, unknown> {
  acquire?: Record<string, unknown>;
}

interface ClientStreamOptions extends Record<string, unknown> {
  batchSize?: number;
  highWaterMark?: number;
  timeout?: number;
  deadline?: number | Date;
  signal?: AbortSignal;
  maxRows?: number;
  maxResultBytes?: number;
  maxRowBytes?: number;
  acquire?: Record<string, unknown>;
}

declare class NuBloxSqlError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly dialect: Dialect | null;
  readonly operation: string | null;
  readonly retryable: boolean;
  readonly sqlState: string | null;
  readonly nativeCode: string | number | null;
  readonly native: unknown;
  readonly cause?: unknown;
}

declare const ERROR_CATEGORIES: Readonly<{
  AUTHENTICATION: 'authentication';
  AUTHORIZATION: 'authorization';
  CONNECTION: 'connection';
  TIMEOUT: 'timeout';
  CANCELLED: 'cancelled';
  CONSTRAINT: 'constraint';
  UNIQUE_VIOLATION: 'unique_violation';
  FOREIGN_KEY_VIOLATION: 'foreign_key_violation';
  NOT_NULL_VIOLATION: 'not_null_violation';
  SYNTAX: 'syntax';
  DEADLOCK: 'deadlock';
  SERIALIZATION: 'serialization';
  RESOURCE_LIMIT: 'resource_limit';
  STATE: 'state';
  CARDINALITY: 'cardinality';
  UNSUPPORTED: 'unsupported';
  UNKNOWN: 'unknown';
}>;

declare class ClientRowStream<Row = Record<string, unknown>> implements AsyncIterable<Row>, AsyncIterator<Row> {
  readonly client: Client;
  readonly dialect: Dialect;
  readonly compiled: CompiledSql;
  readonly options: ClientStreamOptions;
  native: unknown;
  fields: unknown[] | null;
  closed: boolean;
  next(): Promise<IteratorResult<Row>>;
  return(): Promise<IteratorResult<Row>>;
  throw(error: unknown): Promise<IteratorResult<Row>>;
  close(): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<Row>;
}

declare class PreparedClientStatement {
  readonly client: Client;
  readonly dialect: Dialect;
  readonly text: string;
  readonly bindings: readonly string[];
  readonly native: unknown;
  readonly closed: boolean;

  query<Row = Record<string, unknown>>(bindings?: Record<string, unknown>, options?: Record<string, unknown>): Promise<ClientResult<Row>>;
  all<Row = Record<string, unknown>>(bindings?: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row[]>;
  one<Row = Record<string, unknown>>(bindings?: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
  execute<Row = Record<string, unknown>>(bindings?: Record<string, unknown>, options?: Record<string, unknown>): Promise<ClientResult<Row>>;
  close(options?: Record<string, unknown>): Promise<void>;
}

declare class Client {
  readonly dialect: Dialect;
  readonly config: Record<string, unknown>;
  readonly descriptor: unknown;
  readonly capabilities: Readonly<Record<string, boolean>>;
  readonly adapter: unknown;
  readonly native: unknown;

  supports(capability: string): boolean;
  compile(statement: SqlFragment | string): CompiledSql;
  query<Row = Record<string, unknown>>(statement: SqlFragment | string, options?: Record<string, unknown>): Promise<ClientResult<Row>>;
  all<Row = Record<string, unknown>>(statement: SqlFragment | string, options?: Record<string, unknown>): Promise<Row[]>;
  one<Row = Record<string, unknown>>(statement: SqlFragment | string, options?: Record<string, unknown>): Promise<Row>;
  execute<Row = Record<string, unknown>>(statement: SqlFragment | string, options?: Record<string, unknown>): Promise<ClientResult<Row>>;
  prepare(statement: SqlFragment | string, options?: ClientPrepareOptions): Promise<PreparedClientStatement>;
  stream<Row = Record<string, unknown>>(statement: SqlFragment | string, options?: ClientStreamOptions): ClientRowStream<Row>;
  transaction<T>(fn: (transaction: Client) => T | Promise<T>, options?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

declare const sql: SqlTag;

declare const DIALECTS: Readonly<{
  mysql: 'mysql';
  postgresql: 'postgresql';
  sqlite: 'sqlite';
}>;

declare const dialects: Readonly<{
  mysql: typeof mysql;
  postgresql: typeof postgresql;
  sqlite: typeof sqlite;
}>;

declare function adapter(dialect: 'mysql'): typeof mysql;
declare function adapter(dialect: 'postgresql' | 'postgres' | 'pg'): typeof postgresql;
declare function adapter(dialect: 'sqlite'): typeof sqlite;
declare function adapter(dialect: DialectAlias): typeof mysql | typeof postgresql | typeof sqlite;

declare function descriptor(dialect: DialectAlias): unknown;
declare function supports(dialect: DialectAlias, capability: string): boolean;

declare function createConnection(config: MySqlConfig): InstanceType<typeof mysql.Connection>;
declare function createConnection(config: PostgreSqlConfig): InstanceType<typeof postgresql.Connection>;
declare function createConnection(config: SqliteConfig): InstanceType<typeof sqlite.Connection>;
declare function createConnection(dialect: 'mysql', config?: ConstructorParameters<typeof mysql.Connection>[0]): InstanceType<typeof mysql.Connection>;
declare function createConnection(dialect: 'postgresql' | 'postgres' | 'pg', config?: ConstructorParameters<typeof postgresql.Connection>[0]): InstanceType<typeof postgresql.Connection>;
declare function createConnection(dialect: 'sqlite', config?: ConstructorParameters<typeof sqlite.Connection>[0]): InstanceType<typeof sqlite.Connection>;

declare function createPool(config: MySqlConfig): InstanceType<typeof mysql.Pool>;
declare function createPool(config: PostgreSqlConfig): InstanceType<typeof postgresql.Pool>;
declare function createPool(dialect: 'mysql', config?: ConstructorParameters<typeof mysql.Pool>[0]): InstanceType<typeof mysql.Pool>;
declare function createPool(dialect: 'postgresql' | 'postgres' | 'pg', config?: ConstructorParameters<typeof postgresql.Pool>[0]): InstanceType<typeof postgresql.Pool>;

declare function createClient(config: ClientConfig): Client;
declare function createClient(dialect: 'mysql', config: ConstructorParameters<typeof mysql.Connection>[0] & { pool?: boolean | ClientPoolOptions }): Client;
declare function createClient(dialect: 'postgresql' | 'postgres' | 'pg', config: ConstructorParameters<typeof postgresql.Connection>[0] & { pool?: boolean | ClientPoolOptions }): Client;
declare function createClient(dialect: 'sqlite', config?: ConstructorParameters<typeof sqlite.Connection>[0] & { pool?: false }): Client;

export {
  Dialect,
  DialectAlias,
  ErrorCategory,
  ConnectionConfig,
  ClientConfig,
  ClientPoolOptions,
  ClientPrepareOptions,
  ClientStreamOptions,
  SqlFragment,
  SqlIdentifier,
  SqlParameter,
  CompiledSql,
  SqlTag,
  ClientResult,
  NuBloxSqlError,
  ERROR_CATEGORIES,
  ClientRowStream,
  PreparedClientStatement,
  Client,
  sql,
  DIALECTS,
  dialects,
  sqlCore,
  mysql,
  postgresql,
  sqlite,
  adapter,
  descriptor,
  supports,
  createConnection,
  createPool,
  createClient
};
