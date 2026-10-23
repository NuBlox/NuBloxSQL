import {fail} from '../../core/errors.js';
import type {BindValue,QueryResult} from '../../core/contracts.js';
import type {OperationOptions} from '../../core/resources.js';
import type {RelationalPreparedStatement} from '../../models/relational.js';

/** The statement belongs to one authenticated native MySQL session.
 * It must never migrate to a different physical connection. */
export class MysqlPreparedStatement implements RelationalPreparedStatement {
  private invalid=false;
  private closing:Promise<void>|null=null;

  constructor(
    readonly parameterCount:number,
    private readonly run:(params:readonly BindValue[],options:OperationOptions)=>Promise<QueryResult>,
    private readonly dispose:()=>Promise<void>,
    private readonly assertNotNested:()=>void=()=>{},
    private readonly runResults:(params:readonly BindValue[],options:OperationOptions)=>Promise<QueryResult[]>
  ){}

  get closed():boolean{return this.invalid;}

  async execute(params:readonly BindValue[]=[],options:OperationOptions={}):Promise<QueryResult>{
    if(this.invalid)throw fail('CONNECTION_CLOSED','Prepared statement is closed');
    return this.run(params,options);
  }

  async executeResults(params:readonly BindValue[]=[],options:OperationOptions={}):Promise<QueryResult[]>{
    if(this.invalid)throw fail('CONNECTION_CLOSED','Prepared statement is closed');
    return this.runResults(params,options);
  }

  async close():Promise<void>{
    // This must precede *all* early returns: awaiting a close that was
    // previously queued by another caller can itself cause re-entrant deadlock.
    this.assertNotNested();
    if(this.closing)return this.closing;
    if(this.invalid)return;
    this.invalid=true;
    this.closing=this.dispose();
    await this.closing;
  }

  /** A reset or terminated native session revokes all outstanding handles. */
  invalidate():void{this.invalid=true;}
}
