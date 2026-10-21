import type {BindValue,QueryResult,SessionInfo} from '../core/contracts.js';
import type {OperationOptions} from '../core/resources.js';
export interface RelationalTransaction {
  query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>;
}
export interface RelationalSession {
  readonly info:Readonly<SessionInfo>;
  readonly closed:boolean;
  query(sql:string,parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options?:OperationOptions):Promise<T>;
  /** Immediately closes the connection; interrupts any active operation. */
  close():Promise<void>;
}
