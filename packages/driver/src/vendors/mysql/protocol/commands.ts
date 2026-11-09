import {T,u32,sized,utf,LIMIT,wellFormedUtf16} from './primitives.js';
import type {BindValue} from '../../../core/contracts.js';
import {MAX_PARAMETERS} from '../../../core/resources.js';
export interface EncodedValue {type:number;flag:number;body:Buffer;nil?:boolean}
/** Classic length-encoded binary prefixes: 1, 3, 4 or 9 bytes. */
const prefixBytes=(length:number):number=>
  length<251?1:length<=65535?3:length<=16777215?4:9;

/** Determine the *entire* wire body length without materialising a bound
 * string/BLOB. All parameters are preflighted before the first payload copy.
 * It also validates scalar types so a later invalid binding does not trigger
 * allocations for earlier large valid bindings. */
function boundBodyLength(value:BindValue):number {
  if(value===null)return 0;
  if(typeof value==='boolean')return 1;
  if(typeof value==='string'||value instanceof Uint8Array){
    if(typeof value==='string'&&!wellFormedUtf16(value))
      throw new TypeError('Unpaired UTF-16 surrogate in bound MySQL text');
    const bytes=typeof value==='string'?Buffer.byteLength(value,'utf8'):value.byteLength;
    if(!Number.isSafeInteger(bytes)||bytes<0||bytes+prefixBytes(bytes)>LIMIT)
      throw RangeError('Bound parameter exceeds MySQL logical packet limit');
    return bytes+prefixBytes(bytes);
  }
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw TypeError('Number must be finite');
    if(Number.isInteger(value)&&!Number.isSafeInteger(value))
      throw TypeError('Use bigint for large integers');
    return 8;
  }
  if(typeof value==='bigint'){
    if(value<-(2n**63n)||value>2n**64n-1n)
      throw RangeError('Out of range 64-bit integer');
    return 8;
  }
  throw TypeError('Unsupported bound parameter');
}

/** Only call after the caller has checked aggregate wire size, or through
 * the public valuePacket wrapper, which first checks a single value. */
function encodeValue(value:BindValue):EncodedValue {
  if(value===null)return {type:T.NULL,flag:0,body:Buffer.alloc(0),nil:true};
  if(typeof value==='boolean')return {type:T.TINY,flag:0,body:Buffer.from([value?1:0])};
  if(typeof value==='string')return {type:T.VAR_STRING,flag:0,body:sized(utf(value))};
  if(value instanceof Uint8Array)
    return {type:T.BLOB,flag:0,body:sized(Buffer.from(value))};
  if(typeof value==='number'){
    if(Number.isInteger(value))return encodeValue(BigInt(value));
    const b=Buffer.alloc(8);b.writeDoubleLE(value);
    return {type:T.DOUBLE,flag:0,body:b};
  }
  if(typeof value==='bigint'){
    const flag=value>2n**63n-1n?128:0,b=Buffer.alloc(8);
    if(flag)b.writeBigUInt64LE(value);
    else b.writeBigInt64LE(value);
    return {type:T.LONGLONG,flag,body:b};
  }
  // Reached only if the input violates the validated BindValue contract.
  throw TypeError('Unsupported bound parameter');
}
export function valuePacket(value:BindValue):EncodedValue {
  boundBodyLength(value);
  return encodeValue(value);
}
/** Write a length-encoded parameter byte count into the final command.
 * Bound-body preflight guarantees a nonnegative, supported byte length. */
function writeBoundLength(packet:Buffer,offset:number,length:number):number{
  if(length<251){packet[offset]=length;return offset+1;}
  if(length<=0xffff){
    packet[offset]=252;
    packet.writeUInt16LE(length,offset+1);
    return offset+3;
  }
  if(length<=0xffffff){
    packet[offset]=253;
    packet[offset+1]=length&255;
    packet[offset+2]=(length>>>8)&255;
    packet[offset+3]=(length>>>16)&255;
    return offset+4;
  }
  packet[offset]=254;
  packet.writeBigUInt64LE(BigInt(length),offset+1);
  return offset+9;
}

