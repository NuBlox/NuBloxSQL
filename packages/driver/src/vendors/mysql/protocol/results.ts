import {Cursor} from './primitives.js';
import {DriverError,fail} from '../../../core/errors.js';
import type {MysqlColumn,QueryResult} from '../../../core/contracts.js';
/** A negotiated CLIENT_PROTOCOL_41 error is FF + LE16 code + '#' +
 * five ASCII SQLSTATE bytes + EOF-terminated message. Reject an incomplete
 * or legacy-format ERR rather than mislabelling untrusted bytes as a normal
 * recoverable SQL error (which could allow the socket to be reused). */
export function errorPacket(buf:Buffer):{code:number;state:string;message:string}{
  if(buf.length<9||buf[0]!==0xff||buf[3]!==0x23)
    throw fail('PROTOCOL_ERROR','Malformed MySQL Protocol 4.1 error packet');
  const state=buf.toString('ascii',4,9);
  if(!/^[0-9A-Z]{5}$/.test(state))
    throw fail('PROTOCOL_ERROR','Invalid MySQL error SQLSTATE');
  return {
    code:buf.readUInt16LE(1),
    state,
    message:buf.toString('utf8',9)
  };
}
export function field(buf:Buffer):MysqlColumn{
  const c=new Cursor(buf);
  c.lstr(); // catalog ("def")
  const schema=c.lstr();
  const table=c.lstr();
  const originalTable=c.lstr();
  const name=c.lstr();
  const originalName=c.lstr();
  const fixed=c.len();
  if(fixed!==12)throw Error('Invalid MySQL 4.1 column metadata length');
  const charset=c.two(),length=c.four(),type=c.byte(),flags=c.two(),decimals=c.byte();
  c.take(2);
  if(name===null)throw Error('Missing MySQL column name');
  if(c.remaining()!==0)throw Error('Trailing MySQL column definition bytes');
  return {name,schema,table,originalName,originalTable,charset,length,type,flags,decimals,unsigned:!!(flags&32)};
}
/** All Classic 4.1 statement OK packets require status and warnings too. */
export function ok(buf:Buffer,allowMultiple=false):QueryResult{
  return parseOkPacket(buf,allowMultiple);
}


/** Decode the same complete Classic 4.1 OK structure for prepared SQL,
 * transaction control and pool probes. A three-byte response is never proof
 * of SQL success, even with a valid physical frame and packet sequence. */
function parseOkPacket(buf:Buffer,allowMultiple:boolean):QueryResult{
  try{
    const c=new Cursor(buf);
    if(c.byte()!==0)
      throw fail('PROTOCOL_ERROR','Unexpected MySQL OK packet');
    const affectedRows=c.len(),insertId=c.len();
    if(affectedRows===null||insertId===null||c.remaining()<4)
      throw fail('PROTOCOL_ERROR','Incomplete MySQL OK packet');
    const status=c.two(),warnings=c.two();
    if(!allowMultiple)assertSingleResult(status);
    return {rows:[],columns:[],affectedRows,insertId,status,warnings};
  }catch(error){
    if(error instanceof DriverError)throw error;
    throw fail('PROTOCOL_ERROR','Malformed MySQL OK packet');
  }
}

/** Transaction and pool-control acknowledgements never permit extra results. */
export function acknowledgedOk(buf:Buffer):QueryResult{
  return parseOkPacket(buf,false);
}

/** COM_STMT_PREPARE_OK is exactly twelve bytes when optional result-set
 * metadata is not negotiated (as in the NuBloxSQL MySQL client). Reject
 * trailing bytes or an invalid reserved field before trusting the server's
 * prepared statement ID or reading its parameter/column metadata. */
export function prepareOk(buf:Buffer):{
  id:number;parameterCount:number;columnCount:number;warnings:number
}{
  if(buf.length!==12||buf[0]!==0||buf[9]!==0)
    throw fail('PROTOCOL_ERROR','Malformed MySQL statement preparation acknowledgement');
  return {
    id:buf.readUInt32LE(1),
    columnCount:buf.readUInt16LE(5),
    parameterCount:buf.readUInt16LE(7),
    warnings:buf.readUInt16LE(10)
  };
}

/** With CLIENT_PROTOCOL_41 and without CLIENT_DEPRECATE_EOF, a server EOF
 * packet is exactly five bytes: FE, warning count LE16, status flags LE16. */
export function eofStatus(buf:Buffer):{warnings:number;status:number}{
  if(buf.length!==5||buf[0]!==0xfe)
    throw Error('Malformed MySQL result EOF packet');
  return {warnings:buf.readUInt16LE(1),status:buf.readUInt16LE(3)};
}
export function assertSingleResult(status:number):void{
  if(status&0x0008)
    throw fail('UNSUPPORTED_FEATURE','MySQL multiple result sets are not supported on this connection');
  if(status&0x1000)
    throw fail('UNSUPPORTED_FEATURE','MySQL stored procedure OUT-parameter result sets are not supported');
}
