import type {BindValue,QueryResult,SessionInfo} from '../core/contracts.js';
import type {OperationOptions} from '../core/resources.js';
/** A server-side statement pinned to its originating native connection. */
export interface RelationalPreparedStatement {
  readonly parameterCount:number;
  readonly closed:boolean;
  execute(parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  close():Promise<void>;
}

export interface RelationalTransaction {
  query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>;
}
export interface RelationalSession {
  readonly info:Readonly<SessionInfo>;
  readonly closed:boolean;
  query(sql:string,parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  prepare(sql:string,options?:OperationOptions):Promise<RelationalPreparedStatement>;
  transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options?:OperationOptions):Promise<T>;
  /** Immediately closes the connection; interrupts any active operation. */
  close():Promise<void>;
}
