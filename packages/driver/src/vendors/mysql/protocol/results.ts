// @ts-nocheck
import {Cursor} from './primitives.js';
export function errorPacket(buf){const c=new Cursor(buf);c.byte();const code=c.two();let state='HY000';if(c.remaining()>=6&&c.b[c.p]===35){c.byte();state=c.take(5).toString();}return {code,state,message:c.take(c.remaining()).toString('utf8')};}
export function field(buf){const c=new Cursor(buf);c.lstr();const schema=c.lstr(),table=c.lstr();c.lstr();const name=c.lstr();c.lstr();const fixed=c.len();if(fixed<12)throw Error('Invalid metadata');const charset=c.two(),length=c.four(),type=c.byte(),flags=c.two(),decimals=c.byte();c.take(2);return {name,schema,table,charset,length,type,flags,decimals,unsigned:!!(flags&32)};}
export function ok(buf){const c=new Cursor(buf);if(c.byte()!==0)throw Error('Not an OK packet');const affectedRows=c.len(),insertId=c.len(),status=c.remaining()>=2?c.two():0,warnings=c.remaining()>=2?c.two():0;return {rows:[],columns:[],affectedRows,insertId,status,warnings};}
