import net, {type Socket} from 'node:net';
import {AsyncLocalStorage} from 'node:async_hooks';
import tls from 'node:tls';
import {PacketStream} from './protocol/framing.js';
import {Cursor,cstr,LIMIT,u32} from './protocol/primitives.js';
import {greeting,flags,login,sslRequest,authSwitchRequest,cachingSha2AuthMore,authenticationOk,type MysqlGreeting} from './protocol/handshake.js';
import {assertSupportedAuthPlugin,token} from './auth/plugins.js';
import {execute,fetchRows} from './protocol/commands.js';
import {MysqlCursor} from './cursor.js';
import {MysqlPreparedStatement} from './prepared.js';
import {ok,acknowledgedOk,prepareOk,eofStatus,assertSingleResult} from './protocol/results.js';
import {binaryValues,columnKeys,objectRow} from './types.js';
import {serverPacket,eof,isOk} from './errors.js';
import {validate} from './configuration.js';
import {mysqlCapabilities} from './capabilities.js';
import {readMetadata,readMetadataWithStatus} from './metadata.js';
import {DriverError,fail} from '../../core/errors.js';
import {MAX_RESULT_ROWS,MAX_RESULT_SETS,MAX_PARAMETERS,MAX_COLUMNS,MAX_PREPARED_STATEMENTS,operationOptions,OperationGuard,type OperationOptions} from '../../core/resources.js';
import type {BindValue,MysqlTarget,QueryResult,SessionInfo} from '../../core/contracts.js';
import type {RelationalSession,RelationalTransaction,RelationalCursorRow,CursorOptions} from '../../models/relational.js';

type ValidMysqlTarget=MysqlTarget&{timeoutMs:number};
type TransactionOutcome<T>={success:true;value:T}|{success:false;error:unknown};
type QueuedJob={start:()=>void;reject:(error:DriverError)=>void};
const MAX_PENDING_COMMANDS=1024;

