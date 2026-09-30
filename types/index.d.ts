import mysql = require('../lib/dialects/mysql');
import postgresql = require('../lib/dialects/postgresql');
import sqlite = require('../lib/dialects/sqlite');
import sqlserver = require('../lib/dialects/sqlserver');
import type * as root from '../index';

export * from '../index';

export type MySqlConnectionUrl = `mysql://${string}` | `mysql2://${string}`;
export type PostgreSqlConnectionUrl = `postgres://${string}` | `postgresql://${string}`;
export type SqlServerConnectionUrl = `mssql://${string}` | `sqlserver://${string}`;
export type SqliteConnectionUrl = `sqlite:${string}`;
export type ConnectionUrl = MySqlConnectionUrl | PostgreSqlConnectionUrl | SqlServerConnectionUrl | SqliteConnectionUrl;
export type ConnectionUrlInput = ConnectionUrl | URL;
export type ClientLifecycleState = 'idle' | 'opening' | 'open' | 'closing' | 'closed';

export interface CapabilitySupportEntry {
  readonly supported: boolean;
  readonly source: 'dialect';
}

export interface CapabilityRuntimeInfo {
  readonly nodeVersion: string;
  readonly v8Version: string | null;
  readonly modules: string | null;
  readonly sqliteVersion: string | null;
  readonly platform: string;
  readonly arch: string;
}

export interface CapabilityServerInfo {
  readonly connected: boolean;
  readonly version: string | null;
  readonly protocolVersion: number | null;
  readonly [key: string]: unknown;
}

export interface CapabilityReport {
  readonly dialect: root.Dialect;
  readonly identity: unknown;
  readonly capabilities: Readonly<Record<string, boolean>>;
  readonly support: Readonly<Record<string, CapabilitySupportEntry>>;
  readonly plannedCapabilities: Readonly<Record<string, boolean>>;
  readonly runtime: CapabilityRuntimeInfo;
  readonly server: CapabilityServerInfo | null;
  readonly pool: boolean;
}

export interface MetadataIntrospectionOptions extends root.MetadataScope {
  deep?: boolean;
  concurrency?: number;
  tables?: readonly string[];
}

export interface MetadataSnapshot {
  readonly dialect: root.Dialect;
  readonly scope: Readonly<root.MetadataScope>;
  readonly databases: readonly root.DatabaseMetadata[];
  readonly schemas: readonly root.SchemaMetadata[];
  readonly tables: readonly root.TableMetadata[];
}

export const CLIENT_LIFECYCLE_STATES: Readonly<{
  IDLE: 'idle'; OPENING: 'opening'; OPEN: 'open'; CLOSING: 'closing'; CLOSED: 'closed';
}>;

export const ERROR_CODES: Readonly<{
  CONFIGURATION: 'NUBLOXSQL_CONFIGURATION';
  ROUTING: 'NUBLOXSQL_ROUTING';
  UNSUPPORTED_DIALECT: 'NUBLOXSQL_UNSUPPORTED_DIALECT';
  UNSUPPORTED_URL_SCHEME: 'NUBLOXSQL_UNSUPPORTED_URL_SCHEME';
  CLIENT_LIFECYCLE: 'NUBLOXSQL_CLIENT_LIFECYCLE';
  UNSUPPORTED: 'NUBLOXSQL_UNSUPPORTED';
}>;

export type MySqlUrlConfig = Partial<mysql.ConnectionConfig> & { url: MySqlConnectionUrl | URL; dialect?: 'mysql' };
export type PostgreSqlUrlConfig = Partial<postgresql.PostgreSqlConnectionOptions> & { url: PostgreSqlConnectionUrl | URL; dialect?: 'postgresql' | 'postgres' | 'pg' };
export type SqlServerUrlConfig = Partial<sqlserver.SqlServerConnectionConfig> & { url: SqlServerConnectionUrl | URL; dialect?: 'sqlserver' | 'mssql' | 'sql-server' };
export type SqliteUrlConfig = Partial<sqlite.SQLiteConnectionOptions> & { url: SqliteConnectionUrl | URL; dialect?: 'sqlite' };
export type UrlConnectionConfig = MySqlUrlConfig | PostgreSqlUrlConfig | SqlServerUrlConfig | SqliteUrlConfig;

