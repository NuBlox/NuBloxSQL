import {DriverError,fail} from '../../core/errors.js';
import type {BindValue,QueryResult} from '../../core/contracts.js';
import type {OperationOptions} from '../../core/resources.js';
import type {RelationalPreparedStatement} from '../../models/relational.js';

/** The statement belongs to one authenticated native MySQL session.
 * It must never migrate to a different physical connection. */
export class MysqlPreparedStatement implements RelationalPreparedStatement {
  private invalid=false;
  /** A reset/transport loss permanently revokes the server-owned handle. */
  private revoked=false;
  private closing:Promise<void>|null=null;

  constructor(
    readonly parameterCount:number,
    private readonly run:(params:readonly BindValue[],options:OperationOptions)=>Promise<QueryResult>,
    private readonly dispose:()=>Promise<void>,
    private readonly assertNotNested:()=>void,
    private readonly runResults:(params:readonly BindValue[],options:OperationOptions)=>Promise<QueryResult[]>
  ){}

  get closed():boolean{return this.invalid;}

  /** Native session reset/revocation can happen after an execution enters
   * the FIFO but before its turn begins. Never send that stale statement ID
   * to a subsequent session generation on the same physical connection.
   * Explicit close is different: older accepted FIFO executions may finish
   * ahead of their queued COM_STMT_CLOSE. */
  assertSessionOwned():void{
    if(this.revoked)throw fail('CONNECTION_CLOSED','Prepared statement no longer belongs to this MySQL session');
  }

  get sessionRevoked():boolean{return this.revoked;}

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
    this.closing=this.dispose().catch(error=>{
      // If the bounded session queue is full, COM_STMT_CLOSE never entered
      // the wire. Keep this handle usable and retryable; the server statement
      // remains allocated and counted against the per-session limit.
      // Never revive a handle revoked concurrently by reset/disconnect.
      if(error instanceof DriverError&&error.code==='RESOURCE_LIMIT'){
        // A simultaneous reset/disconnect may have revoked the handle.
        // Clear only the stale failed close attempt in that case; later
        // idempotent close() calls must not inherit its rejection.
        if(!this.revoked)this.invalid=false;
        this.closing=null;
      }
      throw error;
    });
    await this.closing;
  }

  /** A reset or terminated native session revokes all outstanding handles. */
  invalidate():void{this.revoked=true;this.invalid=true;}
}
