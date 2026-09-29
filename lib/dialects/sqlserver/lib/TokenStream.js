'use strict';

var TOKENS = Object.freeze({
  RETURNSTATUS: 0x79,
  COLMETADATA: 0x81,
  ERROR: 0xaa,
  INFO: 0xab,
  RETURNVALUE: 0xac,
  LOGINACK: 0xad,
  FEATUREEXTACK: 0xae,
  ROW: 0xd1,
  NBCROW: 0xd2,
  ENVCHANGE: 0xe3,
  SESSIONSTATE: 0xe4,
  SSPI: 0xed,
  FEDAUTHINFO: 0xee,
  DONE: 0xfd,
  DONEPROC: 0xfe,
  DONEINPROC: 0xff
});

var DONE_STATUS = Object.freeze({
  MORE: 0x0001,
  ERROR: 0x0002,
  IN_TRANSACTION: 0x0004,
  COUNT: 0x0010,
  ATTENTION: 0x0020,
  SERVER_ERROR: 0x0100
});

function need(buffer, offset, count, label) { if (offset + count > buffer.length) throw new RangeError('Incomplete SQL Server ' + label); }
function readUnicode(buffer, offset, chars) { var bytes=chars*2;need(buffer,offset,bytes,'Unicode value');return {value:buffer.toString('utf16le',offset,offset+bytes),offset:offset+bytes}; }
function readUsVarchar(buffer, offset) { need(buffer,offset,2,'US_VARCHAR length');var chars=buffer.readUInt16LE(offset);return readUnicode(buffer,offset+2,chars); }
function readBVarchar(buffer, offset) { need(buffer,offset,1,'B_VARCHAR length');var chars=buffer[offset++];return readUnicode(buffer,offset,chars); }
function variableToken(buffer, offset, name) { need(buffer,offset,3,name+' token');var length=buffer.readUInt16LE(offset+1),bodyOffset=offset+3,end=bodyOffset+length;need(buffer,bodyOffset,length,name+' body');return {token:buffer[offset],length:length,bodyOffset:bodyOffset,end:end}; }

