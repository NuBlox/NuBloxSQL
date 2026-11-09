import net, {type Socket} from 'node:net';
import {AsyncLocalStorage} from 'node:async_hooks';
import tls from 'node:tls';
import {PacketStream} from './protocol/framing.js';
import {cstr,LIMIT,u32,wellFormedUtf16} from './protocol/primitives.js';
import {greeting,flags,login,sslRequest,authSwitchRequest,cachingSha2AuthMore,authenticationOk,type MysqlGreeting} from './protocol/handshake.js';
import {assertSupportedAuthPlugin,token} from './auth/plugins.js';
import {execute,fetchRows} from './protocol/commands.js';
import {MysqlCursor} from './cursor.js';
import {cursorRowStream} from '../../core/row-stream.js';
import {MysqlMaterializationBudget} from './materialization.js';
import {MysqlPreparedStatement} from './prepared.js';
import {MysqlStatementCache,cacheableMysqlSql,type CachedMysqlStatement} from './statement-cache.js';
import {ok,acknowledgedOk,prepareOk,eofStatus,assertSingleResult,binaryResultColumnCount} from './protocol/results.js';
import {binaryValues,columnKeys,objectRow} from './types.js';
import {textValues} from './text-results.js';
import {serverPacket,eof,isOk} from './errors.js';
import {validate} from './configuration.js';
import {mysqlCapabilities} from './capabilities.js';
import {readMetadata,readMetadataWithStatus} from './metadata.js';
import {DriverError,fail} from '../../core/errors.js';
import {MAX_RESULT_ROWS,MAX_RESULT_CELLS,MAX_RESULT_SETS,MAX_PARAMETERS,MAX_COLUMNS,MAX_PREPARED_STATEMENTS,operationOptions,OperationGuard,type OperationOptions} from '../../core/resources.js';
import type {BindValue,MysqlTarget,QueryResult,SessionInfo} from '../../core/contracts.js';
import type {RelationalSession,RelationalTransaction,RelationalCursorRow,CursorOptions,RelationalRowStream,RowStreamOptions} from '../../models/relational.js';

type ValidMysqlTarget=MysqlTarget&{timeoutMs:number};
type TransactionOutcome<T>={success:true;value:T}|{success:false;error:unknown};
type QueuedJob={start:()=>void;reject:(error:DriverError)=>void};
const MAX_PENDING_COMMANDS=1024;
/** MySQL Classic SERVER_STATUS_IN_TRANS, set while the server owns a transaction. */
const SERVER_STATUS_IN_TRANS=0x0001;

export class MysqlSession implements RelationalSession {
  readonly info:Readonly<SessionInfo>;
  closed=false;
  private readonly queue:QueuedJob[]=[];
  private busy=false;
  private activeGuard:OperationGuard|null=null;
  /** Explicit error that revoked the session, for cursor cleanup races. */
  private terminalCause:unknown;
  private readonly statements=new Set<MysqlPreparedStatement>();
  /** Cache belongs only to this authenticated physical session. */
  private readonly statementCache:MysqlStatementCache;
  /** The active server cursor is revoked on any fatal transport loss. */
  private readonly cursors=new Set<MysqlCursor>();
  private preparing=0;
  /** These commands may have taken effect before their acknowledgement was lost. */
  private commitAwaitingAck=false;
  private rollbackAwaitingAck=false;
  /** Distinguishes a nested call in an exclusive callback from independent
   * concurrent callers, which must continue to queue normally. */
  private readonly scope=new AsyncLocalStorage<{active:boolean;kind:'transaction'|'cursor'}>();

  constructor(
    private readonly stream:PacketStream,
    private readonly socket:Socket,
    private readonly target:ValidMysqlTarget,
    hello:MysqlGreeting
  ){
    this.statementCache=new MysqlStatementCache(target.statementCacheSize??0);
    this.info=Object.freeze({
      engine:'mysql',model:'relational',version:hello.version,
      transport:target.security,authPlugin:hello.plugin,capabilities:mysqlCapabilities
    });
    // Remote closes can happen between operations when no read is pending.
    // Immediately revoke prepared handles and remove the stale pool session.
    this.stream.onFatal(error=>this.destroy(error instanceof DriverError?error:undefined));
  }

  private destroy(cause?:unknown):void {
    if(this.closed)return;
    this.terminalCause=cause;
    this.closed=true;
    // A transport failure can occur while an exclusive transaction/cursor
    // callback is awaiting application work rather than a packet read.
    // Interrupt its guard immediately instead of waiting for the callback
    // or the operation deadline. The closed flag makes re-entrant destroy
    // from OperationGuard's interruption callback safe.
    this.activeGuard?.interrupt(cause??
      fail('CONNECTION_CLOSED','Native MySQL connection terminated during operation')
    );
    for(const statement of this.statements)statement.invalidate();
    this.statements.clear();
    this.statementCache.clear();
    for(const cursor of this.cursors)cursor.invalidate();
    this.cursors.clear();
    const queued=this.queue.splice(0);
    for(const job of queued)
      job.reject(fail('CONNECTION_CLOSED','Database connection is closed'));
    this.stream.destroy();
    this.socket.destroy();
  }

  private assertOpen():void {
    if(this.closed)throw fail('CONNECTION_CLOSED','Database connection is closed');
  }

  private drain():void {
    if(this.closed||this.busy)return;
    this.queue.shift()?.start();
  }

  /** Reject re-entrant parent-session I/O instead of queuing it behind the
   * transaction/cursor callback which is waiting for that very I/O. */
  private assertNotInsideExclusiveCallback():void {
    const context=this.scope.getStore();
    if(context?.active)
      throw fail('INVALID_INPUT',
        'Parent session commands are not allowed in an active '+context.kind+' callback');
  }

