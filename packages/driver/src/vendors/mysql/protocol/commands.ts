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
/** Allocate one final COM_STMT_EXECUTE buffer instead of temporary header,
 * bitmap and type buffers followed by Buffer.concat on every execution.
 * valuePacket retains existing type/range/UTF-8 rules. Size is checked
 * BEFORE allocating and all bytes of the unsafe buffer are initialised. */
export function execute(id:number,params:readonly BindValue[],cursor=false):Buffer{
  if(params.length>MAX_PARAMETERS)throw RangeError('Too many parameters');
  const nullBytes=Math.ceil(params.length/8);
  let length=10+(params.length?nullBytes+1+params.length*2:0);
  // Fail before allocating/duplicating any variable-length payload, even
  // when the limit is exceeded only by *multiple* individually-valid binds.
  for(const parameter of params){
    length+=boundBodyLength(parameter);
    if(length>LIMIT)throw RangeError('Command exceeds limit');
  }
  const values=params.map(encodeValue);
  const packet=Buffer.allocUnsafe(length);
  packet[0]=0x17;
  packet.writeUInt32LE(id>>>0,1);
  packet[5]=cursor?1:0;
  packet.writeUInt32LE(1,6);
  if(!values.length)return packet;
  let offset=10;
  packet.fill(0,offset,offset+nullBytes);
  const bitmapOffset=offset;
  offset+=nullBytes;
  packet[offset++]=1; // new-parameter-bound flag: types accompany each call
  for(let i=0;i<values.length;i++){
    const value=values[i];
    if(value.nil)packet[bitmapOffset+(i>>3)]|=1<<(i%8);
    packet[offset++]=value.type;
    packet[offset++]=value.flag;
  }
  for(const value of values){
    if(value.nil)continue;
    offset+=value.body.copy(packet,offset);
  }
  return packet;
}

/** Fetch bounded rows from an executed, read-only server-side statement cursor. */
export function fetchRows(id:number,count:number):Buffer{
  if(!Number.isSafeInteger(count)||count<1||count>256)
    throw new RangeError('Cursor fetch size must be 1–256');
  return Buffer.concat([Buffer.from([0x1c]),u32(id),u32(count)]);
}
