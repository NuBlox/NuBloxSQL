import type {BindValue,QueryResult,SessionInfo,MysqlColumn} from '../core/contracts.js';
import type {Readable} from 'node:stream';
import type {OperationOptions} from '../core/resources.js';
/** A server-side statement pinned to its originating native connection. */
export interface RelationalPreparedStatement {
  readonly parameterCount:number;
  readonly closed:boolean;
  execute(parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  executeResults(parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult[]>;
  close():Promise<void>;
}

/** One row fetched from a server-side cursor, preserving duplicate-name columns. */
export interface RelationalCursorRow {
  readonly row:Readonly<Record<string,unknown>>;
  readonly values:readonly unknown[];
}
/** Bounded batches from a native, read-only forward-only cursor. */
export interface RelationalCursor extends AsyncIterableIterator<RelationalCursorRow> {
  readonly columns:readonly import('../core/contracts.js').MysqlColumn[];
  readonly columnKeys:readonly string[];
  readonly closed:boolean;
  close():Promise<void>;
}
export interface CursorOptions extends OperationOptions {
  /** Rows fetched per COM_STMT_FETCH; integer 1–256 (default 64). */
  readonly fetchSize?:number;
}

/** Node.js object-mode row stream. Rows preserve positional values and aliases.
 * The stream is owned by withRowStream's callback: it cannot outlive the
 * exclusive native cursor scope or its originating pooled lease. */
export interface RelationalRowStream extends Readable {
  readonly columns:readonly MysqlColumn[];
  readonly columnKeys:readonly string[];
  [Symbol.asyncIterator]():NodeJS.AsyncIterator<RelationalCursorRow>;
}

/** The Readable high-water mark counts row objects, not bytes or fetch batches. */
export interface RowStreamOptions extends CursorOptions {
  /** Max queued Readable row objects, integer 1–32 (default 8). */
  readonly highWaterMark?:number;
}
export interface RelationalTransaction {
  query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>;
  queryResults(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult[]>;
  /** Literal non-prepared SQL; never interpolates or binds user values. */
  queryText(sql:string):Promise<QueryResult>;
  queryTextResults(sql:string):Promise<QueryResult[]>;
}
export interface RelationalSession {
  readonly info:Readonly<SessionInfo>;
  readonly closed:boolean;
  query(sql:string,parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  queryResults(sql:string,parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult[]>;
  /** COM_QUERY literal SQL. Use prepared query() for untrusted data. */
  queryText(sql:string,options?:OperationOptions):Promise<QueryResult>;
  queryTextResults(sql:string,options?:OperationOptions):Promise<QueryResult[]>;
  prepare(sql:string,options?:OperationOptions):Promise<RelationalPreparedStatement>;
  withCursor<T>(
    sql:string,parameters:readonly BindValue[],
    work:(cursor:RelationalCursor)=>Promise<T>,
    options?:CursorOptions
  ):Promise<T>;
  /** Demand-driven, callback-scoped Node Readable backed by COM_STMT_FETCH. */
  withRowStream<T>(
    sql:string,parameters:readonly BindValue[],
    work:(rows:RelationalRowStream)=>Promise<T>,
    options?:RowStreamOptions
  ):Promise<T>;
  transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options?:OperationOptions):Promise<T>;
  /** Immediately closes the connection; interrupts any active operation. */
  close():Promise<void>;
}