  /** One active command per native connection; pending aborts never damage it. */
  private serial<T>(fn:()=>Promise<T>,options:OperationOptions={}):Promise<T>{
    this.assertNotInsideExclusiveCallback();
    const {signal,timeoutMs}=operationOptions(options,this.target.timeoutMs);
    if(this.closed)return Promise.reject(fail('CONNECTION_CLOSED','Session is closed'));
    if(signal?.aborted)return Promise.reject(fail('CANCELLED','Database operation cancelled'));
    if(this.queue.length>=MAX_PENDING_COMMANDS)
      return Promise.reject(fail('RESOURCE_LIMIT','Too many pending MySQL commands'));
    return new Promise<T>((resolve,reject)=>{
      let state:'queued'|'active'|'done'='queued';
      const cancelQueued=():void=>{
        if(state!=='queued')return;
        const i=this.queue.indexOf(job);
        if(i>=0)this.queue.splice(i,1);
        state='done';
        signal?.removeEventListener('abort',cancelQueued);
        reject(fail('CANCELLED','Queued database operation cancelled'));
      };
      const job:QueuedJob={
        reject:(error)=>{
          if(state!=='queued')return;
          state='done';
          signal?.removeEventListener('abort',cancelQueued);
          reject(error);
        },
        start:()=>{
          signal?.removeEventListener('abort',cancelQueued);
          if(this.closed){job.reject(fail('CONNECTION_CLOSED','Session is closed'));return;}
          if(signal?.aborted){job.reject(fail('CANCELLED','Queued database operation cancelled'));this.drain();return;}
          state='active';
          this.busy=true;
          const guard=new OperationGuard(timeoutMs,signal,()=>this.destroy());
          this.activeGuard=guard;
          Promise.race([Promise.resolve().then(()=>{
            this.assertOpen();
            return fn();
          }),guard.interrupted]).then(
            value=>resolve(value),
            error=>{
              // A COMMIT may already be durable even if its acknowledgement
              // never arrives. Never transform this into a definite rollback
              // or retry the command on another socket.
              const ambiguousCommit=this.commitAwaitingAck;
              const ambiguousRollback=this.rollbackAwaitingAck;
              const mapped=ambiguousCommit
                ?fail('TRANSACTION_OUTCOME_UNKNOWN',
                  'COMMIT acknowledgement was not confirmed; transaction outcome is unknown')
                :ambiguousRollback
                  ?fail('TRANSACTION_OUTCOME_UNKNOWN',
                    'ROLLBACK acknowledgement was not confirmed; transaction outcome is unknown')
                :error instanceof DriverError
                  ?error // preserve RESOURCE_LIMIT, CANCELLED, TIMEOUT, server codes
                  :this.closed&&error!==this.terminalCause
                    ?fail('CONNECTION_CLOSED','Native MySQL connection terminated during operation')
                    :error;
              if(ambiguousCommit||ambiguousRollback||!(mapped instanceof DriverError&&
                (mapped.code==='DATABASE_ERROR'||mapped.code==='INVALID_INPUT'||
                 mapped.code==='CANCELLED'||mapped.code==='TIMEOUT'||
                 mapped.code==='CONNECTION_CLOSED')))
                this.destroy();
              reject(mapped);
            }
          ).finally(()=>{
            guard.dispose();
            this.activeGuard=null;
            state='done';
            this.busy=false;
            this.drain();
          });
        }
      };
      // An idle session has no scheduling contention: start directly instead
      // of allocating an array slot and immediately shifting it away.
      // Contending callers still use the same bounded FIFO queue.
      const uncontended=!this.busy&&this.queue.length===0;
      if(!uncontended)this.queue.push(job);
      signal?.addEventListener('abort',cancelQueued,{once:true});
      // Recheck after subscription: a signal can abort during registration.
      if(signal?.aborted)cancelQueued();
      else if(state==='queued'){
        if(uncontended)job.start();
        else if(!this.busy)this.drain();
        // An active command's completion will drain the queued jobs.
        // Avoid calling drain() for each contender while busy.
      }
    });
  }

  private async send(body:Buffer):Promise<void>{this.assertOpen();await this.stream.send(body);}
  private async get():Promise<Buffer>{return serverPacket(await this.stream.read());}
  private async metadata(count:number){return readMetadata(()=>this.get(),count);}

  /** Validate before changing server-side cache ownership. A failed local
   * SQL check must not evict a previously usable prepared statement. */
  private validatePreparedSql(sql:string):void{
    if(typeof sql!=='string'||!sql.trim()||sql.includes('\0')||
       !wellFormedUtf16(sql)||Buffer.byteLength(sql,'utf8')+1>LIMIT)
      throw fail('INVALID_INPUT','Invalid SQL statement');
  }

  /** COM_STMT_PREPARE assigns one server statement ID; metadata is consumed
   * completely before the next command can enter the MySQL packet stream. */
  private async prepareNative(sql:string):Promise<{id:number;parameterCount:number}>{
    this.assertOpen();
    this.validatePreparedSql(sql);
    this.stream.reset();
    await this.send(Buffer.concat([Buffer.from([0x16]),Buffer.from(sql,'utf8')]));
    const {id,columnCount,parameterCount}=prepareOk(await this.get());
    // The server has allocated an ID and may still be streaming metadata.
    // If any metadata packet fails validation (including a typed server
    // DATABASE_ERROR), no protocol boundary can be trusted for reuse.
    // COM_STMT_CLOSE would itself be unsafe while unread metadata remains.
    try{
      if(parameterCount>MAX_PARAMETERS||columnCount>MAX_COLUMNS)
        throw fail('RESOURCE_LIMIT','Prepared statement metadata exceeds supported limits');
      if(parameterCount)await this.metadata(parameterCount);
      if(columnCount)await this.metadata(columnCount);
      return {id,parameterCount};
    }catch(error){
      this.destroy(error instanceof DriverError?error:undefined);
      throw error;
    }
  }

  /** One COM_STMT_EXECUTE can return multiple binary result sets and a final
   * stored-procedure OK. Always drain each result to preserve packet framing. */
  private async executeNativeResults(
    id:number,expected:number,params:readonly BindValue[]
  ):Promise<QueryResult[]>{
    this.assertOpen();
    if(!Array.isArray(params)||params.length!==expected)
      throw fail('INVALID_INPUT','Prepared statement parameter count mismatch');
    let command:Buffer;
    try{command=execute(id,params);}
    catch(error){
      if(error instanceof TypeError||error instanceof RangeError)
        throw fail('INVALID_INPUT','Invalid prepared statement bound parameter');
      throw error;
    }
    this.stream.reset();
    await this.send(command);
    const results:QueryResult[]=[];
    const materialization=new MysqlMaterializationBudget();
    let totalRows=0,totalCells=0,responseBytes=0;
    let responseStarted=false;
    // An ERR as the *first* response is a normal recoverable SQL failure.
    // Once metadata/rows/results have begun, any server ERR leaves the
    // remainder of the exchange uncertain. Never put that socket back in
    // circulation or transmit COM_STMT_CLOSE into its unread response.
    const readResultPacket=async():Promise<Buffer>=>{
      try{
        const packet=await this.get();
        responseStarted=true;
        // Bound the entire response, not just row bodies. Metadata, column
        // counts, EOF boundaries and subsequent result sets all contribute
        // to memory pressure before queryResults can return to the caller.
        responseBytes+=packet.length;
        if(responseBytes>LIMIT)
          throw fail('RESOURCE_LIMIT','Combined MySQL result response exceeds byte limit');
        return packet;
      }catch(error){
        if(responseStarted)this.destroy(error instanceof DriverError?error:undefined);
        throw error;
      }
    };
    let next=await readResultPacket();
    for(;;){
      if(results.length>=MAX_RESULT_SETS)
        throw fail('RESOURCE_LIMIT','Stored procedure exceeded the result-set limit');
      if(isOk(next)){
        const result=ok(next,true);
        results.push(result);
        if(!((result.status??0)&0x0008))return results;
        next=await readResultPacket();
        continue;
      }
      const count=binaryResultColumnCount(next);
      const {columns,status:metadataStatus}=await readMetadataWithStatus(
        ()=>readResultPacket(),count,true
      );
      const keys=columnKeys(columns);
      materialization.columns(columns,keys);
      const rows:Array<Record<string,unknown>>=[];
      const rowValues:unknown[][]=[];
      for(;;){
        const packet=await readResultPacket();
        if(eof(packet)){
          const last=eofStatus(packet);
          const result:QueryResult={
            rows,columns,columnKeys:keys,rowValues,affectedRows:0,insertId:0,
            status:last.status,warnings:last.warnings
          };
          if(metadataStatus&0x1000)result.outParameters=true;
          results.push(result);
          if(!(last.status&0x0008)&&!(metadataStatus&0x1000))return results;
          // MySQL's prepared OUT-parameter EOF can omit MORE_RESULTS even
          // though the trailing CALL status packet is still on the wire.
          next=await readResultPacket();
          break;
        }
        if(++totalRows>MAX_RESULT_ROWS)
          throw fail('RESOURCE_LIMIT','Combined result sets exceed row limit');
        // Every decoded value is retained twice: in positional rowValues
        // and the object-row index. Even all-NULL results can expand far
        // beyond their compact wire bitmap; bound materialized cardinality
        // across every result set before allocating another row.
        totalCells+=columns.length;
        if(totalCells>MAX_RESULT_CELLS)
          throw fail('RESOURCE_LIMIT','Combined result sets exceed materialized cell limit');
        // Estimate retained arrays/objects before allocating another row.
        // Decoded strings and binary views add cost beyond cell cardinality.
        materialization.beforeRow(columns.length);
        const values=binaryValues(packet,columns);
        materialization.decoded(values);
        rowValues.push(values);
        rows.push(objectRow(values,keys));
      }
    }
  }

