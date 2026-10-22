import net, {type Socket} from 'node:net';
import tls from 'node:tls';
import {PacketStream} from './protocol/framing.js';
import {Cursor,cstr,LIMIT,u32} from './protocol/primitives.js';
import {greeting,flags,login,sslRequest,type MysqlGreeting} from './protocol/handshake.js';
import {token} from './auth/plugins.js';
import {execute} from './protocol/commands.js';
import {MysqlPreparedStatement} from './prepared.js';
import {ok} from './protocol/results.js';
import {binaryRow} from './types.js';
import {serverPacket,eof,isOk} from './errors.js';
import {validate} from './configuration.js';
import {mysqlCapabilities} from './capabilities.js';
import {readMetadata} from './metadata.js';
import {DriverError,fail} from '../../core/errors.js';
import {MAX_RESULT_ROWS,MAX_PARAMETERS,MAX_COLUMNS,MAX_PREPARED_STATEMENTS,operationOptions,OperationGuard,type OperationOptions} from '../../core/resources.js';
import type {BindValue,MysqlTarget,QueryResult,SessionInfo} from '../../core/contracts.js';
import type {RelationalSession,RelationalTransaction} from '../../models/relational.js';

type ValidMysqlTarget=MysqlTarget&{timeoutMs:number};
type TransactionOutcome<T>={success:true;value:T}|{success:false;error:unknown};
type QueuedJob={start:()=>void;reject:(error:DriverError)=>void};

