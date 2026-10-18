// @ts-nocheck
import net from 'node:net';
import tls from 'node:tls';
import {PacketStream} from './protocol/framing.js';
import {Cursor,cstr,LIMIT,u32} from './protocol/primitives.js';
import {greeting,flags,login,sslRequest} from './protocol/handshake.js';
import {token} from './auth/plugins.js';
import {execute} from './protocol/commands.js';
import {field,ok} from './protocol/results.js';
import {binaryRow} from './types.js';
import {serverPacket,eof,isOk} from './errors.js';
import {validate} from './configuration.js';
import {mysqlCapabilities} from './capabilities.js';
import {readMetadata} from './metadata.js';
import {DriverError,fail} from '../../core/errors.js';
import {MAX_RESULT_ROWS,MAX_PARAMETERS,MAX_COLUMNS} from '../../core/resources.js';
export class MysqlSession {
 readonly info: import('../../core/contracts.js').SessionInfo;
 closed: boolean;
 constructor(stream,socket,target,hello){this._stream=stream;this._socket=socket;this._target=target;this._tail=Promise.resolve();this.closed=false;this.info=Object.freeze({engine:'mysql',model:'relational',version:hello.version,transport:target.security,authPlugin:hello.plugin,capabilities:mysqlCapabilities});}
 _destroy(){this.closed=true;this._stream.destroy();this._socket.destroy();}
 async _serial(fn){const before=this._tail;let release;this._tail=new Promise(resolve=>{release=resolve});await before;if(this.closed){release();throw fail('CONNECTION_CLOSED','Session is closed');}let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{this._destroy();reject(fail('TIMEOUT','MySQL operation timed out'));},this._target.timeoutMs);});try{return await Promise.race([fn(),timeout]);}catch(e){if(!(e instanceof DriverError&&e.code==='DATABASE_ERROR')&&!(e instanceof DriverError&&e.code==='INVALID_INPUT'))this._destroy();throw e;}finally{clearTimeout(timer);release();}}
 async _send(body){await this._stream.send(body);}
 async _get(){return serverPacket(await this._stream.read());}
 async _metadata(count){return readMetadata(()=>this._get(),count);}
 async _execute(sql,params){if(typeof sql!=='string'||!sql.trim()||Buffer.byteLength(sql,'utf8')>LIMIT||!Array.isArray(params)||params.length>MAX_PARAMETERS)throw fail('INVALID_INPUT','Invalid SQL query or parameter list');
 // Server preparation is required: user-supplied values never become SQL text.
 this._stream.reset();await this._send(Buffer.concat([Buffer.from([0x16]),Buffer.from(sql,'utf8')]));const header=await this._get();if(!isOk(header)||header.length<12)throw Error('Malformed statement preparation');const s=new Cursor(header);s.byte();const id=s.four(),columnCount=s.two(),paramCount=s.two();s.byte();s.two();
 try{if(paramCount)await this._metadata(paramCount);if(columnCount)await this._metadata(columnCount);if(paramCount!==params.length)throw fail('INVALID_INPUT','Prepared statement parameter count mismatch');
 this._stream.reset();await this._send(execute(id,params));const result=await this._get();if(isOk(result))return ok(result);
 const c=new Cursor(result),count=c.len();if(count===null||count>MAX_COLUMNS)throw Error('Invalid result column count');const cols=await this._metadata(count);const rows=[];let bytes=0;for(;;){const packet=await this._get();if(eof(packet)){if(packet.length>=5&&((packet[3] | (packet[4]<<8))&8))throw fail('UNSUPPORTED_FEATURE','Multiple result sets are not supported');return {rows,columns:cols,affectedRows:0,insertId:0};}bytes+=packet.length;if(rows.length>=MAX_RESULT_ROWS||bytes>LIMIT)throw fail('RESOURCE_LIMIT','Result exceeds configured safety limit');rows.push(binaryRow(packet,cols));}}
 finally{if(!this.closed){this._stream.reset();await this._send(Buffer.concat([Buffer.from([0x19]),u32(id)]));}}}
 async query(sql,parameters=[]){return this._serial(()=>this._execute(sql,parameters));}
 async _control(command){this._stream.reset();await this._send(Buffer.concat([Buffer.from([3]),Buffer.from(command,'ascii')]));const response=await this._get();if(!isOk(response))throw Error('Expected transaction OK');return ok(response);}
 async transaction(work){if(typeof work!=='function')throw fail('INVALID_INPUT','Transaction callback is required');const outcome=await this._serial(async()=>{await this._control('START TRANSACTION');let finished=false;try{const tx=Object.freeze({query:(sql,values=[])=>this._execute(sql,values)});let value;try{value=await work(tx);}catch(error){await this._control('ROLLBACK');finished=true;return {success:false,error};}await this._control('COMMIT');finished=true;return {success:true,value};}finally{if(!finished&&!this.closed){try{await this._control('ROLLBACK');}catch{this._destroy();}}}});if(!outcome.success)throw outcome.error;return outcome.value;}
 async close(){const before=this._tail;await before;if(this.closed)return;this.closed=true;try{this._stream.reset();await this._send(Buffer.from([1]));}catch{}finally{this._destroy();}}
}
export async function connectMysql(input){const t=validate(input);const socket=net.createConnection({host:t.host,port:t.port});socket.setNoDelay(true);const stream=new PacketStream(socket);let timer=setTimeout(()=>{socket.destroy(fail('TIMEOUT','MySQL connection timeout'));},t.timeoutMs);try{await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});const hello=greeting(await stream.read());const secure=t.security==='verified-tls';const f=flags(hello.flags,secure,t.database);let active=socket;
 if(secure){await stream.send(sslRequest(f));stream.detach();active=await new Promise((resolve,reject)=>{const s=tls.connect({socket,servername:t.serverName??t.host,ca:t.ca,minVersion:'TLSv1.2',rejectUnauthorized:true});s.once('secureConnect',()=>{if(s.authorized)resolve(s);else reject(fail('TLS_FAILED','Database identity verification failed'));});s.once('error',reject);});stream.attach(active);}
 await stream.send(login({f,user:t.user,password:t.password,database:t.database,seed:hello.seed,plugin:hello.plugin}));let plugin=hello.plugin;for(let i=0;i<6;i++){const b=serverPacket(await stream.read());if(b[0]===0){clearTimeout(timer);return new MysqlSession(stream,active,t,{...hello,plugin});}
 if(b[0]===254){const c=new Cursor(b);c.byte();plugin=c.zero();const seed=c.take(c.remaining());const normalized=seed.at(-1)===0?seed.subarray(0,-1):seed;if(!['mysql_native_password','caching_sha2_password'].includes(plugin))throw fail('AUTH_UNSUPPORTED','Unsupported authentication plugin');await stream.send(token(t.password,normalized,plugin));continue;}
 if(b[0]===1&&plugin==='caching_sha2_password'){if(b[1]===3)continue;if(b[1]===4){if(!secure)throw fail('AUTH_UNSUPPORTED','Full authentication requires verified TLS');await stream.send(cstr(t.password));continue;}}
 throw fail('AUTH_UNSUPPORTED','Unsupported authentication exchange');}
 throw fail('AUTH_UNSUPPORTED','Authentication negotiation exceeded step limit');
 }catch(e){stream.destroy();socket.destroy();if(e instanceof DriverError)throw e;throw new DriverError('CONNECTION_FAILED',e.message||'MySQL connection failed');}finally{clearTimeout(timer);}}
