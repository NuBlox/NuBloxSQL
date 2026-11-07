import {Cursor,T} from './protocol/primitives.js';
import type {MysqlColumn} from '../../core/contracts.js';
import {textValue} from './types.js';
import {DriverError,fail} from '../../core/errors.js';

/** Strict Classic Text Protocol row decoder.
 * The wire encodes every non-NULL value as a length-encoded byte string.
 * Conversion is driven by ColumnDefinition41, not guessed from row text.
 * No binary protocol NULL bitmap or fixed-width scalar fields occur here.
 */
const ascii=(bytes:Buffer):string=>{
  // MySQL emits numeric/temporal display data as ASCII. Reject any high
  // byte before Node's lossy 'ascii' codec could hide corruption.
  for(const byte of bytes)if(byte>0x7f)
    throw Error('Non-ASCII MySQL text-protocol scalar');
  return bytes.toString('ascii');
};

function numeric(bytes:Buffer,column:MysqlColumn):number|bigint{
  const string=ascii(bytes);
  const type=column.type;
  if(type===T.FLOAT||type===T.DOUBLE){
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(string))
      throw Error('Invalid MySQL floating-point text');
    const number=Number(string);
    if(!Number.isFinite(number))throw Error('MySQL floating-point text overflow');
    return number;
  }
  if(!/^-?\d+$/.test(string))
    throw Error('Invalid MySQL integral text');
  const number=BigInt(string);
  const width=type===T.TINY?8:type===T.SHORT||type===T.YEAR?16:
    type===T.INT24?24:type===T.LONG?32:64;
  // YEAR is logically an unsigned calendar component (0000–2155) in
  // MySQL, including when a server omits the UNSIGNED field flag.
  const unsigned=column.unsigned||type===T.YEAR;
  const min=unsigned?0n:-(1n<<BigInt(width-1));
  const max=unsigned?(1n<<BigInt(width))-1n:
    (1n<<BigInt(width-1))-1n;
  if(number<min||number>max)
    throw Error('MySQL integral text exceeds declared column width');
  if(type===T.YEAR&&number!==0n&&(number<1901n||number>2155n))
    throw Error('Invalid MySQL YEAR value');
  return type===T.LONGLONG?number:Number(number);
}

function scalar(bytes:Buffer,column:MysqlColumn):unknown{
  const type=column.type;
  if(type===T.TINY||type===T.SHORT||type===T.LONG||
     type===T.INT24||type===T.LONGLONG||type===T.YEAR||
     type===T.FLOAT||type===T.DOUBLE)return numeric(bytes,column);
  if(type===T.NEWDECIMAL||type===T.DECIMAL){
    const value=ascii(bytes);
    if(!/^-?\d+(?:\.\d+)?$/.test(value))
      throw Error('Invalid MySQL DECIMAL text');
    return value;
  }
  if(type===T.DATE||type===T.DATETIME||type===T.TIMESTAMP||type===T.TIME){
    const value=ascii(bytes);
    // Preserve literal zero dates, TIME durations >24 hours and fractional
    // seconds instead of coercing them into JavaScript Date or a timezone.
    const pattern=type===T.DATE
      ?/^\d{4}-\d{2}-\d{2}$/
      :type===T.TIME
        ?/^-?\d{2,3}:\d{2}:\d{2}(?:\.\d{1,6})?$/
        :/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;
    if(!pattern.test(value))throw Error('Invalid MySQL temporal text');
    return value;
  }
  if(type===T.BIT||type===T.GEOMETRY)return bytes;
  if(type===T.JSON){
    // JSON column metadata can use a binary collation while payloads are
    // UTF-8 text. Preserve the serialized representation and exact digits.
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  if(type===T.VARCHAR||type===T.VAR_STRING||type===T.STRING||
     type===T.BLOB||type===T.TINY_BLOB||type===T.MEDIUM_BLOB||
     type===T.LONG_BLOB)
    return column.charset===63?bytes:textValue(bytes,column.charset);
  if(type===T.ENUM||type===T.SET)
    return column.charset===63?new TextDecoder('utf-8',{fatal:true}).decode(bytes):
      textValue(bytes,column.charset);
  if(type===T.NULL)
    throw Error('Unexpected value for MySQL NULL column type');
  throw Error('Unsupported MySQL text-protocol column type '+type);
}

/** Strict count and trailing-byte validation prevents field-shift ambiguity. */
export function textValues(packet:Buffer,columns:readonly MysqlColumn[]):unknown[]{
  try{
    const c=new Cursor(packet);
    const values:unknown[]=[];
    for(const column of columns){
      const bytes=c.lbytes();
      values.push(bytes===null?null:scalar(bytes,column));
    }
    if(c.remaining()!==0)
      throw Error('Trailing bytes after MySQL text result row');
    return values;
  }catch(error){
    if(error instanceof DriverError)throw error;
    throw fail('PROTOCOL_ERROR','Malformed MySQL text-protocol result row');
  }
}