  /** Existing single-result API stays strict, but drains server results first,
   * so an unsupported multi-result call cannot desynchronise the connection. */
  private async executeNative(
    id:number,expected:number,params:readonly BindValue[]
  ):Promise<QueryResult>{
    const results=await this.executeNativeResults(id,expected,params);
    if(results.length!==1)
      throw fail('UNSUPPORTED_FEATURE',
        'Statement returned multiple results; use queryResults or executeResults');
    return results[0];
  }

  /** COM_STMT_CLOSE has no response packet; the ID is invalid thereafter. */
  private async closeNative(id:number):Promise<void>{
    this.assertOpen();
    this.stream.reset();
    await this.send(Buffer.concat([Buffer.from([0x19]),u32(id)]));
  }

  /**
   * Only implicit query(sql,params) participates in this opt-in cache.
   * Every operation is already inside the session's serial FIFO, so an LRU
   * entry can never execute simultaneously on two database commands.
   */
  private async closeCachedOldest():Promise<void>{
    const oldest=this.statementCache.removeOldest();
    if(!oldest)return;
    try{
      await this.closeNative(oldest.id);
    }catch(error){
      // COM_STMT_CLOSE is unacknowledged. Failure during an eviction means
      // the server's handle state is uncertain; never reuse this session.
      this.destroy(error instanceof DriverError?error:undefined);
      throw error;
    }
  }

  /** Reserve server handle capacity for direct or implicit prepares.
   * Other callers may have reserved explicit handles while queued. */
  private async reservePreparedCapacity(extra:number):Promise<void>{
    while(this.statementCache.size&&
      this.statements.size+this.preparing+this.statementCache.size+extra>
        MAX_PREPARED_STATEMENTS)
      await this.closeCachedOldest();
    if(this.statements.size+this.preparing+this.statementCache.size+extra>
       MAX_PREPARED_STATEMENTS)
      throw fail('RESOURCE_LIMIT','Too many open native MySQL statements');
  }

  private async executeCachedResults(
    sql:string,params:readonly BindValue[]
  ):Promise<QueryResult[]>{
    let prepared:CachedMysqlStatement|undefined=this.statementCache.get(sql);
    const reused=prepared!==undefined;
    if(!prepared){
      // Check SQL before evicting: malformed local input must leave the
      // existing cache usable. Server max_prepared_stmt_count is global, so
      // a full local cache must release an old handle BEFORE COM_STMT_PREPARE
      // rather than briefly using capacity+1 prepared statements.
      this.validatePreparedSql(sql);
      if(this.statementCache.size>=this.statementCache.capacity)
        await this.closeCachedOldest();
      await this.reservePreparedCapacity(1);
      prepared=await this.prepareNative(sql);
    }
    let executionFailed=false,executionError:unknown,successful=false;
    try{
      const result=await this.executeNativeResults(
        prepared.id,prepared.parameterCount,params);
      successful=true;
      return result;
    }catch(error){
      executionFailed=true;
      executionError=error;
      // Retire any session with a partially consumed response, but retain
      // a socket after recoverable server/bind errors. No SQL auto-replay.
      if(!(error instanceof DriverError&&
           (error.code==='DATABASE_ERROR'||error.code==='INVALID_INPUT')))
        this.destroy(error instanceof DriverError?error:undefined);
      throw error;
    }finally{
      if(!this.closed){
        try{
          if(successful){
            if(!reused&&
               this.statements.size+this.preparing+
                 this.statementCache.size>=MAX_PREPARED_STATEMENTS){
              // A queued explicit prepare reserved the final slot while
              // this query executed. Close rather than consuming its slot.
              await this.closeNative(prepared.id);
            }else{
              const removed=this.statementCache.remember(sql,prepared);
              if(removed){
                try{await this.closeNative(removed.id);}
                catch(error){
                  this.destroy(error instanceof DriverError?error:undefined);
                  throw error;
                }
              }
            }
          }else{
            this.statementCache.drop(sql);
            await this.closeNative(prepared.id);
          }
        }catch(error){
          const cause=executionFailed&&executionError instanceof DriverError
            ?executionError:error instanceof DriverError?error:undefined;
          this.destroy(cause);
          if(!executionFailed)throw error;
        }
      }
    }
  }

