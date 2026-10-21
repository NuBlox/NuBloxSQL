import net, {type Socket} from 'node:net';
import tls from 'node:tls';
import {PacketStream} from './protocol/framing.js';
import {Cursor,cstr,LIMIT,u32} from './protocol/primitives.js';
import {greeting,flags,login,sslRequest,type MysqlGreeting} from './protocol/handshake.js';
import {token} from './auth/plugins.js';
import {execute} from './protocol/commands.js';
import {ok} from './protocol/results.js';
import {binaryRow} from './types.js';
import {serverPacket,eof,isOk} from './errors.js';
import {validate} from './configuration.js';
import {mysqlCapabilities} from './capabilities.js';
import {readMetadata} from './metadata.js';
import {DriverError,fail} from '../../core/errors.js';
import {MAX_RESULT_ROWS,MAX_PARAMETERS,MAX_COLUMNS,operationOptions,OperationGuard,type OperationOptions} from '../../core/resources.js';
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

  private async execute(sql:string,params:readonly BindValue[]):Promise<QueryResult>{
    this.assertOpen();
    if(typeof sql!=='string'||!sql.trim()||Buffer.byteLength(sql,'utf8')>LIMIT||
      !Array.isArray(params)||params.length>MAX_PARAMETERS)
      throw fail('INVALID_INPUT','Invalid SQL query or parameter list');

    // Actual server-side preparation; user parameters never become SQL text.
    this.stream.reset();
    await this.send(Buffer.concat([Buffer.from([0x16]),Buffer.from(sql,'utf8')]));
    const header=await this.get();
    if(!isOk(header)||header.length<12)throw Error('Malformed statement preparation');
    const prepared=new Cursor(header);
    prepared.byte();
    const id=prepared.four();
    const columnCount=prepared.two(),paramCount=prepared.two();
    prepared.byte();
    prepared.two();

    try {
      if(paramCount)await this.metadata(paramCount);
      if(columnCount)await this.metadata(columnCount);
      if(paramCount!==params.length)
        throw fail('INVALID_INPUT','Prepared statement parameter count mismatch');

      this.stream.reset();
      await this.send(execute(id,params));
      const result=await this.get();
      if(isOk(result))return ok(result);

      const raw=new Cursor(result),count=raw.len();
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
    }finally{
      if(!this.closed){
        this.stream.reset();
        await this.send(Buffer.concat([Buffer.from([0x19]),u32(id)]));
      }
    }
  }

  async query(sql:string,parameters:readonly BindValue[]=[],options:OperationOptions={}):Promise<QueryResult>{
    return this.serial(()=>this.execute(sql,parameters),options);
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
        const transaction:RelationalTransaction=Object.freeze({
          query:(sql:string,values:readonly BindValue[]=[])=>this.execute(sql,values)
        });
        let value:T;
        try {
          value=await work(transaction);
        }catch(error){
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
