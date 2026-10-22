import type {BindValue,QueryResult,SessionInfo} from '../core/contracts.js';
import type {OperationOptions} from '../core/resources.js';
/** A server-side statement pinned to its originating native connection. */
export interface RelationalPreparedStatement {
  readonly parameterCount:number;
  readonly closed:boolean;
  execute(parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
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
export interface RelationalTransaction {
  query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>;
}
export interface RelationalSession {
  readonly info:Readonly<SessionInfo>;
  readonly closed:boolean;
  query(sql:string,parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  prepare(sql:string,options?:OperationOptions):Promise<RelationalPreparedStatement>;
  withCursor<T>(
    sql:string,parameters:readonly BindValue[],
    work:(cursor:RelationalCursor)=>Promise<T>,
    options?:CursorOptions
  ):Promise<T>;
  transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options?:OperationOptions):Promise<T>;
  /** Immediately closes the connection; interrupts any active operation. */
  close():Promise<void>;
}