  private async executeResults(
    sql:string,params:readonly BindValue[]
  ):Promise<QueryResult[]>{
    if(this.statementCache.capacity>0&&cacheableMysqlSql(sql))
      return this.executeCachedResults(sql,params);
    const prepared=await this.prepareNative(sql);
    let executionFailed=false;
    let executionError:unknown;
    try{
      return await this.executeNativeResults(prepared.id,prepared.parameterCount,params);
    }catch(error){
      executionFailed=true;
      executionError=error;
      // A partially consumed result can never be returned to the pool.
      // Preserve the original RESOURCE_LIMIT / protocol error instead of
      // replacing it with a later COM_STMT_CLOSE stream-reset failure.
      if(!(error instanceof DriverError&&
           (error.code==='DATABASE_ERROR'||error.code==='INVALID_INPUT')))
        this.destroy(error instanceof DriverError?error:undefined);
      throw error;
    }finally{
      if(!this.closed){
        try{
          await this.closeNative(prepared.id);
        }catch(error){
          // COM_STMT_CLOSE has no acknowledgement. A failure while sending
          // it cannot be classified as a recoverable SQL error: the session's
          // statement lifetime and wire state are no longer trustworthy.
          // Never lend this connection again, even when the failure itself
          // has a normally recoverable DriverError code.
          // An active operation is also raced against its interruption guard.
          // Give that guard the original SQL diagnostic when there was one;
          // otherwise it could surface the later cleanup failure first.
          const cause=executionFailed&&executionError instanceof DriverError
            ?executionError
            :error instanceof DriverError?error:undefined;
          this.destroy(cause);
          if(!executionFailed)throw error;
        }
      }
    }
  }

  private async execute(sql:string,params:readonly BindValue[]):Promise<QueryResult>{
    const results=await this.executeResults(sql,params);
    if(results.length!==1)
      throw fail('UNSUPPORTED_FEATURE',
        'Statement returned multiple results; use queryResults or executeResults');
    return results[0];
  }

  async query(sql:string,parameters:readonly BindValue[]=[],options:OperationOptions={}):Promise<QueryResult>{
    // Check cardinality AFTER leaving the serial command boundary.
    // The completed protocol exchange is safe to reuse.
    const sets=await this.serial(()=>this.executeResults(sql,parameters),options);
    if(sets.length!==1)
      throw fail('UNSUPPORTED_FEATURE','Statement returned multiple results; use queryResults');
    return sets[0];
  }

  async queryResults(
    sql:string,parameters:readonly BindValue[]=[],options:OperationOptions={}
  ):Promise<QueryResult[]>{
    return this.serial(()=>this.executeResults(sql,parameters),options);
  }

  /**
   * COM_QUERY intentionally sends literal SQL with NO value substitution.
   * Use prepared query(sql, parameters) for every untrusted value. Handle
   * complete Text Protocol result sets and return their native metadata.
   */
  private async executeTextResults(sql:string):Promise<QueryResult[]>{
    this.assertOpen();
    if(typeof sql!=='string'||!sql.trim()||sql.includes('\0')||
       !wellFormedUtf16(sql)||Buffer.byteLength(sql,'utf8')+1>LIMIT)
      throw fail('INVALID_INPUT','Invalid MySQL text-protocol SQL statement');
    const command=Buffer.concat([Buffer.from([0x03]),Buffer.from(sql,'utf8')]);
    this.stream.reset();
    await this.send(command);
    const results:QueryResult[]=[];
    const materialization=new MysqlMaterializationBudget();
    let totalRows=0,totalCells=0,totalBytes=0,responseStarted=false;
    // The first server ERR is a normal recoverable SQL error. Later ERR
    // packets, malformed rows or uncertain result boundaries retire the
    // socket, never returning partially consumed traffic to a pool.
    const readPacket=async():Promise<Buffer>=>{
      try{
        const packet=await this.get();
        responseStarted=true;
        totalBytes+=packet.length;
        if(totalBytes>LIMIT)
          throw fail('RESOURCE_LIMIT','Combined MySQL text result response exceeds byte limit');
        return packet;
      }catch(error){
        if(responseStarted)this.destroy(error instanceof DriverError?error:undefined);
        throw error;
      }
    };
    try{
      let next=await readPacket();
      for(;;){
        if(results.length>=MAX_RESULT_SETS)
          throw fail('RESOURCE_LIMIT','MySQL text query exceeded result-set limit');
        if(isOk(next)){
          const result=ok(next,true);
          results.push(result);
          if(!((result.status??0)&0x0008))return results;
          next=await readPacket();
          continue;
        }
        // A LOCAL INFILE request must never trigger client file reading or
        // upload, even if a misconfigured server sends one without the flag.
        if(next[0]===0xfb)
          throw fail('UNSUPPORTED_FEATURE','MySQL LOCAL INFILE is disabled');
        // Classic Text and Binary result headers have the same length-
        // encoded count when optional result metadata was not negotiated.
        const count=binaryResultColumnCount(next);
        const {columns,status:metadataStatus}=await readMetadataWithStatus(
          ()=>readPacket(),count,true
        );
        const keys=columnKeys(columns);
        materialization.columns(columns,keys);
        const rows:Array<Record<string,unknown>>=[];
        const rowValues:unknown[][]=[];
        for(;;){
          const packet=await readPacket();
          if(eof(packet)){
            const end=eofStatus(packet);
            const result:QueryResult={
              rows,columns,columnKeys:keys,rowValues,affectedRows:0,insertId:0,
              status:end.status,warnings:end.warnings
            };
            if(metadataStatus&0x1000)result.outParameters=true;
            results.push(result);
            if(!(end.status&0x0008)&&!(metadataStatus&0x1000))return results;
            next=await readPacket();
            break;
          }
          if(++totalRows>MAX_RESULT_ROWS)
            throw fail('RESOURCE_LIMIT','Combined MySQL text results exceed row limit');
          totalCells+=columns.length;
          if(totalCells>MAX_RESULT_CELLS)
            throw fail('RESOURCE_LIMIT','Combined MySQL text results exceed cell limit');
          materialization.beforeRow(columns.length);
          const values=textValues(packet,columns);
          materialization.decoded(values);
          rowValues.push(values);
          rows.push(objectRow(values,keys));
        }
      }
    }catch(error){
      // Pre-OK server errors have no partially consumed response and can
      // remain recoverable. Every other failure is unsafe to reuse.
      if(responseStarted)
        this.destroy(error instanceof DriverError?error:undefined);
      throw error;
    }
  }

  /** Literal SQL Text Protocol; no interpolated or bound parameters. */
  async queryText(sql:string,options:OperationOptions={}):Promise<QueryResult>{
    this.validateLiteralOptions(options);
    const sets=await this.serial(()=>this.executeTextResults(sql),options);
    if(sets.length!==1)
      throw fail('UNSUPPORTED_FEATURE','Text query returned multiple results; use queryTextResults');
    return sets[0];
  }

  /** Literal SQL Text Protocol including stored-procedure multi-results. */
  async queryTextResults(sql:string,options:OperationOptions={}):Promise<QueryResult[]>{
    this.validateLiteralOptions(options);
    return this.serial(()=>this.executeTextResults(sql),options);
  }

  /** Unlike prepared SQL, COM_QUERY cannot accept a values array.
   * Reject JS callers trying to pass bindings in the options position. */
  private validateLiteralOptions(options:OperationOptions):void{
    if(!options||typeof options!=='object'||Array.isArray(options)||
       Object.keys(options).some(key=>key!=='signal'&&key!=='timeoutMs'))
      throw fail('INVALID_INPUT','Text-protocol SQL accepts operation options, not bound values');
  }

