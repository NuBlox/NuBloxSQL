import {Cursor} from './primitives.js';
import {fail} from '../../../core/errors.js';
import type {MysqlColumn,QueryResult} from '../../../core/contracts.js';
export function errorPacket(buf:Buffer):{code:number;state:string;message:string}{const c=new Cursor(buf);c.byte();const code=c.two();let state='HY000';if(c.remaining()>=6&&c.b[c.p]===35){c.byte();state=c.take(5).toString();}return {code,state,message:c.take(c.remaining()).toString('utf8')};}
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
export function ok(buf:Buffer,allowMultiple=false):QueryResult{const c=new Cursor(buf);if(c.byte()!==0)throw Error('Not an OK packet');const affectedRows=c.len(),insertId=c.len(),status=c.remaining()>=2?c.two():0,warnings=c.remaining()>=2?c.two():0;if(affectedRows===null||insertId===null)throw Error('Invalid OK counts');if(!allowMultiple)assertSingleResult(status);return {rows:[],columns:[],affectedRows,insertId,status,warnings};}

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
