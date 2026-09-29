import mysql = require('./packages/mysql');
import postgresql = require('./packages/postgresql');
import sqlite = require('./packages/sqlite');
import sqlCore = require('./packages/sql-core');

type Dialect = 'mysql' | 'postgresql' | 'sqlite';
type DialectAlias = Dialect | 'postgres' | 'pg';

type MySqlConfig = ConstructorParameters<typeof mysql.Connection>[0] & { dialect: 'mysql' };
type PostgreSqlConfig = ConstructorParameters<typeof postgresql.Connection>[0] & { dialect: 'postgresql' | 'postgres' | 'pg' };
type SqliteConfig = ConstructorParameters<typeof sqlite.Connection>[0] & { dialect: 'sqlite' };

type ConnectionConfig = MySqlConfig | PostgreSqlConfig | SqliteConfig;

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

export {
  Dialect,
  DialectAlias,
  ConnectionConfig,
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
  createPool
};