/** One final COM_STMT_EXECUTE allocation. Preflight ALL parameters first,
 * then write their metadata, scalar values and UTF-8/binary payloads directly
 * into the final buffer. Avoid per-bind Buffer creation and duplicate copies.
 * Every byte of the unsafe allocation is explicitly initialised. */
export function execute(id:number,params:readonly BindValue[],cursor=false):Buffer{
  if(params.length>MAX_PARAMETERS)throw RangeError('Too many parameters');
  const nullBytes=Math.ceil(params.length/8);
  let length=10+(params.length?nullBytes+1+params.length*2:0);
  // Validate all values, including Unicode and aggregate size, before
  // allocating or encoding any parameter bytes.
  for(const parameter of params){
    length+=boundBodyLength(parameter);
    if(length>LIMIT)throw RangeError('Command exceeds limit');
  }
  const packet=Buffer.allocUnsafe(length);
  packet[0]=0x17;
  packet.writeUInt32LE(id>>>0,1);
  packet[5]=cursor?1:0;
  packet.writeUInt32LE(1,6);
  if(!params.length)return packet;

  const bitmapOffset=10;
  packet.fill(0,bitmapOffset,bitmapOffset+nullBytes);
  packet[bitmapOffset+nullBytes]=1; // new-parameter-bound flag
  let typeOffset=bitmapOffset+nullBytes+1;
  let bodyOffset=typeOffset+params.length*2;
  for(let i=0;i<params.length;i++){
    const value=params[i];
    let type:number;
    let flag=0;
    if(value===null){
      type=T.NULL;
      packet[bitmapOffset+(i>>3)]|=1<<(i&7);
    }else if(typeof value==='boolean'){
      type=T.TINY;
      packet[bodyOffset++]=value?1:0;
    }else if(typeof value==='string'){
      type=T.VAR_STRING;
      const bytes=Buffer.byteLength(value,'utf8');
      bodyOffset=writeBoundLength(packet,bodyOffset,bytes);
      const written=packet.write(value,bodyOffset,bytes,'utf8');
      if(written!==bytes)throw new TypeError('Bound UTF-8 encoding length changed');
      bodyOffset+=written;
    }else if(value instanceof Uint8Array){
      type=T.BLOB;
      bodyOffset=writeBoundLength(packet,bodyOffset,value.byteLength);
      packet.set(value,bodyOffset);
      bodyOffset+=value.byteLength;
    }else if(typeof value==='number'){
      if(Number.isInteger(value)){
        type=T.LONGLONG;
        packet.writeBigInt64LE(BigInt(value),bodyOffset);
      }else{
        type=T.DOUBLE;
        packet.writeDoubleLE(value,bodyOffset);
      }
      bodyOffset+=8;
    }else if(typeof value==='bigint'){
      type=T.LONGLONG;
      flag=value>0x7fffffffffffffffn?128:0;
      if(flag)packet.writeBigUInt64LE(value,bodyOffset);
      else packet.writeBigInt64LE(value,bodyOffset);
      bodyOffset+=8;
    }else{
      // Fail closed if an input violates the previously checked contract.
      throw new TypeError('Unsupported bound parameter');
    }
    packet[typeOffset++]=type;
    packet[typeOffset++]=flag;
  }
  if(bodyOffset!==length)throw new Error('Internal MySQL prepared packet size mismatch');
  return packet;
}

/** Fetch bounded rows from an executed, read-only server-side statement cursor. */
export function fetchRows(id:number,count:number):Buffer{
  if(!Number.isSafeInteger(count)||count<1||count>256)
    throw new RangeError('Cursor fetch size must be 1–256');
  return Buffer.concat([Buffer.from([0x1c]),u32(id),u32(count)]);
}
