import {Cursor,T} from './codec.js';
const pad=(x,n=2)=>String(x).padStart(n,'0');
function temporal(c,type){const length=c.byte();if(!length)return type===T.TIME?'00:00:00':type===T.DATE?'0000-00-00':'0000-00-00 00:00:00';if(type===T.TIME){if(length!==8&&length!==12)throw Error('Invalid TIME length');const sign=c.byte(),days=c.four(),h=c.byte(),m=c.byte(),s=c.byte(),micro=length===12?c.four():0;return (sign?'-':'')+pad(days*24+h)+':'+pad(m)+':'+pad(s)+(micro?'.'+pad(micro,6):'');}if(![4,7,11].includes(length))throw Error('Invalid DATE/TIMESTAMP length');let result=pad(c.two(),4)+'-'+pad(c.byte())+'-'+pad(c.byte());if(length>=7)result+=' '+pad(c.byte())+':'+pad(c.byte())+':'+pad(c.byte());if(length===11)result+='.'+pad(c.four(),6);return result;}
export function binaryRow(buf,cols){const c=new Cursor(buf);if(c.byte()!==0)throw Error('Invalid binary row');const bitmap=c.take(Math.ceil((cols.length+2)/8));const row=Object.create(null);for(let i=0;i<cols.length;i++){const col=cols[i];if(bitmap[(i+2)>>3]&(1<<((i+2)%8))){row[col.name]=null;continue;}const t=col.type;let v;
if(t===T.TINY){const b=c.take(1);v=col.unsigned?b.readUInt8():b.readInt8();}
else if([T.SHORT,T.YEAR].includes(t)){const b=c.take(2);v=col.unsigned?b.readUInt16LE():b.readInt16LE();}
else if([T.LONG,T.INT24].includes(t)){const b=c.take(4);v=col.unsigned?b.readUInt32LE():b.readInt32LE();}
else if(t===T.LONGLONG){const b=c.take(8);v=col.unsigned?b.readBigUInt64LE():b.readBigInt64LE();}
else if(t===T.FLOAT)v=c.take(4).readFloatLE();
else if(t===T.DOUBLE)v=c.take(8).readDoubleLE();
else if([T.DATE,T.DATETIME,T.TIMESTAMP,T.TIME].includes(t))v=temporal(c,t);
else if([T.TINY_BLOB,T.MEDIUM_BLOB,T.LONG_BLOB,T.BLOB,T.BIT,T.GEOMETRY].includes(t)||(col.charset===63&&![0,T.NEWDECIMAL,T.JSON,T.ENUM,T.SET].includes(t)))v=c.lbytes();
else {const b=c.lbytes();v=b===null?null:b.toString('utf8');}
row[col.name]=v;
}if(c.remaining())throw Error('Trailing binary row bytes');return row;}
