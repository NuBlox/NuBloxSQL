import {Cursor,T} from './protocol/primitives.js';
import type {MysqlColumn} from '../../core/contracts.js';

const pad=(n:number,width=2):string=>String(n).padStart(width,'0');
const utf8=new TextDecoder('utf-8',{fatal:true});
const western=new TextDecoder('windows-1252',{fatal:true});

/** MySQL reports the output collation identifier in column metadata.
 * A binary collation (63) describes raw bytes, not UTF-8 text. */
function textValue(bytes:Buffer,charset:number):string{
  // Identifiers used by utf8mb3 and utf8mb4 collations in MySQL 8.x.
  if([33,45,46,83,255].includes(charset)||
    (charset>=192&&charset<=215)||
    (charset>=224&&charset<=247)||
    (charset>=256&&charset<=309))
    return utf8.decode(bytes);
  // MySQL latin1 has the Windows-1252 repertoire. ASCII is compatible with UTF-8.
  if([8,15,31,47,48,49,94].includes(charset))
    return western.decode(bytes);
  if([11,65].includes(charset))return utf8.decode(bytes);
  throw new Error('Unsupported MySQL result character-set collation '+charset);
}
function valueBytes(cursor:Cursor):Buffer{
  const value=cursor.lbytes();
  if(value===null)throw Error('Unexpected NULL outside MySQL result NULL bitmap');
  return value;
}
function fraction(microseconds:number,precision:number):string{
  if(microseconds<0||microseconds>999999)
    throw Error('Invalid MySQL fractional seconds');
  // Expressions can advertise an unspecified precision. Preserve the six
  // available wire digits in that case when there is a nonzero fraction.
  const digits=precision>=0&&precision<=6?precision:(microseconds?6:0);
  return digits?'.'+pad(microseconds,6).slice(0,digits):'';
}
/** Never coerce MySQL calendar/time values into JS Date: zero dates, negative
 * durations, microseconds and zone-free DATETIME cannot safely roundtrip. */
function temporal(c:Cursor,column:MysqlColumn):string{
  const type=column.type;
  const length=c.byte();
  if(type===T.TIME){
    if(length===0)return '00:00:00'+fraction(0,column.decimals);
    if(length!==8&&length!==12)throw Error('Invalid MySQL TIME length');
    const negative=c.byte(),days=c.four(),hour=c.byte(),minute=c.byte(),second=c.byte();
    const microseconds=length===12?c.four():0;
    if(negative>1||hour>23||minute>59||second>59)
      throw Error('Invalid MySQL TIME fields');
    const totalHours=days*24+hour;
    return (negative?'-':'')+pad(totalHours)+':'+pad(minute)+':'+pad(second)+fraction(microseconds,column.decimals);
  }
  if(length===0){
    return type===T.DATE?'0000-00-00':'0000-00-00 00:00:00'+fraction(0,column.decimals);
  }
  if(type===T.DATE&&length!==4)throw Error('Invalid MySQL DATE length');
  if(type!==T.DATE&&![4,7,11].includes(length))throw Error('Invalid MySQL DATETIME length');
  const year=c.two(),month=c.byte(),day=c.byte();
  if(month>12||day>31)throw Error('Invalid MySQL date fields');
  let value=pad(year,4)+'-'+pad(month)+'-'+pad(day);
  if(type===T.DATE)return value;
  let hour=0,minute=0,second=0,microseconds=0;
  if(length>=7){
    hour=c.byte();minute=c.byte();second=c.byte();
    if(hour>23||minute>59||second>59)throw Error('Invalid MySQL datetime fields');
  }
  if(length===11)microseconds=c.four();
  value+=' '+pad(hour)+':'+pad(minute)+':'+pad(second);
  return value+fraction(microseconds,column.decimals);
}
/** MySQL binary prepared-statement row. Integer/bit/decimal/temporal fidelity
 * is deliberate: exact decimals => string, 64-bit integers => bigint, binary
 * bytes => Buffer, and dates/times => timezone-free strings. */
export function binaryRow(buf:Buffer,cols:readonly MysqlColumn[]):Record<string,unknown>{
  const cursor=new Cursor(buf);
  if(cursor.byte()!==0)throw Error('Invalid MySQL binary result row');
  const bitmap=cursor.take(Math.ceil((cols.length+2)/8));
  const row:Record<string,unknown>=Object.create(null);
  for(let i=0;i<cols.length;i++){
    const column=cols[i];
    if(bitmap[(i+2)>>3]&(1<<((i+2)%8))){
      row[column.name]=null;
      continue;
    }
    const type=column.type;
    let value:unknown;
    if(type===T.TINY){
      const bytes=cursor.take(1);
      value=column.unsigned?bytes.readUInt8():bytes.readInt8();
    }else if(type===T.SHORT||type===T.YEAR){
      const bytes=cursor.take(2);
      value=column.unsigned?bytes.readUInt16LE():bytes.readInt16LE();
    }else if(type===T.LONG||type===T.INT24){
      const bytes=cursor.take(4);
      value=column.unsigned?bytes.readUInt32LE():bytes.readInt32LE();
    }else if(type===T.LONGLONG){
      const bytes=cursor.take(8);
      value=column.unsigned?bytes.readBigUInt64LE():bytes.readBigInt64LE();
    }else if(type===T.FLOAT){
      value=cursor.take(4).readFloatLE();
    }else if(type===T.DOUBLE){
      value=cursor.take(8).readDoubleLE();
    }else if([T.DATE,T.TIME,T.DATETIME,T.TIMESTAMP].includes(type)){
      value=temporal(cursor,column);
    }else if(type===T.BIT||type===T.GEOMETRY){
      value=valueBytes(cursor);
    }else if([T.BLOB,T.TINY_BLOB,T.MEDIUM_BLOB,T.LONG_BLOB,
                 T.VARCHAR,T.VAR_STRING,T.STRING].includes(type)){
      const bytes=valueBytes(cursor);
      value=column.charset===63?bytes:textValue(bytes,column.charset);
    }else if([T.JSON,T.NEWDECIMAL,T.DECIMAL,T.ENUM,T.SET].includes(type)){
      // JSON is returned as serialized text rather than implicitly parsed.
      // Decimal digits are ASCII on the wire and must not become floating point.
      const bytes=valueBytes(cursor);
      value=(type===T.JSON||type===T.ENUM||type===T.SET)
        ? (column.charset===63?utf8.decode(bytes):textValue(bytes,column.charset))
        :bytes.toString('ascii');
    }else{
      throw Error('Unsupported MySQL binary result type '+type);
    }
    row[column.name]=value;
  }
  if(cursor.remaining()!==0)throw Error('Trailing MySQL binary row bytes');
  return row;
}
