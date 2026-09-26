import mysql = require('./index');

declare namespace promiseMysql {
  function createConnection(config: string | mysql.ConnectionOptions): mysql.PromiseConnection;
  function createPool(config: string | mysql.PoolOptions): mysql.PromisePool;
  function escape(value: unknown, stringifyObjects?: boolean, timeZone?: string): string;
  function escapeId(value: unknown, forbidQualified?: boolean): string;
  function format(sql: string, values?: unknown[], stringifyObjects?: boolean, timeZone?: string): string;
  function raw(sql: string): object;
  const param: mysql.PreparedParameterFactory;
  const Types: Record<string, number>;
}

export = promiseMysql;
