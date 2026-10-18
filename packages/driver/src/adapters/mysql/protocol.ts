/**
 * NuBloxSQL-owned MySQL classic-protocol primitives.
 *
 * Behaviour selectively derived from NuBloxSQL's immutable MySQL archive:
 * lib/dialects/mysql/lib/protocol/{PacketFramer,HandshakeV10,Auth,ClientPackets}.js.
 * This deliberately private foundation is NOT a connected MySQL adapter.
 * A real MySQL 8.4/9.x TLS/auth/prepared-query conformance suite is required
 * before the public Driver can advertise engine:'mysql'.
 */
import {createHash} from 'node:crypto';

const MAX_MYSQL_PAYLOAD=0xffffff;
const DEFAULT_PACKET_BUDGET=2*1024*1024;

export const MYSQL_CAPABILITIES=Object.freeze({
  LONG_PASSWORD:0x00000001,
  LONG_FLAG:0x00000004,
  CONNECT_WITH_DB:0x00000008,
  LOCAL_FILES:0x00000080,
  PROTOCOL_41:0x00000200,
  SSL:0x00000800,
  TRANSACTIONS:0x00002000,
  SECURE_CONNECTION:0x00008000,
  MULTI_STATEMENTS:0x00010000,
  PLUGIN_AUTH:0x00080000
});

export type MysqlPacket={readonly sequenceId:number;readonly payload:Buffer};
export type MysqlHandshake={
  readonly protocolVersion:10;
  readonly serverVersion:string;
  readonly connectionId:number;
  readonly capabilityFlags:number;
  readonly characterSet:number;
  readonly statusFlags:number;
  readonly authPluginName:'caching_sha2_password'|'mysql_native_password';
  readonly scramble:Buffer;
};

function validSequence(n:number):boolean{return Number.isInteger(n)&&n>=0&&n<=255;}
function cstring(value:string,field:string):Buffer{
  if(typeof value!=='string'||!value||value.includes('\0')||Buffer.byteLength(value)>1024)
    throw new TypeError('Invalid MySQL '+field);
  return Buffer.from(value+'\0','utf8');
}
/** One physical packet only. Continuation frames are deliberately not supported yet. */
export function encodeMysqlPacket(payload:Buffer,sequenceId:number,maxBytes=DEFAULT_PACKET_BUDGET):Buffer{
  if(!Buffer.isBuffer(payload)||!validSequence(sequenceId)||
     !Number.isInteger(maxBytes)||maxBytes<1||maxBytes>=MAX_MYSQL_PAYLOAD||
     payload.length>maxBytes)throw new RangeError('Invalid or oversized MySQL packet');
  const framed=Buffer.allocUnsafe(payload.length+4);
  framed.writeUIntLE(payload.length,0,3);
  framed[3]=sequenceId;
  payload.copy(framed,4);
  return framed;
}
/**
 * Reassembles split TCP packets, validates every server sequence byte, and
 * poisons the stream permanently on malformed/oversize input. Handshake and
 * command boundaries must explicitly reset the expected sequence.
 */
