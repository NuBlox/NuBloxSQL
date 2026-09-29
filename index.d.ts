import mysql = require('./lib/dialects/mysql');
import postgresql = require('./lib/dialects/postgresql');
import sqlite = require('./lib/dialects/sqlite');
import sqlCore = require('./lib/core');

type Dialect = 'mysql' | 'postgresql' | 'sqlite';
type DialectAlias = Dialect | 'postgres' | 'pg';

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
  ConnectionConfig,
  ClientConfig,
  ClientPoolOptions,
  ClientPrepareOptions,
  SqlFragment,
  SqlIdentifier,
  SqlParameter,
  CompiledSql,
  SqlTag,
  ClientResult,
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