function parseLoginAck(buffer, offset) {
  var header=variableToken(buffer,offset,'LOGINACK'),cursor=header.bodyOffset;need(buffer,cursor,5,'LOGINACK fixed fields');
  var interfaceType=buffer[cursor++],tdsVersion=buffer.readUInt32LE(cursor);cursor+=4;var program=readBVarchar(buffer,cursor);cursor=program.offset;need(buffer,cursor,4,'LOGINACK program version');
  var result=Object.freeze({type:'loginack',token:TOKENS.LOGINACK,interface:interfaceType,tdsVersion:tdsVersion,programName:program.value,programVersion:Object.freeze({major:buffer[cursor],minor:buffer[cursor+1],buildHigh:buffer[cursor+2],buildLow:buffer[cursor+3]}),bytesConsumed:header.end-offset});
  if(cursor+4!==header.end)throw new RangeError('SQL Server LOGINACK length does not match token body');return result;
}
function parseMessage(buffer, offset, kind) {
  var name=kind==='error'?'ERROR':'INFO',header=variableToken(buffer,offset,name),cursor=header.bodyOffset;need(buffer,cursor,6,name+' fixed fields');
  var number=buffer.readUInt32LE(cursor);cursor+=4;var state=buffer[cursor++],severity=buffer[cursor++];var message=readUsVarchar(buffer,cursor);cursor=message.offset;var server=readBVarchar(buffer,cursor);cursor=server.offset;var procedure=readBVarchar(buffer,cursor);cursor=procedure.offset;need(buffer,cursor,4,name+' line number');var lineNumber=buffer.readUInt32LE(cursor);cursor+=4;
  if(cursor!==header.end)throw new RangeError('SQL Server '+name+' length does not match token body');return Object.freeze({type:kind,token:buffer[offset],number:number,state:state,severity:severity,message:message.value,serverName:server.value,procedureName:procedure.value,lineNumber:lineNumber,bytesConsumed:header.end-offset});
}
function readEnvValue(buffer,offset,unicode){need(buffer,offset,1,'ENVCHANGE value length');var length=buffer[offset++],bytes=unicode?length*2:length;need(buffer,offset,bytes,'ENVCHANGE value');var raw=buffer.subarray(offset,offset+bytes);return {value:unicode?raw.toString('utf16le'):raw,raw:raw,offset:offset+bytes};}
function parseEnvChange(buffer,offset){var header=variableToken(buffer,offset,'ENVCHANGE'),cursor=header.bodyOffset;need(buffer,cursor,1,'ENVCHANGE type');var changeType=buffer[cursor++],unicode=changeType!==7,next=readEnvValue(buffer,cursor,unicode);cursor=next.offset;var previous=readEnvValue(buffer,cursor,unicode);cursor=previous.offset;if(cursor!==header.end)throw new RangeError('SQL Server ENVCHANGE length does not match token body');return Object.freeze({type:'envchange',token:TOKENS.ENVCHANGE,changeType:changeType,newValue:next.value,oldValue:previous.value,bytesConsumed:header.end-offset});}
function parseDone(buffer,offset){need(buffer,offset,13,'DONE token');var status=buffer.readUInt16LE(offset+1),currentCommand=buffer.readUInt16LE(offset+3),rowCount=buffer.readBigUInt64LE(offset+5);return Object.freeze({type:buffer[offset]===TOKENS.DONE?'done':(buffer[offset]===TOKENS.DONEPROC?'doneproc':'doneinproc'),token:buffer[offset],status:status,currentCommand:currentCommand,rowCount:rowCount,hasRowCount:(status&DONE_STATUS.COUNT)!==0,more:(status&DONE_STATUS.MORE)!==0,error:(status&(DONE_STATUS.ERROR|DONE_STATUS.SERVER_ERROR))!==0,attention:(status&DONE_STATUS.ATTENTION)!==0,inTransaction:(status&DONE_STATUS.IN_TRANSACTION)!==0,bytesConsumed:13});}
function parseReturnStatus(buffer,offset){need(buffer,offset,5,'RETURNSTATUS token');if(buffer[offset]!==TOKENS.RETURNSTATUS)throw new RangeError('Expected SQL Server RETURNSTATUS token');return Object.freeze({type:'returnstatus',token:TOKENS.RETURNSTATUS,value:buffer.readInt32LE(offset+1),bytesConsumed:5});}

function parseLoginResponse(payload){var buffer=Buffer.from(payload),offset=0,tokens=[],loginAck=null,errors=[],done=null;while(offset<buffer.length){var token=buffer[offset],parsed;if(token===TOKENS.LOGINACK)parsed=parseLoginAck(buffer,offset);else if(token===TOKENS.ERROR)parsed=parseMessage(buffer,offset,'error');else if(token===TOKENS.INFO)parsed=parseMessage(buffer,offset,'info');else if(token===TOKENS.ENVCHANGE)parsed=parseEnvChange(buffer,offset);else if(token===TOKENS.DONE||token===TOKENS.DONEPROC||token===TOKENS.DONEINPROC)parsed=parseDone(buffer,offset);else throw new RangeError('Unsupported SQL Server login-response token 0x'+token.toString(16).padStart(2,'0'));tokens.push(parsed);if(parsed.type==='loginack')loginAck=parsed;if(parsed.type==='error')errors.push(parsed);if(parsed.type==='done'||parsed.type==='doneproc'||parsed.type==='doneinproc')done=parsed;offset+=parsed.bytesConsumed;}return Object.freeze({tokens:Object.freeze(tokens),loginAck:loginAck,errors:Object.freeze(errors),done:done,success:!!loginAck&&errors.length===0&&!!done&&!done.error});}

exports.TOKENS=TOKENS;
exports.DONE_STATUS=DONE_STATUS;
exports.parseLoginAck=parseLoginAck;
exports.parseMessage=parseMessage;
exports.parseEnvChange=parseEnvChange;
exports.parseDone=parseDone;
exports.parseReturnStatus=parseReturnStatus;
exports.parseLoginResponse=parseLoginResponse;