  /** Native, forward-only server cursor. Keeps the session's exclusive command
   * lock for the entire callback so no other SQL can corrupt fetch state. */
  async withCursor<T>(
    sql:string,params:readonly BindValue[],
    work:(cursor:MysqlCursor)=>Promise<T>,
    options:CursorOptions={}
  ):Promise<T>{
    if(typeof work!=='function')throw fail('INVALID_INPUT','Cursor callback is required');
    if(!options||typeof options!=='object')
      throw fail('INVALID_INPUT','Invalid cursor options');
    const {fetchSize=64,...operation}=options;
    if(!Number.isSafeInteger(fetchSize)||fetchSize<1||fetchSize>256)
      throw fail('INVALID_INPUT','Cursor fetchSize must be 1–256');
    return this.serial(async()=>{
      const {id,parameterCount}=await this.prepareNative(sql);
      let cursor:MysqlCursor|undefined;
      let operationFailed=false;
      let operationError:unknown;
      try{
        if(!Array.isArray(params)||params.length!==parameterCount)
          throw fail('INVALID_INPUT','Cursor prepared statement parameter count mismatch');
        let command:Buffer;
        try{command=execute(id,params,true);}
        catch(error){
          if(error instanceof TypeError||error instanceof RangeError)
            throw fail('INVALID_INPUT','Invalid cursor bound parameter');
          throw error;
        }
        this.stream.reset();
        await this.send(command);
        const first=await this.get();
        if(isOk(first)){
          ok(first);
          throw fail('UNSUPPORTED_FEATURE','Cursor requires a row-producing SELECT statement');
        }
        let count:number;
        try{count=binaryResultColumnCount(first);}
        catch(error){
          // The server may already be sending column metadata after this
          // malformed header. Revoke the socket before cleanup could send
          // COM_STMT_CLOSE into unread response traffic.
          this.destroy(error instanceof DriverError?error:undefined);
          throw error;
        }
        // After the result-set header, a server ERR during metadata cannot
        // establish that the remainder of COM_STMT_EXECUTE was consumed.
        // Never send COM_STMT_CLOSE into that uncertain response.
        const cursorMetadata=async():Promise<Buffer>=>{
          try{return await this.get();}
          catch(error){
            this.destroy(error instanceof DriverError?error:undefined);
            throw error;
          }
        };
        let metadata:Awaited<ReturnType<typeof readMetadataWithStatus>>;
        try{
          metadata=await readMetadataWithStatus(cursorMetadata,count);
        }catch(error){
          // A malformed column definition, EOF boundary or cumulative
          // metadata limit can leave later packets in flight. The cursor
          // must never send COM_STMT_CLOSE or return this socket to a pool.
          const failure=error instanceof DriverError?error:
            fail('PROTOCOL_ERROR','Malformed MySQL cursor metadata');
          this.destroy(failure);
          throw failure;
        }
        const {columns,status}=metadata;
        if(!(status&0x40))
          throw fail('UNSUPPORTED_FEATURE','MySQL did not open a native server-side cursor');
        const keys=columnKeys(columns);
        cursor=new MysqlCursor(columns,keys,async()=>{
          this.assertOpen();
          this.stream.reset();
          await this.send(fetchRows(id,fetchSize));
          const rows:RelationalCursorRow[]=[];
          let bytes=0;
          for(;;){
            let packet:Buffer;
            try{packet=await this.get();}
            catch(error){
              // An ERR as the first fetch response can be a complete SQL
              // failure. After any binary row, the fetch response is only
              // partially consumed; fail closed instead of issuing a native
              // statement close against unread data or reusing the socket.
              if(rows.length)this.destroy(error instanceof DriverError?error:undefined);
              throw error;
            }
            if(eof(packet)){
              const end=eofStatus(packet);
              assertSingleResult(end.status);
              const done=!!(end.status&0x80);
              if(!done&&!(end.status&0x40))
                throw Error('MySQL fetch response lost cursor state');
              return {rows,done};
            }
            bytes+=packet.length;
            if(rows.length>=fetchSize||bytes>LIMIT)
              throw fail('RESOURCE_LIMIT','Cursor fetch batch exceeded safety limit');
            const values=binaryValues(packet,columns);
            rows.push({row:objectRow(values,keys),values});
          }
        });
        this.cursors.add(cursor);
        const context={active:true,kind:'cursor' as const};
        try {
          const value=await this.scope.run(context,()=>work(cursor!));
          // Unawaited fetches cannot continue after the connection is reused.
          if(cursor.inFlight){
            this.destroy();
            throw fail('CONNECTION_CLOSED','Cursor callback returned with an unfinished fetch');
          }
          return value;
        }finally {
          // A detached task inherits context but must not retain the lock.
          context.active=false;
        }
      }catch(error){
        operationFailed=true;
        operationError=error;
        throw error;
      }finally{
        if(cursor){
          // An application callback may THROW while an unawaited next() is
          // still sending or reading COM_STMT_FETCH. The normal-return path
          // checks this above, but failure must enforce the same invariant:
          // never race COM_STMT_CLOSE with an active fetch or reuse its socket.
          const unfinished=cursor.inFlight;
          cursor.invalidate();
          this.cursors.delete(cursor);
          if(unfinished)this.destroy();
        }
        // COM_STMT_CLOSE has no server acknowledgement. If sending it fails
        // for any reason, even a typed DATABASE_ERROR, native cleanup has not
        // been confirmed. Never let the generic recoverable-SQL error rule
        // return that connection to a pool or another application command.
        if(!this.closed){
          try{await this.closeNative(id);}
          catch(error){
            // Failed COM_STMT_CLOSE revokes the session, but it must not
            // replace the original cursor/application diagnostic. The
            // original error also wins the active guard-interruption race.
            const cause=operationFailed?operationError:
              error instanceof DriverError?error:undefined;
            this.destroy(cause);
            if(!operationFailed)throw error;
          }
        }
      }
    },operation);
  }

  /** A Node.js Readable with bounded, demand-driven native COM_STMT_FETCH.
   * The scope owns the stream: after callback completion no borrowed row
   * iterator may continue issuing protocol commands on this connection. */
  async withRowStream<T>(
    sql:string,params:readonly BindValue[],
    work:(rows:RelationalRowStream)=>Promise<T>,
    options:RowStreamOptions={}
  ):Promise<T>{
    if(typeof work!=='function')
      throw fail('INVALID_INPUT','Row stream callback is required');
    if(!options||typeof options!=='object'||Array.isArray(options))
      throw fail('INVALID_INPUT','Invalid row stream options');
    const {highWaterMark=8,...cursorOptions}=options;
    if(!Number.isSafeInteger(highWaterMark)||highWaterMark<1||highWaterMark>32)
      throw fail('INVALID_INPUT','Row stream highWaterMark must be 1–32 rows');
    return this.withCursor(sql,params,async cursor=>{
      const rows=cursorRowStream(cursor,highWaterMark);
      // Node Readable emits asynchronous errors. Keep an internal listener
      // through final destruction to avoid unhandled errors from a detached
      // reader, but never silently report a successful callback after one.
      let sourceError:unknown;
      rows.on('error',error=>{sourceError??=error;});
      try{
        const result=await work(rows);
        if(sourceError!==undefined)throw sourceError;
        return result;
      }finally{
        rows.destroy();
      }
    },cursorOptions);
  }