export class MysqlSession implements RelationalSession {
  readonly info:Readonly<SessionInfo>;
  closed=false;
  private readonly queue:QueuedJob[]=[];
  private busy=false;
  private activeGuard:OperationGuard|null=null;
  private readonly statements=new Set<MysqlPreparedStatement>();
  private preparing=0;

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
  }

  private destroy():void {
    if(this.closed)return;
    this.closed=true;
    for(const statement of this.statements)statement.invalidate();
    this.statements.clear();
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

  /** One active command per native connection; pending aborts never damage it. */
  private serial<T>(fn:()=>Promise<T>,options:OperationOptions={}):Promise<T>{
    const {signal,timeoutMs}=operationOptions(options,this.target.timeoutMs);
    if(this.closed)return Promise.reject(fail('CONNECTION_CLOSED','Session is closed'));
    if(signal?.aborted)return Promise.reject(fail('CANCELLED','Database operation cancelled'));
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
              if(!(error instanceof DriverError&&
                (error.code==='DATABASE_ERROR'||error.code==='INVALID_INPUT'||
                 error.code==='CANCELLED'||error.code==='TIMEOUT'||
                 error.code==='CONNECTION_CLOSED')))
                this.destroy();
              reject(error);
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
      this.queue.push(job);
      signal?.addEventListener('abort',cancelQueued,{once:true});
      // In case the signal was aborted between preflight and registration.
      if(signal?.aborted)cancelQueued();
      else this.drain();
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
    const header=await this.get();
    if(!isOk(header)||header.length<12)throw Error('Malformed statement preparation');
    const cursor=new Cursor(header);
    cursor.byte();
    const id=cursor.four();
    const columnCount=cursor.two();
    const parameterCount=cursor.two();
    cursor.byte();
    cursor.two();
    if(parameterCount>MAX_PARAMETERS||columnCount>MAX_COLUMNS)
      throw fail('RESOURCE_LIMIT','Prepared statement metadata exceeds supported limits');
    if(parameterCount)await this.metadata(parameterCount);
    if(columnCount)await this.metadata(columnCount);
    return {id,parameterCount};
  }

  /** Repeated COM_STMT_EXECUTE uses the existing server-side ID and does not
   * issue another prepare. Calls are serialized by the owning session. */
  private async executeNative(id:number,expected:number,params:readonly BindValue[]):Promise<QueryResult>{
    this.assertOpen();
    if(!Array.isArray(params)||params.length!==expected)
      throw fail('INVALID_INPUT','Prepared statement parameter count mismatch');
    // Reject invalid parameter encodings before sending any protocol bytes;
    // a local binding error must not poison a healthy connection.
    let command:Buffer;
    try{command=execute(id,params);}
    catch(error){
      if(error instanceof TypeError||error instanceof RangeError)
        throw fail('INVALID_INPUT','Invalid prepared statement bound parameter');
      throw error;
    }
    this.stream.reset();
    await this.send(command);
    const first=await this.get();
    if(isOk(first))return ok(first);

    const raw=new Cursor(first),count=raw.len();
    if(count===null||count>MAX_COLUMNS)throw Error('Invalid result column count');
    const columns=await this.metadata(count);
    const rows:Array<Record<string,unknown>>=[];
    let bytes=0;
    for(;;){
      const packet=await this.get();
      if(eof(packet)){
        if(packet.length>=5&&((packet[3]|(packet[4]<<8))&8))
          throw fail('UNSUPPORTED_FEATURE','Multiple result sets are not supported');
        return {rows,columns,affectedRows:0,insertId:0};
      }
      bytes+=packet.length;
      if(rows.length>=MAX_RESULT_ROWS||bytes>LIMIT)
        throw fail('RESOURCE_LIMIT','Result exceeds configured safety limit');
      rows.push(binaryRow(packet,columns));
    }
  }

  /** COM_STMT_CLOSE has no response packet; the ID is invalid thereafter. */
  private async closeNative(id:number):Promise<void>{
    this.assertOpen();
    this.stream.reset();
    await this.send(Buffer.concat([Buffer.from([0x19]),u32(id)]));
  }

  /** One-shot query remains a complete prepare, execute and close lifecycle. */
  private async execute(sql:string,params:readonly BindValue[]):Promise<QueryResult>{
    const prepared=await this.prepareNative(sql);
    try{
      return await this.executeNative(prepared.id,prepared.parameterCount,params);
    }finally{
      if(!this.closed)await this.closeNative(prepared.id);
    }
  }

  async query(sql:string,parameters:readonly BindValue[]=[],options:OperationOptions={}):Promise<QueryResult>{
    return this.serial(()=>this.execute(sql,parameters),options);
  }

  /** Create an explicitly owned reusable statement for this session alone. */
  prepare(sql:string,options:OperationOptions={}):Promise<MysqlPreparedStatement>{
    if(this.closed)return Promise.reject(fail('CONNECTION_CLOSED','Session is closed'));
    if(this.statements.size+this.preparing>=MAX_PREPARED_STATEMENTS)
      return Promise.reject(fail('RESOURCE_LIMIT','Too many open prepared statements'));
    this.preparing++;
    return this.serial(async()=>{
      const {id,parameterCount}=await this.prepareNative(sql);
      let statement!:MysqlPreparedStatement;
      statement=new MysqlPreparedStatement(
        parameterCount,
        (params,opts)=>this.serial(()=>this.executeNative(id,parameterCount,params),opts),
        async()=>{
          try{
            if(!this.closed)await this.serial(()=>this.closeNative(id));
          }finally{this.statements.delete(statement);}
        }
      );
      this.statements.add(statement);
      return statement;
    },options).finally(()=>{this.preparing--;});
  }

  private async control(command:'START TRANSACTION'|'COMMIT'|'ROLLBACK'):Promise<QueryResult>{
    this.assertOpen();
    this.stream.reset();
    await this.send(Buffer.concat([Buffer.from([3]),Buffer.from(command,'ascii')]));
    const response=await this.get();
    if(!isOk(response))throw Error('Expected transaction OK');
    return ok(response);
  }

  async transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options:OperationOptions={}):Promise<T>{
    if(typeof work!=='function')throw fail('INVALID_INPUT','Transaction callback is required');
    const outcome=await this.serial(async():Promise<TransactionOutcome<T>>=>{
      await this.control('START TRANSACTION');
      let finished=false;
      try {
        let transactionActive=true;
        const pending=new Set<Promise<QueryResult>>();
        const transaction:RelationalTransaction=Object.freeze({
          query:(sql:string,values:readonly BindValue[]=[])=>{
            if(!transactionActive||this.closed)
              return Promise.reject(fail('CONNECTION_CLOSED','Transaction scope has ended'));
            const request=this.execute(sql,values);
            pending.add(request);
            void request.then(()=>{pending.delete(request);},()=>{pending.delete(request);});
            return request;
          }
        });
        let value:T;
        try {
          value=await work(transaction);
          transactionActive=false;
          if(pending.size){
            this.destroy();
            throw fail('CONNECTION_CLOSED','Transaction callback returned with unfinished operations');
          }
        }catch(error){
          transactionActive=false;
          if(pending.size){
            this.destroy();
            throw fail('CONNECTION_CLOSED','Transaction callback failed with unfinished operations');
          }
          if(this.closed)throw error;
          await this.control('ROLLBACK');
          finished=true;
          return {success:false,error};
        }
        await this.control('COMMIT');
        finished=true;
        return {success:true,value};
      }finally{
        if(!finished&&!this.closed){
          try {await this.control('ROLLBACK');}catch{this.destroy();}
        }
      }
    },options);
    if(!outcome.success)throw outcome.error;
    return outcome.value;
  }

  /** Native MySQL COM_RESET_CONNECTION: discard transaction, variables and
   * server-side statements before an exclusive lease returns to the pool. */
  async resetForPool():Promise<void>{
    return this.serial(async()=>{
      this.stream.reset();
      await this.send(Buffer.from([0x1f])); // COM_RESET_CONNECTION
      const response=await this.get();
      if(!isOk(response))throw Error('Invalid MySQL session reset response');
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
export async function connectMysql(input:MysqlTarget):Promise<MysqlSession>{
  const target=validate(input);
  const socket=net.createConnection({host:target.host,port:target.port});
  socket.setNoDelay(true);
  const stream=new PacketStream(socket);
  // Retain the TLS wrapper so failed handshakes cannot leak sockets.
  let active:Socket=socket;
  let negotiatingTls=false;
  const timer=setTimeout(()=>{
    socket.destroy(fail('TIMEOUT','MySQL connection timeout'));
  },target.timeoutMs);
  try{
    await new Promise<void>((resolve,reject)=>{
      socket.once('connect',resolve);
      socket.once('error',reject);
    });
    const hello=greeting(await stream.read());
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
        const onError=():void=>{
          secureSocket.off('secureConnect',onSecure);
          reject(fail('TLS_FAILED','Database TLS negotiation or identity verification failed'));
        };
        const onSecure=():void=>{
          secureSocket.off('error',onError);
          if(secureSocket.authorized)resolve();
          else reject(fail('TLS_FAILED','Database identity verification failed'));
        };
        secureSocket.once('secureConnect',onSecure);
        secureSocket.once('error',onError);
      });
      negotiatingTls=false;
      stream.attach(active);
    }
    await stream.send(login({
      f:selectedFlags,user:target.user,password:target.password,
      database:target.database,seed:hello.seed,plugin:hello.plugin
    }));
    let plugin=hello.plugin;
    for(let i=0;i<6;i++){
      const packet=serverPacket(await stream.read());
      if(packet[0]===0){
        return new MysqlSession(stream,active,target,{...hello,plugin});
      }
      if(packet[0]===254){
        const cursor=new Cursor(packet);
        cursor.byte();
        plugin=cursor.zero();
        const seed=cursor.take(cursor.remaining());
        const normalized=seed.at(-1)===0?seed.subarray(0,-1):seed;
        if(!['mysql_native_password','caching_sha2_password'].includes(plugin))
          throw fail('AUTH_UNSUPPORTED','Unsupported authentication plugin');
        await stream.send(token(target.password,normalized,plugin));
        continue;
      }
      if(packet[0]===1&&plugin==='caching_sha2_password'){
        if(packet[1]===3)continue;
        if(packet[1]===4){
          if(!secure)throw fail('AUTH_UNSUPPORTED','Full authentication requires verified TLS');
          await stream.send(cstr(target.password));
          continue;
        }
      }
      throw fail('AUTH_UNSUPPORTED','Unsupported authentication exchange');
    }
    throw fail('AUTH_UNSUPPORTED','Authentication negotiation exceeded step limit');
  }catch(error){
    stream.destroy();
    active.destroy();
    socket.destroy();
    if(error instanceof DriverError)throw error;
    if(negotiatingTls)throw fail('TLS_FAILED','Database TLS negotiation or identity verification failed');
    throw new DriverError('CONNECTION_FAILED',error instanceof Error?error.message:'MySQL connection failed');
  }finally{clearTimeout(timer);}
}
