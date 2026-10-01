import mysql = require('../lib/dialects/mysql');
import postgresql = require('../lib/dialects/postgresql');
import sqlite = require('../lib/dialects/sqlite');
import sqlserver = require('../lib/dialects/sqlserver');
import type * as root from '../index';

export * from '../index';
export * from './postgresql-deep-metadata';

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

export type DialectClientConfig<D extends root.DialectAlias> = DialectConnectionConfig<D> & {
  dialect?: D;
  pool?: CanonicalDialect<D> extends 'sqlite' ? false : boolean | root.ClientPoolOptions;
  telemetry?: root.TelemetryOptions;
  types?: root.TypeOptions;
};

export type DialectNative<D extends root.DialectAlias> =
  CanonicalDialect<D> extends 'sqlite' ? DialectConnection<D> : DialectConnection<D> | DialectPool<D>;

export type DialectClient<D extends root.DialectAlias> = Omit<root.Client,
  'dialect' | 'config' | 'adapter' | 'native' | 'transaction'
> & {
  readonly dialect: CanonicalDialect<D>;
  readonly config: DialectClientConfig<D>;
  readonly adapter: DialectAdapter<D>;
  readonly native: DialectNative<D>;
  transaction<T>(fn: (transaction: DialectClient<D>) => T | Promise<T>, options?: root.ClientTransactionOptions): Promise<T>;
};

export type MySqlClient = DialectClient<'mysql'>;
export type PostgreSqlClient = DialectClient<'postgresql'>;
export type SqliteClient = DialectClient<'sqlite'>;
export type SqlServerClient = DialectClient<'sqlserver'>;

export interface CapabilitySupportEntry { readonly supported: boolean; readonly source: 'dialect'; }
export interface CapabilityRuntimeInfo { readonly nodeVersion: string; readonly v8Version: string | null; readonly modules: string | null; readonly sqliteVersion: string | null; readonly platform: string; readonly arch: string; }
export interface CapabilityServerInfo { readonly connected: boolean; readonly version: string | null; readonly protocolVersion: number | null; readonly [key: string]: unknown; }
export interface CapabilityReport<D extends root.Dialect = root.Dialect> { readonly dialect: D; readonly identity: unknown; readonly capabilities: Readonly<Record<string, boolean>>; readonly support: Readonly<Record<string, CapabilitySupportEntry>>; readonly plannedCapabilities: Readonly<Record<string, boolean>>; readonly runtime: CapabilityRuntimeInfo; readonly server: CapabilityServerInfo | null; readonly pool: boolean; }

export interface MetadataIntrospectionOptions extends root.MetadataScope { deep?: boolean; concurrency?: number; tables?: readonly string[]; }
export interface MetadataSnapshot<D extends root.Dialect = root.Dialect> { readonly dialect: D; readonly scope: Readonly<root.MetadataScope>; readonly databases: readonly root.DatabaseMetadata[]; readonly schemas: readonly root.SchemaMetadata[]; readonly tables: readonly root.TableMetadata[]; }

export interface TransactionRetryPolicy {
  maxAttempts?: number;
  delayMs?: number | ((attempt: number) => number);
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, completedAttempt: number, nextAttempt: number) => void | Promise<void>;
}
export interface PortableTransactionPolicy<D extends root.Dialect = root.Dialect> {
  readonly dialect: D;
  readonly transactions: boolean;
  readonly nestedTransactions: boolean;
  readonly savepoints: boolean;
  readonly isolationLevels: readonly root.TransactionIsolationLevel[];
  readonly readOnly: boolean;
  readonly deferrable: boolean;
  readonly sqliteModes: readonly root.SqliteTransactionMode[];
  readonly retries: Readonly<{ supported: true; defaultMaxAttempts: 1; automaticCategories: readonly ['deadlock', 'serialization']; requiresRollbackBeforeRetry: true; nested: false }>;
  readonly guarantees: Readonly<{ callbackCommit: true; callbackFailureRollback: true; nestedSavepointRollback: boolean; cleanupFailuresAttachedToOriginalError: true }>;
}

