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
import {MAX_RESULT_ROWS,MAX_PARAMETERS,MAX_COLUMNS} from '../../core/resources.js';
import type {BindValue,MysqlTarget,QueryResult,SessionInfo} from '../../core/contracts.js';
import type {RelationalSession,RelationalTransaction} from '../../models/relational.js';

type ValidMysqlTarget=MysqlTarget&{timeoutMs:number};
type TransactionOutcome<T>={success:true;value:T}|{success:false;error:unknown};

export class MysqlSession implements RelationalSession {
  readonly info:Readonly<SessionInfo>;
  closed=false;
  private tail:Promise<void>=Promise.resolve();

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
    this.closed=true;
    this.stream.destroy();
    this.socket.destroy();
  }

  /** Serialize all commands on the connection and apply a per-operation deadline. */
  private async serial<T>(fn:()=>Promise<T>):Promise<T>{
    const before=this.tail;
    let release!:()=>void;
    this.tail=new Promise<void>(resolve=>{release=resolve;});
    await before;
    if(this.closed){release();throw fail('CONNECTION_CLOSED','Session is closed');}
    let timer:NodeJS.Timeout|undefined;
    const deadline=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{
        this.destroy();
        reject(fail('TIMEOUT','MySQL operation timed out'));
      },this.target.timeoutMs);
    });
    try {
      return await Promise.race([fn(),deadline]);
    }catch(error){
      if(!(error instanceof DriverError&&
        (error.code==='DATABASE_ERROR'||error.code==='INVALID_INPUT')))this.destroy();
      throw error;
    }finally{
      if(timer)clearTimeout(timer);
      release();
    }
  }

  private async send(body:Buffer):Promise<void>{await this.stream.send(body);}
  private async get():Promise<Buffer>{return serverPacket(await this.stream.read());}
  private async metadata(count:number){return readMetadata(()=>this.get(),count);}

  private async execute(sql:string,params:readonly BindValue[]):Promise<QueryResult>{
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

  async query(sql:string,parameters:readonly BindValue[]=[]):Promise<QueryResult>{
    return this.serial(()=>this.execute(sql,parameters));
  }

  private async control(command:'START TRANSACTION'|'COMMIT'|'ROLLBACK'):Promise<QueryResult>{
    this.stream.reset();
    await this.send(Buffer.concat([Buffer.from([3]),Buffer.from(command,'ascii')]));
    const response=await this.get();
    if(!isOk(response))throw Error('Expected transaction OK');
    return ok(response);
  }

  async transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>):Promise<T>{
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
    });
    if(!outcome.success)throw outcome.error;
    return outcome.value;
  }

  async close():Promise<void>{
    await this.tail;
    if(this.closed)return;
    this.closed=true;
    try{
      this.stream.reset();
      await this.send(Buffer.from([1]));
    }catch{
      // The socket is still destroyed below even when QUIT cannot be delivered.
    }finally{this.destroy();}
  }
}

/** Real MySQL 8.4 Classic protocol transport; no external database-client driver. */
export async function connectMysql(input:MysqlTarget):Promise<MysqlSession>{
  const target=validate(input);
  const socket=net.createConnection({host:target.host,port:target.port});
  socket.setNoDelay(true);
  const stream=new PacketStream(socket);
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
    let active:Socket=socket;
    if(secure){
      await stream.send(sslRequest(selectedFlags));
      stream.detach();
      active=await new Promise<tls.TLSSocket>((resolve,reject)=>{
        const secureSocket=tls.connect({
          socket,servername:target.serverName??target.host,
          ca:target.ca,minVersion:'TLSv1.2',rejectUnauthorized:true
        });
        secureSocket.once('secureConnect',()=>{
          if(secureSocket.authorized)resolve(secureSocket);
          else reject(fail('TLS_FAILED','Database identity verification failed'));
        });
        secureSocket.once('error',reject);
      });
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
    socket.destroy();
    if(error instanceof DriverError)throw error;
    throw new DriverError('CONNECTION_FAILED',error instanceof Error?error.message:'MySQL connection failed');
  }finally{clearTimeout(timer);}
}
