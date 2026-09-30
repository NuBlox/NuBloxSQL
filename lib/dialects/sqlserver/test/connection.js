'use strict';

var assert = require('assert');
var EventEmitter = require('events');
var Connection = require('../lib/Connection').Connection;
var TdsPacket = require('../lib/TdsPacket');
var Prelogin = require('../lib/Prelogin');
var Login7 = require('../lib/Login7');
var TokenStream = require('../lib/TokenStream');
var ResultStream = require('../lib/ResultStream');

function variableToken(type, body) { var token=Buffer.allocUnsafe(3+body.length);token[0]=type;token.writeUInt16LE(body.length,1);body.copy(token,3);return token; }
function bVarchar(value){return Buffer.concat([Buffer.from([value.length]),Buffer.from(value,'utf16le')]);}
function loginAck(){var version=Buffer.allocUnsafe(4);version.writeUInt32LE(Login7.TDS_74,0);return variableToken(TokenStream.TOKENS.LOGINACK,Buffer.concat([Buffer.from([1]),version,bVarchar('SQL Server'),Buffer.from([17,0,0,1])]));}
function envPacketSize(size){var value=String(size);var body=Buffer.concat([Buffer.from([4,value.length]),Buffer.from(value,'utf16le'),Buffer.from([0])]);return variableToken(TokenStream.TOKENS.ENVCHANGE,body);}
function done(rowCount){var value=Buffer.alloc(13);value[0]=TokenStream.TOKENS.DONE;if(rowCount!==undefined){value.writeUInt16LE(TokenStream.DONE_STATUS.COUNT,1);value.writeBigUInt64LE(BigInt(rowCount),5);}return value;}
function intResult(name,value){
  var encoded=Buffer.from(name,'utf16le');
  var meta=Buffer.alloc(1+2+4+2+1+1+encoded.length),o=0;
  meta[o++]=ResultStream.TOKENS.COLMETADATA;meta.writeUInt16LE(1,o);o+=2;meta.writeUInt32LE(0,o);o+=4;meta.writeUInt16LE(0,o);o+=2;meta[o++]=ResultStream.TYPES.INT4;meta[o++]=name.length;encoded.copy(meta,o);
  var row=Buffer.alloc(5);row[0]=ResultStream.TOKENS.ROW;row.writeInt32LE(value,1);
  return Buffer.concat([meta,row,done(1)]);
}

function FakeSocket(options){EventEmitter.call(this);this.options=options;this.alpnProtocol='tds/8.0';this.destroyed=false;this.writes=[];this.stage=0;this.maxSendFragments=[];}
FakeSocket.prototype=Object.create(EventEmitter.prototype);FakeSocket.prototype.constructor=FakeSocket;
FakeSocket.prototype.setMaxSendFragment=function setMaxSendFragment(size){this.maxSendFragments.push(size);return true;};
FakeSocket.prototype.write=function write(chunk){
  this.writes.push(Buffer.from(chunk));var packet=TdsPacket.decodePacket(chunk),self=this;
  if(this.stage===0){
    assert.strictEqual(packet.type,TdsPacket.PACKET_TYPES.PRELOGIN);assert.strictEqual(Prelogin.decode(packet.payload).encryption,Prelogin.ENCRYPTION.ON);this.stage++;
    var response=TdsPacket.encodePacket({type:TdsPacket.PACKET_TYPES.RESPONSE,payload:Prelogin.encode({version:{major:16,minor:0,build:1000,subbuild:0},encryption:Prelogin.ENCRYPTION.ON,threadId:0,mars:false})});
    process.nextTick(function(){self.emit('data',response.subarray(0,11));self.emit('data',response.subarray(11));});
  } else if(this.stage===1){
    assert.strictEqual(packet.type,TdsPacket.PACKET_TYPES.LOGIN7);assert.ok(packet.payload.length>=Login7.FIXED_LENGTH);this.stage++;
    var loginResponse=TdsPacket.encodePacket({type:TdsPacket.PACKET_TYPES.RESPONSE,payload:Buffer.concat([loginAck(),envPacketSize(8192),done()])});
    process.nextTick(function(){self.emit('data',loginResponse);});
  } else if(this.stage===2){
    assert.strictEqual(packet.type,TdsPacket.PACKET_TYPES.SQL_BATCH);
    assert.strictEqual(packet.payload.readUInt32LE(0),22);
    assert.strictEqual(packet.payload.readUInt32LE(4),18);
    assert.strictEqual(packet.payload.readUInt16LE(8),2);
    assert.strictEqual(packet.payload.readBigUInt64LE(10),0n);
    assert.strictEqual(packet.payload.readUInt32LE(18),1);
    assert.strictEqual(packet.payload.subarray(22).toString('utf16le'),'SELECT 42 AS answer');
    this.stage++;
    var queryResponse=TdsPacket.encodePacket({type:TdsPacket.PACKET_TYPES.RESPONSE,payload:intResult('answer',42)});
    process.nextTick(function(){self.emit('data',queryResponse);});
  }
  return true;
};
FakeSocket.prototype.end=function end(){var self=this;process.nextTick(function(){self.destroyed=true;self.emit('close');});};
FakeSocket.prototype.destroy=function destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('close');};

async function main(){
  var fake;function tlsConnect(options){fake=new FakeSocket(options);process.nextTick(function(){fake.emit('secureConnect');});return fake;}
  var connection=new Connection({host:'sql.example.test',user:'nublox',password:'secret',database:'nublox_ci',rejectUnauthorized:true,connectTimeout:1000},{tlsConnect:tlsConnect});
  await connection.connect();
  assert.strictEqual(connection.connected,true);assert.strictEqual(connection.packetSize,8192);assert.strictEqual(connection.loginResponse.success,true);assert.strictEqual(connection.loginResponse.loginAck.programName,'SQL Server');assert.strictEqual(fake.options.servername,'sql.example.test');assert.deepStrictEqual(fake.options.ALPNProtocols,['tds/8.0']);
  assert.deepStrictEqual(fake.maxSendFragments,[4096,8192]);
  var result=await connection.query('SELECT 42 AS answer',{timeout:1000});
  assert.deepStrictEqual(result.rows,[{answer:42}]);assert.strictEqual(result.rowCount,1n);assert.strictEqual(fake.writes.length,3);
  await connection.end();assert.strictEqual(connection.ended,true);

  function wrongAlpn(options){var socket=new FakeSocket(options);socket.alpnProtocol='http/1.1';process.nextTick(function(){socket.emit('secureConnect');});return socket;}
  var rejected=new Connection({host:'sql.example.test',user:'u',password:'p',connectTimeout:1000},{tlsConnect:wrongAlpn});
  await assert.rejects(function(){return rejected.connect();},/did not negotiate TDS 8.0/);
  console.log('NuBloxSQL SQL Server TDS 8 connection, TLS fragment sizing and SQL batch state machine passed');
}
main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