export const CLIENT_LIFECYCLE_STATES: Readonly<{ IDLE: 'idle'; OPENING: 'opening'; OPEN: 'open'; CLOSING: 'closing'; CLOSED: 'closed'; }>;
export const TRANSACTION_ISOLATION_LEVELS: readonly ['read-uncommitted', 'read-committed', 'repeatable-read', 'serializable'];
export const SQLITE_TRANSACTION_MODES: readonly ['deferred', 'immediate', 'exclusive'];
export const OBSERVABILITY_SCHEMA_VERSION: 1;
export const OBSERVABILITY_EVENT_TYPES: Readonly<{
  QUERY: 'query'; EXECUTE: 'execute'; PREPARE: 'prepare'; PREPARED: 'prepared'; TRANSACTION: 'transaction'; TRANSACTION_RETRY: 'transaction_retry'; STREAM: 'stream'; CONNECTION: 'connection'; ERROR: 'error';
}>;
export const ERROR_CODES: Readonly<{ CONFIGURATION: 'NUBLOXSQL_CONFIGURATION'; ROUTING: 'NUBLOXSQL_ROUTING'; UNSUPPORTED_DIALECT: 'NUBLOXSQL_UNSUPPORTED_DIALECT'; UNSUPPORTED_URL_SCHEME: 'NUBLOXSQL_UNSUPPORTED_URL_SCHEME'; CLIENT_LIFECYCLE: 'NUBLOXSQL_CLIENT_LIFECYCLE'; UNSUPPORTED: 'NUBLOXSQL_UNSUPPORTED'; }>;

export type MySqlUrlConfig = Partial<mysql.ConnectionConfig> & { url: MySqlConnectionUrl | URL; dialect?: 'mysql' };
export type PostgreSqlUrlConfig = Partial<postgresql.PostgreSqlConnectionOptions> & { url: PostgreSqlConnectionUrl | URL; dialect?: 'postgresql' | 'postgres' | 'pg' };
export type SqlServerUrlConfig = Partial<sqlserver.SqlServerConnectionConfig> & { url: SqlServerConnectionUrl | URL; dialect?: 'sqlserver' | 'mssql' | 'sql-server' };
export type SqliteUrlConfig = Partial<sqlite.SQLiteConnectionOptions> & { url: SqliteConnectionUrl | URL; dialect?: 'sqlite' };
export type UrlConnectionConfig = MySqlUrlConfig | PostgreSqlUrlConfig | SqlServerUrlConfig | SqliteUrlConfig;

declare module '../index' {
  interface TelemetryEvent {
    readonly schemaVersion: 1;
    readonly eventId: number;
    readonly clientId: string;
    readonly operationId?: string;
    readonly errorName?: string | null;
    readonly transactionAttempt?: number;
    readonly completedAttempt?: number;
    readonly nextAttempt?: number;
  }
  interface TelemetryOptions {
    slowOperationThresholdMs?: number;
    onTransactionRetry?: (event: TelemetryEvent) => void;
  }
  interface MetadataCatalog { snapshot(options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot>; }
  interface ClientTransactionOptions {
    retry?: boolean | TransactionRetryPolicy;
    retries?: number;
    retryDelayMs?: number;
  }
  interface Client {
    readonly lifecycleState: ClientLifecycleState;
    readonly isOpen: boolean;
    readonly isClosed: boolean;
    readonly catalog: MetadataCatalog;
    readonly transactionAttempt?: number;
    connect(): Promise<this>;
    open(): Promise<this>;
    close(): Promise<void>;
    end(): Promise<void>;
    capabilityReport(): CapabilityReport;
    discoverCapabilities(options?: { acquire?: root.ClientAcquireOptions }): Promise<CapabilityReport>;
    introspect(options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot>;
    transactionPolicy(): PortableTransactionPolicy;
  }