  /** Create an explicitly owned reusable statement for this session alone. */
  async prepare(sql:string,options:OperationOptions={}):Promise<MysqlPreparedStatement>{
    if(this.closed)throw fail('CONNECTION_CLOSED','Session is closed');
    if(this.statements.size+this.preparing>=MAX_PREPARED_STATEMENTS)
      throw fail('RESOURCE_LIMIT','Too many open prepared statements');
    this.preparing++;
    try{
      return await this.serial(async()=>{
        await this.reservePreparedCapacity(0);
        const {id,parameterCount}=await this.prepareNative(sql);
        let statement!:MysqlPreparedStatement;
        statement=new MysqlPreparedStatement(
          parameterCount,
          async(params,opts)=>{
            const sets=await this.serial(()=>{
              statement.assertSessionOwned();
              return this.executeNativeResults(id,parameterCount,params);
            },opts);
            if(sets.length!==1)
              throw fail('UNSUPPORTED_FEATURE','Statement returned multiple results; use executeResults');
            return sets[0];
          },
          async()=>{
            let released=false;
            try{
              if(!this.closed)await this.serial(async()=>{
                // A preceding COM_RESET_CONNECTION already released this ID.
                // Sending a stale COM_STMT_CLOSE must not target the next
                // generation of prepared statements on the same socket.
                if(statement.sessionRevoked)return;
                try{
                  await this.closeNative(id);
                }catch(error){
                  // The native close has started but was not confirmed.
                  // Even an error typed DATABASE_ERROR, CANCELLED or TIMEOUT
                  // cannot be treated as recoverable cleanup. Unlike a
                  // RESOURCE_LIMIT before FIFO enqueue, the statement ID
                  // may have been released and the wire state is uncertain.
                  this.destroy(error instanceof DriverError?error:undefined);
                  throw error;
                }
              });
              released=true;
            }catch(error){
              // If the transport dies while COM_STMT_CLOSE is queued, the
              // server-owned statement is already gone with that session.
              // Explicit close is cleanup, not application SQL: treat that
              // specific race as an idempotent close, without concealing
              // unrelated protocol or cancellation failures.
              if(this.closed&&error instanceof DriverError&&
                 error.code==='CONNECTION_CLOSED')released=true;
              else throw error;
            }finally{
              // A RESOURCE_LIMIT before enqueue did not transmit the close.
              // Keep the native ID counted until a later close can succeed.
              if(released||this.closed)this.statements.delete(statement);
            }
          },
          ()=>this.assertNotInsideExclusiveCallback(),
          (params,opts)=>this.serial(()=>{
            statement.assertSessionOwned();
            return this.executeNativeResults(id,parameterCount,params);
          },opts)
        );
        this.statements.add(statement);
        return statement;
      },options);
    }finally{this.preparing--;}
  }

  private async control(command:'START TRANSACTION'|'COMMIT'|'ROLLBACK'):Promise<QueryResult>{
    this.assertOpen();
    this.stream.reset();
    if(command==='COMMIT')this.commitAwaitingAck=true;
    if(command==='ROLLBACK')this.rollbackAwaitingAck=true;
    // The server's completion_type setting can silently transform COMMIT or
    // ROLLBACK into AND CHAIN (new transaction) or RELEASE (disconnect).
    // Explicit clauses override that ambient session setting, preserving
    // the driver's ownership of the transaction and physical connection.
    const sql=command==='START TRANSACTION'
      ?command
      :command+' AND NO CHAIN NO RELEASE';
    await this.send(Buffer.concat([Buffer.from([3]),Buffer.from(sql,'ascii')]));
    // Only a complete Protocol 4.1 OK with the expected server-side
    // transaction state confirms a managed transaction boundary.
    const result=acknowledgedOk(await this.get());
    const active=!!((result.status??0)&SERVER_STATUS_IN_TRANS);
    const expectedActive=command==='START TRANSACTION';
    if(active!==expectedActive){
      const error=expectedActive
        ?fail('PROTOCOL_ERROR',
          'MySQL did not confirm the start of a managed transaction')
        :fail('TRANSACTION_OUTCOME_UNKNOWN',
          command+' acknowledgement did not confirm transaction completion');
      this.destroy(error);
      throw error;
    }
    if(command==='COMMIT')this.commitAwaitingAck=false;
    if(command==='ROLLBACK')this.rollbackAwaitingAck=false;
    return result;
  }