export class MysqlPacketDecoder{
  private pending=Buffer.alloc(0);
  private nextSequence:number;
  private failed=false;
  constructor(readonly maxPayloadBytes=DEFAULT_PACKET_BUDGET,expectedSequence=0){
    if(!Number.isInteger(maxPayloadBytes)||maxPayloadBytes<1||
       maxPayloadBytes>=MAX_MYSQL_PAYLOAD||!validSequence(expectedSequence))
      throw new RangeError('Invalid MySQL decoder limits');
    this.nextSequence=expectedSequence;
  }
  resetSequence(expectedSequence:number):void{
    if(this.failed||this.pending.length!==0||!validSequence(expectedSequence))
      throw new Error('Cannot reset an incomplete or failed MySQL packet stream');
    this.nextSequence=expectedSequence;
  }
  push(chunk:Buffer):MysqlPacket[]{
    if(this.failed)throw new Error('MySQL packet stream is permanently invalid');
    try{
      if(!Buffer.isBuffer(chunk))throw new TypeError('MySQL stream requires Buffer chunks');
      if(chunk.length===0)return [];
      if(this.pending.length+chunk.length>this.maxPayloadBytes+4)
        throw new RangeError('MySQL frame buffering limit exceeded');
      const input=this.pending.length?Buffer.concat([this.pending,chunk]):chunk;
      const packets:MysqlPacket[]=[];
      let offset=0;
      while(input.length-offset>=4){
        const size=input.readUIntLE(offset,3);
        if(size>this.maxPayloadBytes)
          throw new RangeError('MySQL packet exceeds configured limit');
        if(input.length-offset<size+4)break;
        const sequenceId=input[offset+3]!;
        if(sequenceId!==this.nextSequence)
          throw new Error('Unexpected MySQL packet sequence');
        this.nextSequence=(this.nextSequence+1)&255;
        packets.push(Object.freeze({
          sequenceId,payload:Buffer.from(input.subarray(offset+4,offset+4+size))
        }));
        offset+=size+4;
      }
      this.pending=Buffer.from(input.subarray(offset));
      return packets;
    }catch(e){
      this.failed=true;
      this.pending=Buffer.alloc(0);
      throw e;
    }
  }
}
function readNul(data:Buffer,start:number,maxBytes:number):{value:string;next:number}{
  const stop=data.indexOf(0,start);
  if(stop<0||stop-start>maxBytes)throw new RangeError('Malformed MySQL handshake string');
  return {value:data.toString('utf8',start,stop),next:stop+1};
}
/** Refuse legacy, truncated and unsupported-authentication greetings. */
export function parseMysqlHandshake(payload:Buffer):MysqlHandshake{
  if(!Buffer.isBuffer(payload)||payload.length<34||payload.length>1024||
     payload[0]!==10)throw new RangeError('Unsupported MySQL handshake');
  const version=readNul(payload,1,128);
  let p=version.next;
  if(p+4+8+1+2+1+2+2+1+10>payload.length)
    throw new RangeError('Truncated MySQL handshake');
  const connectionId=payload.readUInt32LE(p);p+=4;
  const first=payload.subarray(p,p+8);p+=8;
  if(payload[p++]!==0)throw new RangeError('Invalid MySQL handshake filler');
  const low=payload.readUInt16LE(p);p+=2;
  const characterSet=payload[p++]!;
  const statusFlags=payload.readUInt16LE(p);p+=2;
  const high=payload.readUInt16LE(p);p+=2;
  const capabilities=((high<<16)|low)>>>0;
  const authLength=payload[p++]!;
  p+=10;
  const required=MYSQL_CAPABILITIES.PROTOCOL_41|
    MYSQL_CAPABILITIES.SECURE_CONNECTION|MYSQL_CAPABILITIES.PLUGIN_AUTH;
  if((capabilities&required)!==required||authLength<21||authLength>255)
    throw new RangeError('Unsupported MySQL server authentication capabilities');
  const secondLength=Math.max(13,authLength-8);
  if(p+secondLength>payload.length)
    throw new RangeError('Incomplete MySQL authentication scramble');
  let second=payload.subarray(p,p+secondLength);p+=secondLength;
  if(second[second.length-1]===0)second=second.subarray(0,-1);
  const scramble=Buffer.concat([first,second]);
  if(scramble.length!==authLength-1||scramble.length<20)
    throw new RangeError('Invalid MySQL authentication scramble');
  const name=readNul(payload,p,128);
  if(name.next!==payload.length)throw new RangeError('Unexpected MySQL handshake trailing bytes');
  if(name.value!=='caching_sha2_password'&&name.value!=='mysql_native_password')
    throw new RangeError('Unsupported MySQL authentication plugin');
  return Object.freeze({
    protocolVersion:10 as const,serverVersion:version.value,connectionId,
    capabilityFlags:capabilities,characterSet,statusFlags,
    authPluginName:name.value,scramble:Buffer.from(scramble)
  });
}
function digest(algorithm:'sha1'|'sha256',data:Buffer):Buffer{
  return createHash(algorithm).update(data).digest();
}
/** Challenge tokens only; never transmit raw credentials without verified TLS. */
export function mysqlPasswordToken(handshake:MysqlHandshake,password:string):Buffer{
  if(typeof password!=='string'||password.includes('\0')||Buffer.byteLength(password,'utf8')>4096)
    throw new TypeError('Invalid MySQL password');
  if(!password)return Buffer.alloc(0);
  if(!Buffer.isBuffer(handshake.scramble)||handshake.scramble.length<20)
    throw new TypeError('Invalid MySQL authentication seed');
  const plain=Buffer.from(password,'utf8');
  const algorithm=handshake.authPluginName==='caching_sha2_password'?'sha256':
    handshake.authPluginName==='mysql_native_password'?'sha1':null;
  if(!algorithm)throw new TypeError('Unsupported MySQL authentication plugin');
  const stage1=digest(algorithm,plain),stage2=digest(algorithm,stage1);
  const stage3=digest(algorithm,algorithm==='sha1'?
    Buffer.concat([handshake.scramble,stage2]):
    Buffer.concat([stage2,handshake.scramble]));
  return Buffer.from(stage1.map((byte,i)=>byte^stage3[i]!));
}
export type MysqlHandshakeResponseOptions={
  user:string;password:string;database?:string;
  /** TLS must already have completed certificate chain AND host validation. */
  verifiedTls:boolean;
  /** Plaintext is allowed only by an explicit isolated-loopback decision. */
  isolatedLoopback?:boolean;
};
function responseHeader(capabilities:number):Buffer{
  const header=Buffer.alloc(32);
  header.writeUInt32LE(capabilities>>>0,0);
  header.writeUInt32LE(DEFAULT_PACKET_BUDGET,4);
  header[8]=45; // utf8mb4_general_ci, a known classic-protocol collation
  return header;
}
/** SSLRequest must be sent before the TLS socket upgrade, never as a downgrade. */
export function createMysqlSslRequest(handshake:MysqlHandshake):Buffer{
  if((handshake.capabilityFlags&MYSQL_CAPABILITIES.SSL)===0)
    throw new Error('MySQL server did not advertise TLS');
  return responseHeader(clientFlags(handshake,true,false));
}
function clientFlags(handshake:MysqlHandshake,verifiedTls:boolean,withDatabase:boolean):number{
  const c=MYSQL_CAPABILITIES;
  const flags=c.LONG_PASSWORD|c.LONG_FLAG|c.PROTOCOL_41|
    c.TRANSACTIONS|c.SECURE_CONNECTION|c.PLUGIN_AUTH|
    (withDatabase?c.CONNECT_WITH_DB:0)|(verifiedTls?c.SSL:0);
  if((handshake.capabilityFlags&flags)!==flags)
    throw new Error('MySQL server cannot satisfy required client capabilities');
  return flags;
}
/** HandshakeResponse41 payload, sent only after the chosen transport is established. */
export function createMysqlHandshakeResponse(
  handshake:MysqlHandshake,opts:MysqlHandshakeResponseOptions
):Buffer{
  if(!opts||typeof opts!=='object'||(opts.verifiedTls!==true&&opts.isolatedLoopback!==true)||
     (opts.verifiedTls===true&&opts.isolatedLoopback===true))
    throw new Error('MySQL requires verified TLS or an explicit loopback exception');
  const user=cstring(opts.user,'user');
  const db=opts.database===undefined?undefined:cstring(opts.database,'database');
  const token=mysqlPasswordToken(handshake,opts.password);
  if(token.length>255)throw new Error('Invalid MySQL authentication token');
  const flags=clientFlags(handshake,opts.verifiedTls,db!==undefined);
  return Buffer.concat([
    responseHeader(flags),user,Buffer.from([token.length]),token,
    ...(db?[db]:[]),cstring(handshake.authPluginName,'authentication plugin')
  ]);
}
/** Only a verified TLS connection may perform plaintext password exchange. */
export function createMysqlFullAuthPassword(password:string,verifiedTls:boolean):Buffer{
  if(verifiedTls!==true||typeof password!=='string'||password.includes('\0')||
     Buffer.byteLength(password,'utf8')>4096)
    throw new Error('Refusing unverified MySQL full authentication');
  return Buffer.from(password+'\0','utf8');
}
