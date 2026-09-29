'use strict';

var assert=require('assert');
var EventEmitter=require('events');
var TdsPacket=require('../lib/TdsPacket');
var LegacyTlsBridge=require('../lib/LegacyTlsBridge').LegacyTlsBridge;

function FakeSocket(){EventEmitter.call(this);this.writes=[];this.destroyed=false;}
FakeSocket.prototype=Object.create(EventEmitter.prototype);FakeSocket.prototype.constructor=FakeSocket;
FakeSocket.prototype.write=function write(chunk){this.writes.push(Buffer.from(chunk));return true;};
FakeSocket.prototype.end=function end(callback){if(callback)callback();};
FakeSocket.prototype.destroy=function destroy(){this.destroyed=true;};

async function write(bridge,value){await new Promise(function(resolve,reject){bridge.write(value,function(error){if(error)reject(error);else resolve();});});}
async function main(){
  var raw=new FakeSocket();
  var bridge=new LegacyTlsBridge(raw,{packetSize:512});
  var received=[];bridge.on('data',function(chunk){received.push(Buffer.from(chunk));});

  var clientHello=Buffer.alloc(900,0x16);
  await write(bridge,clientHello);
  assert.ok(raw.writes.length>=2);
  var sent=[];raw.writes.forEach(function(packetBytes){var packet=TdsPacket.decodePacket(packetBytes);assert.strictEqual(packet.type,TdsPacket.PACKET_TYPES.PRELOGIN);sent.push(packet.payload);});
  assert.deepStrictEqual(Buffer.concat(sent),clientHello);

  var serverHello=Buffer.alloc(700,0x17);
  TdsPacket.packetize(TdsPacket.PACKET_TYPES.PRELOGIN,serverHello,{packetSize:512}).forEach(function(packet){raw.emit('data',packet);});
  assert.deepStrictEqual(Buffer.concat(received),serverHello);

  bridge.activateRaw();
  raw.writes.length=0;received.length=0;
  var encryptedApplication=Buffer.from('encrypted-tds-application-record');
  await write(bridge,encryptedApplication);
  assert.strictEqual(raw.writes.length,1);
  assert.deepStrictEqual(raw.writes[0],encryptedApplication);
  raw.emit('data',Buffer.from('server-encrypted-record'));
  assert.deepStrictEqual(Buffer.concat(received),Buffer.from('server-encrypted-record'));

  assert.throws(function(){
    var partial=new LegacyTlsBridge(new FakeSocket());
    partial.parser.push(Buffer.from([TdsPacket.PACKET_TYPES.PRELOGIN,1,0]));
    partial.activateRaw();
  },/partial TDS packet/);

  bridge.destroy();
  console.log('NuBloxSQL SQL Server TDS 7.4 TLS bridge contract passed');
}
main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