  async transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options:OperationOptions={}):Promise<T>{
    if(typeof work!=='function')throw fail('INVALID_INPUT','Transaction callback is required');
    const outcome=await this.serial(async():Promise<TransactionOutcome<T>>=>{
      await this.control('START TRANSACTION');
      let finished=false;
      try {
        let transactionActive=true;
        const context={active:true,kind:'transaction' as const};
        const pending=new Set<Promise<unknown>>();
        // Commands issued concurrently through tx.query must execute in order
        // on the same MySQL socket. They cannot enter the parent serial queue,
        // which is exclusively held by the transaction callback.
        let transactionTail:Promise<void>=Promise.resolve();
        const schedule=<R>(run:()=>Promise<R>):Promise<R>=>{
          if(!transactionActive||this.closed||this.scope.getStore()!==context)
            return Promise.reject(fail('CONNECTION_CLOSED','Transaction scope is not active'));
          // Transaction commands bypass the parent serial queue while holding
          // its exclusive lock. Bound this separate backlog by the same
          // per-session limit to prevent unbounded memory growth.
          if(pending.size>=MAX_PENDING_COMMANDS)
            return Promise.reject(fail('RESOURCE_LIMIT','Too many pending MySQL transaction commands'));
          const request=transactionTail.then(async()=>{
            if(!transactionActive||this.closed)
              throw fail('CONNECTION_CLOSED','Transaction scope has ended');
            let result:R;
            try{
              result=await run();
            }catch(error){
              // A detached command may finish only after its callback exited
              // and the owning socket was revoked. Its original server error
              // is no longer proof of a safely managed transaction outcome.
              if(!transactionActive)
                throw fail('TRANSACTION_OUTCOME_UNKNOWN',
                  'Transaction command settled after scope exit; SQL outcome may be unknown');
              throw error;
            }
            if(!transactionActive)
              throw fail('TRANSACTION_OUTCOME_UNKNOWN',
                'Transaction command completed after scope exit; SQL outcome may be unknown');
            return result;
          });
          transactionTail=request.then(()=>{},()=>{});
          pending.add(request);
          void request.then(()=>{pending.delete(request);},()=>{pending.delete(request);});
          return request;
        };
        // A server may implicitly commit on DDL, administrative SQL or an
        // explicit COMMIT executed by the application. A syntactically valid
        // reply is not proof that this managed transaction is still open.
        // Inspect the final server-reported status of every scoped result.
        const assertStillInTransaction=(results:readonly QueryResult[]):void=>{
          const status=results.at(-1)?.status;
          if(typeof status!=='number'||(status&SERVER_STATUS_IN_TRANS)===0){
            const error=fail('TRANSACTION_OUTCOME_UNKNOWN',
              'MySQL ended the managed transaction before driver COMMIT; previous writes may already be durable');
            // The active operation is raced against its interruption guard.
            // Give both paths the same precise outcome instead of allowing a
            // generic CONNECTION_CLOSED to win when the socket is revoked.
            this.destroy(error);
            throw error;
          }
        };
        // ERR packets have no transaction-status flags. A failed DDL
        // statement can have committed earlier InnoDB work *before* returning
        // DATABASE_ERROR. Verify the actual server state on this same socket
        // before allowing the normal callback-error ROLLBACK path.
        const executeScoped=async(
          sql:string,values:readonly BindValue[],textProtocol=false
        ):Promise<QueryResult[]>=>{
          let results:QueryResult[];
          try{
            results=textProtocol
              ?await this.executeTextResults(sql)
              :await this.executeResults(sql,values);
          }catch(error){
            if(!(error instanceof DriverError&&error.code==='DATABASE_ERROR')||this.closed)
              throw error;
            try{
              this.stream.reset();
              await this.send(Buffer.from([0x0e])); // Native COM_PING
              assertStillInTransaction([acknowledgedOk(await this.get())]);
            }catch(probeError){
              if(probeError instanceof DriverError&&
                 probeError.code==='TRANSACTION_OUTCOME_UNKNOWN')
                throw probeError;
              const uncertain=fail('TRANSACTION_OUTCOME_UNKNOWN',
                'MySQL transaction state could not be verified after SQL error; previous writes may already be durable');
              this.destroy(uncertain);
              throw uncertain;
            }
            // The native transaction remained open. The application may
            // handle the original SQL error or allow normal ROLLBACK.
            throw error;
          }
          assertStillInTransaction(results);
          return results;
        };
        const transaction:RelationalTransaction=Object.freeze({
          query:(sql:string,values:readonly BindValue[]=[])=>schedule(async()=>{
            const results=await executeScoped(sql,values);
            if(results.length!==1)
              throw fail('UNSUPPORTED_FEATURE',
                'Statement returned multiple results; use queryResults or executeResults');
            return results[0];
          }),
          queryResults:(sql:string,values:readonly BindValue[]=[])=>schedule(
            ()=>executeScoped(sql,values)),
          queryText:(sql:string)=>schedule(async()=>{
            const results=await executeScoped(sql,[],true);
            if(results.length!==1)
              throw fail('UNSUPPORTED_FEATURE',
                'Text SQL returned multiple results; use queryTextResults');
            return results[0];
          }),
          queryTextResults:(sql:string)=>schedule(()=>executeScoped(sql,[],true))
        });
        let value:T;
        try {
          value=await this.scope.run(context,()=>work(transaction));
          transactionActive=false;
          context.active=false;
          if(pending.size){
            const uncertain=fail('TRANSACTION_OUTCOME_UNKNOWN',
              'Transaction callback returned with unfinished operations; SQL outcome may be unknown');
            this.destroy(uncertain);
            throw uncertain;
          }
        }catch(error){
          transactionActive=false;
          context.active=false;
          if(pending.size){
            // Preserve the precise cause across the active-guard interruption
            // race; do not let a second catch replace it with CONNECTION_CLOSED.
            const uncertain=error instanceof DriverError&&
                error.code==='TRANSACTION_OUTCOME_UNKNOWN'?error:
              fail('TRANSACTION_OUTCOME_UNKNOWN',
                'Transaction callback failed with unfinished operations; SQL outcome may be unknown');
            this.destroy(uncertain);
            throw uncertain;
          }
          if(this.closed)throw error;
          try{
            await this.control('ROLLBACK');
          }catch{
            // Mark cleanup as attempted before propagating failure so finally
            // never issues a second rollback. The outer serial handler
            // discards the connection after surfacing the unknown outcome.
            finished=true;
            throw fail('TRANSACTION_OUTCOME_UNKNOWN',
              'ROLLBACK acknowledgement was not confirmed; transaction outcome is unknown');
          }
          finished=true;
          return {success:false,error};
        }
        try {
          await this.control('COMMIT');
          finished=true;
          return {success:true,value};
        }catch{
          // Once COMMIT was issued, even an active server-side disconnect
          // cannot establish whether the transaction became durable.
          this.destroy();
          throw fail('TRANSACTION_OUTCOME_UNKNOWN',
            'COMMIT acknowledgement was not confirmed; transaction outcome is unknown');
        }
      }finally{
        if(!finished&&!this.closed){
          try {await this.control('ROLLBACK');}catch{this.destroy();}
        }
      }
    },options);
    if(!outcome.success)throw outcome.error;
    return outcome.value;
  }

  /** A valid OK response does not make a pooled socket safe if the server
   * still reports an active transaction. Never hand it to another borrower. */
  private confirmPoolTransactionClosed(
    result:QueryResult,operation:'health check'|'reset'
  ):void{
    if(typeof result.status!=='number'||(result.status&SERVER_STATUS_IN_TRANS)!==0){
      const error=fail('PROTOCOL_ERROR',
        'MySQL pool '+operation+' did not confirm an inactive transaction');
      this.destroy(error);
      throw error;
    }
  }

  /** Native COM_PING checks protocol synchronization on the exact borrowed socket.
   * No application statement is replayed if the probe fails. */
  async healthCheckForPool(timeoutMs:number):Promise<void>{
    await this.serial(async()=>{
      this.stream.reset();
      await this.send(Buffer.from([0x0e])); // COM_PING
      this.confirmPoolTransactionClosed(acknowledgedOk(await this.get()),'health check');
    },{timeoutMs});
  }

  /** Native MySQL COM_RESET_CONNECTION: discard transaction, variables and
   * server-side statements before an exclusive lease returns to the pool. */
  async resetForPool():Promise<void>{
    return this.serial(async()=>{
      this.stream.reset();
      await this.send(Buffer.from([0x1f])); // COM_RESET_CONNECTION
      this.confirmPoolTransactionClosed(acknowledgedOk(await this.get()),'reset');
      for(const statement of this.statements)statement.invalidate();
      this.statements.clear();
      // COM_RESET_CONNECTION revoked every session-owned server statement
      // ID, including implicit cache entries. Never reuse them across leases.
      this.statementCache.clear();
    });
  }

  async close():Promise<void>{
    if(this.closed)return;
    // Closing never waits for a blocked server request or application callback.
    // In-flight operations receive CONNECTION_CLOSED and the socket is discarded.
    this.activeGuard?.interrupt(fail('CONNECTION_CLOSED','Session closed during an operation'));
    this.destroy();
  }
}