declare module '../index' {
  interface MetadataCatalog {
    snapshot(options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot>;
  }

  interface Client {
    readonly lifecycleState: ClientLifecycleState;
    readonly isOpen: boolean;
    readonly isClosed: boolean;
    readonly catalog: MetadataCatalog;
    connect(): Promise<this>;
    open(): Promise<this>;
    close(): Promise<void>;
    end(): Promise<void>;
    capabilityReport(): CapabilityReport;
    discoverCapabilities(options?: { acquire?: root.ClientAcquireOptions }): Promise<CapabilityReport>;
    introspect(options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot>;
  }

  function capabilityReport(dialect: root.DialectAlias): CapabilityReport;
  function introspect(config: root.ClientConfig | UrlConnectionConfig | ConnectionUrlInput, options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot>;
  function introspect(dialect: root.DialectAlias, config?: Record<string, unknown>, options?: MetadataIntrospectionOptions): Promise<MetadataSnapshot>;

  function createConnection(url: MySqlConnectionUrl, overrides?: Partial<mysql.ConnectionConfig>): mysql.Connection;
  function createConnection(url: PostgreSqlConnectionUrl, overrides?: Partial<postgresql.PostgreSqlConnectionOptions>): postgresql.Connection;
  function createConnection(url: SqlServerConnectionUrl, overrides?: Partial<sqlserver.SqlServerConnectionConfig>): sqlserver.Connection;
  function createConnection(url: SqliteConnectionUrl, overrides?: Partial<sqlite.SQLiteConnectionOptions>): sqlite.Connection;
  function createConnection(url: URL, overrides?: Record<string, unknown>): mysql.Connection | postgresql.Connection | sqlite.Connection | sqlserver.Connection;
  function createConnection(config: MySqlUrlConfig): mysql.Connection;
  function createConnection(config: PostgreSqlUrlConfig): postgresql.Connection;
  function createConnection(config: SqlServerUrlConfig): sqlserver.Connection;
  function createConnection(config: SqliteUrlConfig): sqlite.Connection;

  function createPool(url: MySqlConnectionUrl, overrides?: Partial<mysql.PoolConfig>): mysql.Pool;
  function createPool(url: PostgreSqlConnectionUrl, overrides?: Partial<postgresql.PostgreSqlPoolConfig>): postgresql.Pool;
  function createPool(url: SqlServerConnectionUrl, overrides?: Partial<sqlserver.SqlServerPoolConfig>): sqlserver.Pool;
  function createPool(url: URL, overrides?: Record<string, unknown>): mysql.Pool | postgresql.Pool | sqlserver.Pool;
  function createPool(config: MySqlUrlConfig & Partial<mysql.PoolConfig>): mysql.Pool;
  function createPool(config: PostgreSqlUrlConfig & Partial<postgresql.PostgreSqlPoolConfig>): postgresql.Pool;
  function createPool(config: SqlServerUrlConfig & Partial<sqlserver.SqlServerPoolConfig>): sqlserver.Pool;

  function createClient(url: MySqlConnectionUrl, overrides?: Partial<mysql.ConnectionConfig> & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): root.Client;
  function createClient(url: PostgreSqlConnectionUrl, overrides?: Partial<postgresql.PostgreSqlConnectionOptions> & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): root.Client;
  function createClient(url: SqlServerConnectionUrl, overrides?: Partial<sqlserver.SqlServerConnectionConfig> & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): root.Client;
  function createClient(url: SqliteConnectionUrl, overrides?: Partial<sqlite.SQLiteConnectionOptions> & { pool?: false; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): root.Client;
  function createClient(url: URL, overrides?: Record<string, unknown>): root.Client;
  function createClient(config: UrlConnectionConfig & { pool?: boolean | root.ClientPoolOptions; telemetry?: root.TelemetryOptions; types?: root.TypeOptions }): root.Client;
}
