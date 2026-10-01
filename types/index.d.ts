import mysql = require('../lib/dialects/mysql');
import postgresql = require('../lib/dialects/postgresql');
import sqlite = require('../lib/dialects/sqlite');
import sqlserver = require('../lib/dialects/sqlserver');
import type * as root from '../index';

export * from '../index';
export * from './postgresql-deep-metadata';
export * from './mysql-deep-metadata';

export type MySqlConnectionUrl = `mysql://${string}` | `mysql2://${string}`;
export type PostgreSqlConnectionUrl = `postgres://${string}` | `postgresql://${string}`;
export type SqlServerConnectionUrl = `mssql://${string}` | `sqlserver://${string}`;
export type SqliteConnectionUrl = `sqlite:${string}`;
export type ConnectionUrl = MySqlConnectionUrl | PostgreSqlConnectionUrl | SqlServerConnectionUrl | SqliteConnectionUrl;
export type ConnectionUrlInput = ConnectionUrl | URL;
export type ClientLifecycleState = 'idle' | 'opening' | 'open' | 'closing' | 'closed';
export type ObservabilityEventType = 'query' | 'execute' | 'prepare' | 'prepared' | 'transaction' | 'transaction_retry' | 'stream' | 'connection' | 'error';

export type CanonicalDialect<D extends root.DialectAlias> =
  D extends 'postgres' | 'pg' ? 'postgresql' :
  D extends 'mssql' | 'sql-server' ? 'sqlserver' :
  D;

export type DialectAdapter<D extends root.DialectAlias> =
  CanonicalDialect<D> extends 'mysql' ? typeof mysql :
  CanonicalDialect<D> extends 'postgresql' ? typeof postgresql :
  CanonicalDialect<D> extends 'sqlite' ? typeof sqlite :
  CanonicalDialect<D> extends 'sqlserver' ? typeof sqlserver : never;

export type DialectConnection<D extends root.DialectAlias> =
  CanonicalDialect<D> extends 'mysql' ? mysql.Connection :
  CanonicalDialect<D> extends 'postgresql' ? postgresql.Connection :
  CanonicalDialect<D> extends 'sqlite' ? sqlite.Connection :
  CanonicalDialect<D> extends 'sqlserver' ? sqlserver.Connection : never;

export type DialectPool<D extends root.DialectAlias> =
  CanonicalDialect<D> extends 'mysql' ? mysql.Pool :
  CanonicalDialect<D> extends 'postgresql' ? postgresql.Pool :
  CanonicalDialect<D> extends 'sqlite' ? never :
  CanonicalDialect<D> extends 'sqlserver' ? sqlserver.Pool : never;

export type DialectConnectionConfig<D extends root.DialectAlias> =
  CanonicalDialect<D> extends 'mysql' ? mysql.ConnectionConfig :
  CanonicalDialect<D> extends 'postgresql' ? postgresql.PostgreSqlConnectionOptions :
  CanonicalDialect<D> extends 'sqlite' ? sqlite.SQLiteConnectionOptions :
  CanonicalDialect<D> extends 'sqlserver' ? sqlserver.SqlServerConnectionConfig : never;

export type DialectClientConfig<D extends root.DialectAlias> =
  CanonicalDialect<D> extends 'sqlite'
    ? DialectConnectionConfig<D> & { dialect: D; pool?: false }
    : DialectConnectionConfig<D> & { dialect: D; pool?: boolean | root.ClientPoolOptions };

export type DialectNative<D extends root.DialectAlias> = DialectConnection<D> | DialectPool<D>;

export type MySqlClient = root.Client & { readonly dialect: 'mysql'; readonly adapter: typeof mysql; readonly native: mysql.Connection | mysql.Pool };
export type PostgreSqlClient = root.Client & { readonly dialect: 'postgresql'; readonly adapter: typeof postgresql; readonly native: postgresql.Connection | postgresql.Pool };
export type SqliteClient = root.Client & { readonly dialect: 'sqlite'; readonly adapter: typeof sqlite; readonly native: sqlite.Connection };
export type SqlServerClient = root.Client & { readonly dialect: 'sqlserver'; readonly adapter: typeof sqlserver; readonly native: sqlserver.Connection | sqlserver.Pool };

export type DialectClient<D extends root.DialectAlias> =
  CanonicalDialect<D> extends 'mysql' ? MySqlClient :
  CanonicalDialect<D> extends 'postgresql' ? PostgreSqlClient :
  CanonicalDialect<D> extends 'sqlite' ? SqliteClient :
  CanonicalDialect<D> extends 'sqlserver' ? SqlServerClient : never;

export function createConnection<D extends root.DialectAlias>(dialect: D, config: DialectConnectionConfig<D>): DialectConnection<D>;
export function createPool<D extends Exclude<root.DialectAlias, 'sqlite'>>(dialect: D, config: DialectConnectionConfig<D>): DialectPool<D>;
export function createClient(url: MySqlConnectionUrl, options?: root.ClientOptions): MySqlClient;
export function createClient(url: PostgreSqlConnectionUrl, options?: root.ClientOptions): PostgreSqlClient;
export function createClient(url: SqliteConnectionUrl, options?: root.ClientOptions): SqliteClient;
export function createClient(url: SqlServerConnectionUrl, options?: root.ClientOptions): SqlServerClient;
export function createClient(config: mysql.ConnectionConfig & { dialect: 'mysql'; pool?: boolean | root.ClientPoolOptions }): MySqlClient;
export function createClient(config: postgresql.PostgreSqlConnectionOptions & { dialect: 'postgresql' | 'postgres' | 'pg'; pool?: boolean | root.ClientPoolOptions }): PostgreSqlClient;
export function createClient(config: sqlite.SQLiteConnectionOptions & { dialect: 'sqlite'; pool?: false }): SqliteClient;
export function createClient(config: sqlserver.SqlServerConnectionConfig & { dialect: 'sqlserver' | 'mssql' | 'sql-server'; pool?: boolean | root.ClientPoolOptions }): SqlServerClient;

export function capabilityReport<D extends root.DialectAlias>(dialect: D): root.DialectCapabilityReport;
export function transactionPolicy<D extends root.DialectAlias>(dialect: D): root.TransactionPolicy;
