import {T,u32,sized,utf,LIMIT} from './primitives.js';
import type {BindValue} from '../../../core/contracts.js';
import {MAX_PARAMETERS} from '../../../core/resources.js';
export interface EncodedValue {type:number;flag:number;body:Buffer;nil?:boolean}
export function valuePacket(value:BindValue):EncodedValue{if(value===null)return {type:T.NULL,flag:0,body:Buffer.alloc(0),nil:true};if(typeof value==='boolean')return {type:T.TINY,flag:0,body:Buffer.from([value?1:0])};if(typeof value==='string')return {type:T.VAR_STRING,flag:0,body:sized(utf(value))};if(value instanceof Uint8Array)return {type:T.BLOB,flag:0,body:sized(Buffer.from(value))};if(typeof value==='number'){if(!Number.isFinite(value))throw TypeError('Number must be finite');if(Number.isInteger(value)){if(!Number.isSafeInteger(value))throw TypeError('Use bigint for large integers');return valuePacket(BigInt(value));}const b=Buffer.alloc(8);b.writeDoubleLE(value);return {type:T.DOUBLE,flag:0,body:b};}if(typeof value==='bigint'){if(value<-(2n**63n)||value>2n**64n-1n)throw RangeError('Out of range 64-bit integer');const flag=value>2n**63n-1n?128:0,b=Buffer.alloc(8);if(flag)b.writeBigUInt64LE(value);else b.writeBigInt64LE(value);return {type:T.LONGLONG,flag,body:b};}throw TypeError('Unsupported bound parameter');}
export function execute(id:number,params:readonly BindValue[],cursor=false):Buffer{if(params.length>MAX_PARAMETERS)throw RangeError('Too many parameters');const values=params.map(valuePacket);const header=Buffer.concat([Buffer.from([0x17]),u32(id),Buffer.from([cursor?1:0]),u32(1)]);if(!values.length)return header;const nulls=Buffer.alloc(Math.ceil(values.length/8));values.forEach((v,i)=>{if(v.nil)nulls[i>>3]|=1<<(i%8)});const packet=Buffer.concat([header,nulls,Buffer.from([1]),...values.map(v=>Buffer.from([v.type,v.flag])),...values.filter(v=>!v.nil).map(v=>v.body)]);if(packet.length>LIMIT)throw RangeError('Command exceeds limit');return packet;}

/** Fetch bounded rows from an executed, read-only server-side statement cursor. */
export function fetchRows(id:number,count:number):Buffer{
  if(!Number.isSafeInteger(count)||count<1||count>256)
    throw new RangeError('Cursor fetch size must be 1–256');
  return Buffer.concat([Buffer.from([0x1c]),u32(id),u32(count)]);
}
