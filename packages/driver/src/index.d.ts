export type BindValue = null | boolean | string | number | bigint | Uint8Array;
export type MysqlTarget = {engine:'mysql';host:string;port:number;user:string;password:string;database?:string;security:'verified-tls'|'isolated-local';ca?:string;serverName?:string;timeoutMs?:number};
export type MysqlColumn = {name:string;schema:string|null;table:string|null;charset:number;length:number;type:number;flags:number;decimals:number;unsigned:boolean};
export type QueryResult = {rows:Array<Record<string, unknown>>;columns:MysqlColumn[];affectedRows:number;insertId:number;status?:number;warnings?:number};
export declare class DriverError extends Error {readonly code:string;readonly vendorCode:number|null;readonly sqlState:string|null;}
export declare class MysqlSession {
 readonly info: Readonly<{engine:'mysql';model:'relational';version:string;transport:'verified-tls'|'isolated-local';authPlugin:string;capabilities:readonly string[]}>;
 readonly closed:boolean;
 query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>;
 transaction<T>(work:(transaction:{query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>})=>Promise<T>):Promise<T>;
 close():Promise<void>;
}
export declare function connectDatabase(target:MysqlTarget):Promise<MysqlSession>;
