/** Stable public connection and result contracts. */
export type BindValue=null|boolean|string|number|bigint|Uint8Array;
export type MysqlSecurity='verified-tls'|'isolated-local';
export interface MysqlTarget {engine:'mysql';host:string;port:number;user:string;password:string;database?:string;security:MysqlSecurity;ca?:string;serverName?:string;timeoutMs?:number;}
export type DatabaseTarget=MysqlTarget;
export interface MysqlColumn {name:string;schema:string|null;table:string|null;originalTable?:string|null;originalName?:string|null;charset:number;length:number;type:number;flags:number;decimals:number;unsigned:boolean;}
/**
 * Result columns remain positional, even when multiple expressions share a name.
 * rows and columnKeys provide collision-free convenience access; rowValues is
 * the lossless ordered representation aligned with columns.
 */
export interface QueryResult {
  rows:Array<Record<string,unknown>>;
  columns:MysqlColumn[];
  columnKeys?:string[];
  rowValues?:unknown[][];
  affectedRows:number;
  insertId:number;
  status?:number;
  warnings?:number;
}
export interface SessionInfo {engine:'mysql';model:'relational';version:string;transport:MysqlSecurity;authPlugin:string;capabilities:readonly string[];}
