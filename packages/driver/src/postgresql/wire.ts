/** NuBloxSQL first-party PostgreSQL v3.0 wire client: bounded single-session G1 slice. */
import {createConnection, type Socket} from 'node:net';
import {createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual} from 'node:crypto';

export type NativePgConfig = {
  host: string; port: number; user: string; database: string; password: string;
  ssl: false | {rejectUnauthorized: true; servername: string; ca?: string};
  connectionTimeoutMillis: number; query_timeout: number;
  statement_timeout: number; application_name: string;
};
const MAX_MESSAGE = 4 * 1024 * 1024;
function int32(n: number): Buffer {const b=Buffer.alloc(4); b.writeInt32BE(n); return b;}
function int16(n: number): Buffer {const b=Buffer.alloc(2); b.writeInt16BE(n); return b;}
function str(s: string): Buffer {
  if (s.includes('\0')) throw new Error('Invalid PostgreSQL string');
  return Buffer.from(s+'\0','utf8');
}
function message(type: string, parts: Buffer[] = []): Buffer {
  const body=Buffer.concat(parts);
  if (body.length+4>MAX_MESSAGE) throw new Error('Oversized PostgreSQL message');
  return Buffer.concat([Buffer.from(type),int32(body.length+4),body]);
}
function readCString(b: Buffer,start: number): {value:string;next:number} {
  const end=b.indexOf(0,start);
  if(end<start||end-start>65535) throw new Error('Invalid protocol string');
  return {value:b.toString('utf8',start,end),next:end+1};
}
function serverError(b: Buffer): Error & {code?:string} {
  let p=0,code='';
  while(p<b.length) {
    const tag=b[p++];
    if(tag===0) break;
    const field=readCString(b,p); p=field.next;
    if(tag===67) code=field.value;
  }
  const e: Error & {code?:string}=new Error('PostgreSQL operation failed');
  e.code=code;
  return e;
}
class FramedPeer {
  private buffer=Buffer.alloc(0);
  private pending: {size:number;resolve:(b:Buffer)=>void;reject:(e:Error)=>void}[]=[];
  private failed: Error|undefined;
  constructor(private socket: Socket) {
    socket.on('data',(chunk:Buffer)=>{
      if(this.buffer.length+chunk.length>MAX_MESSAGE+65536) {
        const e=new Error('Excessive PostgreSQL data');this.error(e);socket.destroy();return;
      }
      this.buffer=Buffer.concat([this.buffer,chunk]);
      while(this.pending.length&&this.buffer.length>=this.pending[0]!.size) {
        const item=this.pending.shift()!,b=this.buffer.subarray(0,item.size);
        this.buffer=this.buffer.subarray(item.size);item.resolve(b);
      }
    });
    socket.on('error',(e:Error)=>this.error(e));
    socket.on('close',()=>this.error(new Error('Connection closed')));
  }
  private error(e:Error):void {if(this.failed)return;this.failed=e;for(const p of this.pending.splice(0))p.reject(e);}
  private take(n:number):Promise<Buffer> {
    if(!Number.isInteger(n)||n<1||n>MAX_MESSAGE)return Promise.reject(new Error('Invalid frame size'));
    if(this.failed)return Promise.reject(this.failed);
    if(this.buffer.length>=n) {
      const b=this.buffer.subarray(0,n);this.buffer=this.buffer.subarray(n);return Promise.resolve(b);
    }
    return new Promise((resolve,reject)=>this.pending.push({size:n,resolve,reject}));
  }
  async next():Promise<{type:string;body:Buffer}> {
    const h=await this.take(5),size=h.readInt32BE(1);
    if(size<4||size>MAX_MESSAGE)throw new Error('Invalid PostgreSQL frame');
    return {type:String.fromCharCode(h[0]!),body:size===4?Buffer.alloc(0):await this.take(size-4)};
  }
  send(b:Buffer):void {if(this.failed||this.socket.destroyed)throw new Error('Connection unavailable');this.socket.write(b);}
}
function scramFields(text:string):Map<string,string> {
  const map=new Map<string,string>();
  for(const field of text.split(',')) {
    if(field.length<3||field[1]!=='='||map.has(field[0]!))throw new Error('Malformed SCRAM challenge');
    map.set(field[0]!,field.slice(2));
  }
  return map;
}
export class NativePgClient {
  private socket:Socket|undefined;
  private peer:FramedPeer|undefined;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private ready=false;
  constructor(private config:NativePgConfig){}
  private send(type:string, parts:Buffer[]=[]):void {this.peer!.send(message(type,parts));}
  async connect():Promise<void> {
    if(this.socket)throw new Error('Cannot connect twice');
    if(this.config.ssl) {
      const e:Error & {code?:string}=new Error('Remote TLS protocol is not qualified by this native adapter');
      e.code='ERR_TLS_CERT_ALTNAME_INVALID';throw e;
    }
    const c=this.config;
    if(!/^[\x20-\x7e]+$/.test(c.password)||[c.user,c.database,c.application_name].some(x=>x.includes('\0')))
      throw new Error('Unsupported credential encoding');
    const socket=createConnection({host:c.host,port:c.port});this.socket=socket;
    const timeout:Error & {code?:string}=new Error('Database request timed out');timeout.code='ETIMEDOUT';
    this.timer=setTimeout(()=>socket.destroy(timeout),c.connectionTimeoutMillis);
    try {
      await new Promise<void>((resolve,reject)=>{
        const ok=()=>{socket.off('error',fail);resolve();};
        const fail=(e:Error)=>{socket.off('connect',ok);reject(e);};
        socket.once('connect',ok);socket.once('error',fail);
      });
      this.peer=new FramedPeer(socket);
      const body=Buffer.concat([int32(196608),str('user'),str(c.user),
        str('database'),str(c.database),str('application_name'),str(c.application_name),
        str('client_encoding'),str('UTF8'),Buffer.from([0])]);
      this.peer.send(Buffer.concat([int32(body.length+4),body]));
      await this.authenticate();
      this.ready=true;
    } catch(e){await this.end();throw e;}
  }
  private async authenticate():Promise<void> {
    let nonce='',firstBare='',signature:Buffer|undefined,proofVerified=false,authenticated=false;
    for (;;) {
      const {type,body}=await this.peer!.next();
      if(type==='E')throw serverError(body);
      if(type==='R') {
        if(body.length<4)throw new Error('Invalid auth frame');
        const kind=body.readInt32BE(0);
        if(kind===0) {
          if(nonce&&!proofVerified)throw new Error('Unverified SCRAM server');
          authenticated=true;
        } else if(kind===10) {
          if(!body.subarray(4).toString('utf8').split('\0').includes('SCRAM-SHA-256'))
            throw new Error('Unsupported auth mechanism');
          nonce=randomBytes(18).toString('base64').replace(/=/g,'');
          firstBare='n=,r='+nonce;
          const first=Buffer.from('n,,'+firstBare);
          this.send('p',[str('SCRAM-SHA-256'),int32(first.length),first]);
        } else if(kind===11&&nonce) {
          const challenge=body.subarray(4).toString('utf8'),attrs=scramFields(challenge);
          const serverNonce=attrs.get('r')||'',saltText=attrs.get('s')||'',iterations=Number(attrs.get('i'));
          if(!serverNonce.startsWith(nonce)||serverNonce.length<=nonce.length||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(saltText)||
            !Number.isInteger(iterations)||iterations<4096||iterations>1000000)
            throw new Error('Unsafe SCRAM challenge');
          const salt=Buffer.from(saltText,'base64');
          if(salt.length<8||salt.length>256)throw new Error('Unsafe SCRAM salt');
          const finalBare='c=biws,r='+serverNonce,auth=firstBare+','+challenge+','+finalBare;
          const salted=pbkdf2Sync(castPassword(this.config.password),salt,iterations,32,'sha256');
          const clientKey=createHmac('sha256',salted).update('Client Key').digest();
          const storedKey=createHash('sha256').update(clientKey).digest();
          const clientSig=createHmac('sha256',storedKey).update(auth).digest();
          const proof=Buffer.alloc(32);
          for(let i=0;i<32;i++)proof[i]=clientKey[i]!^clientSig[i]!;
          const serverKey=createHmac('sha256',salted).update('Server Key').digest();
          signature=createHmac('sha256',serverKey).update(auth).digest();
          this.send('p',[Buffer.from(finalBare+',p='+proof.toString('base64'))]);
          salted.fill(0);clientKey.fill(0);serverKey.fill(0);proof.fill(0);
        } else if(kind===12&&signature) {
          const attrs=scramFields(body.subarray(4).toString('utf8'));
          const received=Buffer.from(attrs.get('v')||'','base64');
          if(received.length!==signature.length||!timingSafeEqual(received,signature))
            throw new Error('SCRAM signature mismatch');
          proofVerified=true;signature.fill(0);
        } else throw new Error('Unsupported PostgreSQL authentication');
      } else if(type==='Z') {
        if(!authenticated||body.length!==1||body[0]!==73)throw new Error('Unexpected startup transaction status');
        return;
      } else if(!['S','K','N'].includes(type))throw new Error('Unexpected PostgreSQL startup message');
    }
  }
  async query(sql:string,values:readonly (string|number)[]=[]):Promise<{rows:Record<string,unknown>[]}> {
    if(!this.ready||!this.peer||sql.includes('\0')||values.length>16)throw new Error('Invalid native query state');
    const parts=[str(''),str(''),int16(0),int16(values.length)];
    for(const value of values) {
      const t=String(value);
      if(!(typeof value==='string'||typeof value==='number')||t.length>16384)
        throw new Error('Invalid query parameter');
      const b=Buffer.from(t);parts.push(int32(b.length),b);
    }
    parts.push(int16(0));
    this.send('P',[str(''),str(sql),int16(0)]);
    this.send('B',parts);this.send('D',[Buffer.from('P'),str('')]);
    this.send('E',[str(''),int32(0)]);this.send('S');
    let columns:string[]=[];const rows:Record<string,unknown>[]=[];
    for (;;) {
      const {type,body}=await this.peer.next();
      if(type==='E')throw serverError(body);
      if(type==='T') {
        if(body.length<2)throw new Error('Malformed column information');
        const size=body.readUInt16BE(0);if(size>128)throw new Error('Column count exceeded');
        columns=[];let pos=2;
        for(let i=0;i<size;i++){
          const field=readCString(body,pos);pos=field.next+18;
          if(pos>body.length)throw new Error('Malformed column type');
          columns.push(field.value);
        }
      } else if(type==='D') {
        if(body.length<2||body.readUInt16BE(0)!==columns.length||rows.length>=1001)
          throw new Error('Invalid row count');
        const row:Record<string,unknown>=Object.create(null);let pos=2;
        for(const key of columns) {
          if(pos+4>body.length)throw new Error('Truncated row');
          const n=body.readInt32BE(pos);pos+=4;
          if(n< -1||(n>=0&&pos+n>body.length))throw new Error('Invalid row length');
          row[key]=n=== -1?null:body.toString('utf8',pos,pos+n);
          if(n>=0)pos+=n;
        }
        if(pos!==body.length)throw new Error('Unexpected row bytes');
        rows.push(row);
      } else if(type==='Z') {
        if(body.length!==1||body[0]!==73)throw new Error('Unexpected session state');
        return {rows};
      } else if(!['1','2','C','n','N','S','t'].includes(type))
        throw new Error('Unexpected query response');
    }
  }
  async end():Promise<void>{
    this.ready=false;
    if(this.timer)clearTimeout(this.timer);
    try{if(this.peer&&this.socket&&!this.socket.destroyed)this.send('X');}catch{/* already disconnected */}
    if(this.socket)this.socket.destroy();
    this.socket=undefined;
  }
}
function castPassword(password:string):string {return password;}