/** Real MySQL 8.4 Classic protocol transport; no external database-client driver. */
/** AbortSignal is used internally by the pool to terminate an in-flight dial.
 * It does not cancel commands after authentication has completed. */
export async function connectMysql(input:MysqlTarget,signal?:AbortSignal):Promise<MysqlSession>{
  const target=validate(input);
  if(signal?.aborted)throw fail('CANCELLED','MySQL connection attempt cancelled');
  const socket=net.createConnection({host:target.host,port:target.port});
  socket.setNoDelay(true);
  const stream=new PacketStream(socket);
  // Retain the TLS wrapper so failed handshakes cannot leak sockets.
  let active:Socket=socket;
  let negotiatingTls=false;
  let cancelled=false;
  let timedOut=false;
  const onAbort=():void=>{
    cancelled=true;
    // Abort the pending protocol read even if no bytes have arrived, then
    // destroy both transport layers (STARTTLS can detach the raw socket).
    stream.destroy();
    active.destroy();
    socket.destroy();
  };
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)onAbort();
  const timer=setTimeout(()=>{
    timedOut=true;
    // Cover TCP connect, the plaintext greeting, STARTTLS, and authentication.
    // Destroy the transport currently owning the handshake, not just the
    // original TCP socket. Reject outstanding packet reads immediately.
    stream.abort(fail('TIMEOUT','MySQL connection timeout'));
    active.destroy();
    socket.destroy();
  },target.timeoutMs);
  try{
    await new Promise<void>((resolve,reject)=>{
      const cleanup=():void=>{
        socket.off('connect',connected);
        socket.off('error',failed);
        socket.off('close',closed);
      };
      const connected=():void=>{cleanup();resolve();};
      const failed=(error:Error):void=>{cleanup();reject(error);};
      const closed=():void=>{
        cleanup();
        reject(fail('CONNECTION_FAILED','MySQL transport closed during connection'));
      };
      socket.once('connect',connected);
      socket.once('error',failed);
      socket.once('close',closed);
      if(cancelled)closed();
    });
    const hello=greeting(await stream.read());
    // Reject unsupported plugins before sending login credentials, including
    // when an account's password is empty and would yield an empty token.
    assertSupportedAuthPlugin(hello.plugin);
    const secure=target.security==='verified-tls';
    const selectedFlags=flags(hello.flags,secure,target.database);
    if(secure){
      // The server expects an unencrypted SSLRequest before TLS negotiation.
      await stream.send(sslRequest(selectedFlags));
      stream.detach();
      negotiatingTls=true;
      const secureSocket=tls.connect({
        socket,servername:target.serverName??target.host,
        ca:target.ca,minVersion:'TLSv1.2',rejectUnauthorized:true
      });
      active=secureSocket;
      await new Promise<void>((resolve,reject)=>{
        const cleanup=():void=>{
          secureSocket.off('secureConnect',onSecure);
          secureSocket.off('error',onError);
          secureSocket.off('close',onClose);
        };
        const onError=():void=>{
          cleanup();
          reject(fail('TLS_FAILED','Database TLS negotiation or identity verification failed'));
        };
        const onClose=():void=>{
          cleanup();
          reject(fail('TLS_FAILED','Database TLS socket closed during negotiation'));
        };
        const onSecure=():void=>{
          cleanup();
          if(secureSocket.authorized)resolve();
          else reject(fail('TLS_FAILED','Database identity verification failed'));
        };
        secureSocket.once('secureConnect',onSecure);
        secureSocket.once('error',onError);
        secureSocket.once('close',onClose);
        if(cancelled)onClose();
      });
      negotiatingTls=false;
      stream.attach(active);
    }
    await stream.send(login({
      f:selectedFlags,user:target.user,password:target.password,
      database:target.database,seed:hello.seed,plugin:hello.plugin
    }));
    let plugin=hello.plugin;
    let authStage:'challenge'|'final-ok'='challenge';
    let switched=false;
    for(let i=0;i<6;i++){
      const packet=serverPacket(await stream.read());
      if(packet[0]===0){
        authenticationOk(packet);
        if(cancelled)throw fail('CANCELLED','MySQL connection attempt cancelled');
        return new MysqlSession(stream,active,target,{...hello,plugin});
      }
      if(packet[0]===254){
        if(switched||authStage!=='challenge')
          throw fail('PROTOCOL_ERROR','Unexpected MySQL authentication plugin switch');
        const switchRequest=authSwitchRequest(packet);
        switched=true;
        plugin=switchRequest.plugin;
        await stream.send(token(target.password,switchRequest.seed,plugin));
        continue;
      }
      if(packet[0]===1&&plugin==='caching_sha2_password'){
        if(authStage!=='challenge')
          throw fail('PROTOCOL_ERROR','Repeated MySQL authentication continuation');
        const status=cachingSha2AuthMore(packet);
        authStage='final-ok';
        if(status===3)continue;
        if(!secure)throw fail('AUTH_UNSUPPORTED','Full authentication requires verified TLS');
        await stream.send(cstr(target.password));
        continue;
      }
      throw fail('AUTH_UNSUPPORTED','Unsupported authentication exchange');
    }
    throw fail('AUTH_UNSUPPORTED','Authentication negotiation exceeded step limit');
  }catch(error){
    stream.destroy();
    active.destroy();
    socket.destroy();
    if(cancelled)throw fail('CANCELLED','MySQL connection attempt cancelled');
    if(timedOut)throw fail('TIMEOUT','MySQL connection timeout');
    if(error instanceof DriverError){
      if(error.code==='DATABASE_ERROR'){
        // Before authentication completes, the peer controls the text of
        // ERR packets. Never echo it: an untrusted server could embed the
        // supplied password or other credentials in its error message.
        // Preserve numeric MySQL diagnostics for clients instead.
        throw new DriverError('DATABASE_ERROR','MySQL server rejected the connection',{
          vendorCode:error.vendorCode??undefined,
          sqlState:error.sqlState??undefined
        });
      }
      throw error;
    }
    if(negotiatingTls)throw fail('TLS_FAILED','Database TLS negotiation or identity verification failed');
    // Transport exception text is not a trusted source of client-visible
    // connection diagnostics; avoid echoing host or credential material.
    throw fail('CONNECTION_FAILED','MySQL connection failed');
  }finally{
    clearTimeout(timer);
    signal?.removeEventListener('abort',onAbort);
  }
}
