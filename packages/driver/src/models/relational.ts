import type {BindValue,QueryResult,SessionInfo} from '../core/contracts.js';
export interface RelationalTransaction{query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>}
export interface RelationalSession{
  readonly info:Readonly<SessionInfo>;
  readonly closed:boolean;
  query(sql:string,parameters?:readonly BindValue[]):Promise<QueryResult>;
  transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>):Promise<T>;
  close():Promise<void>;
}