  function capabilityReport<D extends root.DialectAlias>(dialect: D): CapabilityReport<CanonicalDialect<D>>;
  function transactionPolicy<D extends root.DialectAlias>(dialect: D): PortableTransactionPolicy<CanonicalDialect<D>>;
  function introspect<D extends root.DialectAlias>(dialect: D, config?: DialectClientConfig<D>, options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot<CanonicalDialect<D>>>;
  function introspect(config: root.ClientConfig | UrlConnectionConfig | ConnectionUrlInput, options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot>;

  function createConnection(url: MySqlConnectionUrl, overrides?: Partial<mysql.ConnectionConfig>): mysql.Connection;
  function createConnection(url: PostgreSqlConnectionUrl, overrides?: Partial<postgresql.PostgreSqlConnectionOptions>): postgresql.Connection;
  function createConnection(url: SqlServerConnectionUrl, overrides?: Partial<sqlserver.SqlServerConnectionConfig>): sqlserver.Connection;
  function createConnection(url: SqliteConnectionUrl, overrides?: Partial<sqlite.SQLiteConnectionOptions>): sqlite.Connection;
  function createConnection(url: URL, overrides?: Record<string, unknown>): mysql.Connection | postgresql.Connection | sqlite.Connection | sqlserver.Connection;
  function createConnection(config: MySqlUrlConfig): mysql.Connection;
  function createConnection(config: PostgreSqlUrlConfig): postgresql.Connection;
  function createConnection(config: SqlServerUrlConfig): sqlserver.Connection;
  function createConnection(config: SqliteUrlConfig): sqlite.Connection;
  function createConnection<D extends root.DialectAlias>(dialect: D, config?: DialectConnectionConfig<D>): DialectConnection<D>;

  function createPool(url: MySqlConnectionUrl, overrides?: Partial<mysql.PoolConfig>): mysql.Pool;
  function createPool(url: PostgreSqlConnectionUrl, overrides?: Partial<postgresql.PostgreSqlPoolConfig>): postgresql.Pool;
  function createPool(url: SqlServerConnectionUrl, overrides?: Partial<sqlserver.SqlServerPoolConfig>): sqlserver.Pool;
  function createPool(url: URL, overrides?: Record<string, unknown>): mysql.Pool | postgresql.Pool | sqlserver.Pool;
  function createPool(config: MySqlUrlConfig & Partial<mysql.PoolConfig>): mysql.Pool;
  function createPool(config: PostgreSqlUrlConfig & Partial<postgresql.PostgreSqlPoolConfig>): postgresql.Pool;
  function createPool(config: SqlServerUrlConfig & Partial<sqlserver.SqlServerPoolConfig>): sqlserver.Pool;
  function createPool<D extends Exclude<root.DialectAlias, 'sqlite'>>(dialect: D, config?: DialectConnectionConfig<D> & root.ClientPoolOptions): DialectPool<D>;

  function createClient(url: MySqlConnectionUrl, overrides?: Partial<mysql.ConnectionConfig> & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): MySqlClient;
  function createClient(url: PostgreSqlConnectionUrl, overrides?: Partial<postgresql.PostgreSqlConnectionOptions> & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): PostgreSqlClient;
  function createClient(url: SqlServerConnectionUrl, overrides?: Partial<sqlserver.SqlServerConnectionConfig> & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): SqlServerClient;
  function createClient(url: SqliteConnectionUrl, overrides?: Partial<sqlite.SQLiteConnectionOptions> & { pool?: false; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): SqliteClient;
  function createClient(url: URL, overrides?: Record<string, unknown>): MySqlClient | PostgreSqlClient | SqliteClient | SqlServerClient;

  function createClient(config: MySqlUrlConfig & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): MySqlClient;
  function createClient(config: PostgreSqlUrlConfig & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): PostgreSqlClient;
  function createClient(config: SqlServerUrlConfig & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): SqlServerClient;
  function createClient(config: SqliteUrlConfig & { pool?: false; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): SqliteClient;

  function createClient(config: mysql.ConnectionConfig & { dialect: 'mysql'; pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): MySqlClient;
  function createClient(config: postgresql.PostgreSqlConnectionOptions & { dialect: 'postgresql' | 'postgres' | 'pg'; pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): PostgreSqlClient;
  function createClient(config: sqlite.SQLiteConnectionOptions & { dialect: 'sqlite'; pool?: false; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): SqliteClient;
  function createClient(config: sqlserver.SqlServerConnectionConfig & { dialect: 'sqlserver' | 'mssql' | 'sql-server'; pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): SqlServerClient;

  function createClient<D extends root.DialectAlias>(dialect: D, config?: DialectClientConfig<D>): DialectClient<D>;
}