export class MysqlSession implements RelationalSession {
  readonly info:Readonly<SessionInfo>;
  closed=false;
  private readonly queue:QueuedJob[]=[];
  private busy=false;
  private activeGuard:OperationGuard|null=null;
  private readonly statements=new Set<MysqlPreparedStatement>();
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
    this.info=Object.freeze({
      engine:'mysql',model:'relational',version:hello.version,
      transport:target.security,authPlugin:hello.plugin,capabilities:mysqlCapabilities
    });
    // Remote closes can happen between operations when no read is pending.
    // Immediately revoke prepared handles and remove the stale pool session.
    this.stream.onFatal(error=>this.destroy(error instanceof DriverError?error:undefined));
  }

  private destroy(cause?:DriverError):void {
    if(this.closed)return;
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
                  :this.closed
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

  /** COM_STMT_PREPARE assigns one server statement ID; metadata is consumed
   * completely before the next command can enter the MySQL packet stream. */
  private async prepareNative(sql:string):Promise<{id:number;parameterCount:number}>{
    this.assertOpen();
    if(typeof sql!=='string'||!sql.trim()||Buffer.byteLength(sql,'utf8')>LIMIT)
      throw fail('INVALID_INPUT','Invalid SQL statement');
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
    let totalRows=0,totalBytes=0;
    let next=await this.get();
    for(;;){
      if(results.length>=MAX_RESULT_SETS)
        throw fail('RESOURCE_LIMIT','Stored procedure exceeded the result-set limit');
      if(isOk(next)){
        const result=ok(next,true);
        results.push(result);
        if(!((result.status??0)&0x0008))return results;
        next=await this.get();
        continue;
      }
      const raw=new Cursor(next),count=raw.len();
      if(count===null||count<1||count>MAX_COLUMNS)
        throw Error('Invalid prepared result column count');
      const {columns,status:metadataStatus}=await readMetadataWithStatus(
        ()=>this.get(),count,true
      );
      const keys=columnKeys(columns);
      const rows:Array<Record<string,unknown>>=[];
      const rowValues:unknown[][]=[];
      for(;;){
        const packet=await this.get();
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
          next=await this.get();
          break;
        }
        totalBytes+=packet.length;
        if(++totalRows>MAX_RESULT_ROWS||totalBytes>LIMIT)
          throw fail('RESOURCE_LIMIT','Combined result sets exceed safety limits');
        const values=binaryValues(packet,columns);
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

  private async executeResults(
    sql:string,params:readonly BindValue[]
  ):Promise<QueryResult[]>{
    const prepared=await this.prepareNative(sql);
    try{
      return await this.executeNativeResults(prepared.id,prepared.parameterCount,params);
    }catch(error){
      // A partially consumed result can never be returned to the pool.
      // Preserve the original RESOURCE_LIMIT / protocol error instead of
      // replacing it with a later COM_STMT_CLOSE stream-reset failure.
      if(!(error instanceof DriverError&&
           (error.code==='DATABASE_ERROR'||error.code==='INVALID_INPUT')))
        this.destroy(error instanceof DriverError?error:undefined);
      throw error;
    }finally{
      if(!this.closed)await this.closeNative(prepared.id);
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
        const raw=new Cursor(first),count=raw.len();
        if(count===null||count<1||count>MAX_COLUMNS)
          throw Error('Invalid cursor result column count');
        const {columns,status}=await readMetadataWithStatus(()=>this.get(),count);
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
            const packet=await this.get();
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
      }finally{
        if(cursor){
          cursor.invalidate();
          this.cursors.delete(cursor);
        }
        // COM_STMT_CLOSE releases any server-side cursor, including early exits.
        if(!this.closed)await this.closeNative(id);
      }
    },operation);
  }

  /** Create an explicitly owned reusable statement for this session alone. */
  async prepare(sql:string,options:OperationOptions={}):Promise<MysqlPreparedStatement>{
    if(this.closed)throw fail('CONNECTION_CLOSED','Session is closed');
    if(this.statements.size+this.preparing>=MAX_PREPARED_STATEMENTS)
      throw fail('RESOURCE_LIMIT','Too many open prepared statements');
    this.preparing++;
    try{
      return await this.serial(async()=>{
        const {id,parameterCount}=await this.prepareNative(sql);
        let statement!:MysqlPreparedStatement;
        statement=new MysqlPreparedStatement(
          parameterCount,
          async(params,opts)=>{
            const sets=await this.serial(
              ()=>this.executeNativeResults(id,parameterCount,params),opts
            );
            if(sets.length!==1)
              throw fail('UNSUPPORTED_FEATURE','Statement returned multiple results; use executeResults');
            return sets[0];
          },
          async()=>{
            try{
              if(!this.closed)await this.serial(()=>this.closeNative(id));
            }catch(error){
              // If the transport dies while COM_STMT_CLOSE is queued, the
              // server-owned statement is already gone with that session.
              // Explicit close is cleanup, not application SQL: treat that
              // specific race as an idempotent close, without concealing
              // unrelated protocol or cancellation failures.
              if(!(this.closed&&error instanceof DriverError&&
                   error.code==='CONNECTION_CLOSED'))throw error;
            }finally{this.statements.delete(statement);}
          },
          ()=>this.assertNotInsideExclusiveCallback(),
          (params,opts)=>this.serial(()=>this.executeNativeResults(id,parameterCount,params),opts)
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
    await this.send(Buffer.concat([Buffer.from([3]),Buffer.from(command,'ascii')]));
    // Only a complete Protocol 4.1 OK confirms transaction control.
    // On a missing/truncated acknowledgement, the outer transaction
    // lifecycle must not claim that COMMIT or ROLLBACK is definite.
    const result=acknowledgedOk(await this.get());
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
          const request=transactionTail.then(()=>{
            if(!transactionActive||this.closed)
              throw fail('CONNECTION_CLOSED','Transaction scope has ended');
            return run();
          });
          transactionTail=request.then(()=>{},()=>{});
          pending.add(request);
          void request.then(()=>{pending.delete(request);},()=>{pending.delete(request);});
          return request;
        };
        const transaction:RelationalTransaction=Object.freeze({
          query:(sql:string,values:readonly BindValue[]=[])=>schedule(()=>this.execute(sql,values)),
          queryResults:(sql:string,values:readonly BindValue[]=[])=>schedule(()=>this.executeResults(sql,values))
        });
        let value:T;
        try {
          value=await this.scope.run(context,()=>work(transaction));
          transactionActive=false;
          context.active=false;
          if(pending.size){
            this.destroy();
            throw fail('CONNECTION_CLOSED','Transaction callback returned with unfinished operations');
          }
        }catch(error){
          transactionActive=false;
          context.active=false;
          if(pending.size){
            this.destroy();
            throw fail('CONNECTION_CLOSED','Transaction callback failed with unfinished operations');
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

  /** Native COM_PING checks protocol synchronization on the exact borrowed socket.
   * No application statement is replayed if the probe fails. */
  async healthCheckForPool(timeoutMs:number):Promise<void>{
    await this.serial(async()=>{
      this.stream.reset();
      await this.send(Buffer.from([0x0e])); // COM_PING
      acknowledgedOk(await this.get());
    },{timeoutMs});
  }

  /** Native MySQL COM_RESET_CONNECTION: discard transaction, variables and
   * server-side statements before an exclusive lease returns to the pool. */
  async resetForPool():Promise<void>{
    return this.serial(async()=>{
      this.stream.reset();
      await this.send(Buffer.from([0x1f])); // COM_RESET_CONNECTION
      acknowledgedOk(await this.get());
      for(const statement of this.statements)statement.invalidate();
      this.statements.clear();
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
