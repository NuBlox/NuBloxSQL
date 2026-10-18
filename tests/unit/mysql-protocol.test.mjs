import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 MYSQL_CAPABILITIES as C,MysqlPacketDecoder,encodeMysqlPacket,
 parseMysqlHandshake,mysqlPasswordToken,createMysqlSslRequest,
 createMysqlHandshakeResponse,createMysqlFullAuthPassword
} from '../../packages/driver/dist/adapters/mysql/protocol.js';

function greeting({plugin='caching_sha2_password',tls=true,legacy=false}={}){
 const cap=C.LONG_PASSWORD|C.LONG_FLAG|C.CONNECT_WITH_DB|C.PROTOCOL_41|
  C.SECURE_CONNECTION|C.PLUGIN_AUTH|C.TRANSACTIONS|(tls?C.SSL:0);
 const flags=legacy?cap&~C.PROTOCOL_41:cap;
 const lower=Buffer.alloc(2),upper=Buffer.alloc(2),id=Buffer.alloc(4),status=Buffer.alloc(2);
 lower.writeUInt16LE(flags&65535);upper.writeUInt16LE(flags>>>16);id.writeUInt32LE(71);status.writeUInt16LE(2);
 return Buffer.concat([
  Buffer.from([10]),Buffer.from('8.4.0-fixture\0'),id,
  Buffer.from('12345678'),Buffer.from([0]),lower,
  Buffer.from([45]),status,upper,Buffer.from([21]),Buffer.alloc(10),
  Buffer.from('abcdefghijkl\0'),Buffer.from(plugin+'\0')
 ]);
}
test('native MySQL packet decoder reconstructs TCP fragments and validates sequence',()=>{
 const first=encodeMysqlPacket(Buffer.from('hello'),0);
 const second=encodeMysqlPacket(Buffer.from('world'),1);
 const decoder=new MysqlPacketDecoder(1024);
 assert.deepEqual(decoder.push(first.subarray(0,2)),[]);
 assert.deepEqual(decoder.push(first.subarray(2,4)),[]);
 const records=decoder.push(Buffer.concat([first.subarray(4),second]));
 assert.equal(records.length,2);
 assert.equal(records[0].payload.toString(),'hello');
 assert.equal(records[1].sequenceId,1);
 assert.equal(records[1].payload.toString(),'world');
 decoder.resetSequence(1); // new server response after a client command
 assert.equal(decoder.push(encodeMysqlPacket(Buffer.from('ok'),1))[0].payload.toString(),'ok');
});
test('MySQL decoder refuses oversized, out-of-order, incomplete and poisoned frames',()=>{
 assert.throws(()=>encodeMysqlPacket(Buffer.alloc(12),0,10),RangeError);
 assert.throws(()=>encodeMysqlPacket(Buffer.alloc(1),256),RangeError);
 const bad=new MysqlPacketDecoder(8);
 const oversized=Buffer.from([9,0,0,0]);
 assert.throws(()=>bad.push(oversized),/exceeds configured limit/);
 assert.throws(()=>bad.push(Buffer.alloc(0)),/permanently invalid/);
 const wrong=new MysqlPacketDecoder(8);
 assert.throws(()=>wrong.push(encodeMysqlPacket(Buffer.from('x'),7,8)),/sequence/);
 assert.throws(()=>wrong.resetSequence(0),/incomplete or failed/);
 const partial=new MysqlPacketDecoder(8);
 partial.push(Buffer.from([5,0,0,0,1]));
 assert.throws(()=>partial.resetSequence(1),/incomplete or failed/);
 assert.throws(()=>new MysqlPacketDecoder(0),RangeError);
});
test('native MySQL 8.4-style greeting parses complete plugin and seed without truncation',()=>{
 const greet=parseMysqlHandshake(greeting());
 assert.equal(greet.protocolVersion,10);
 assert.equal(greet.serverVersion,'8.4.0-fixture');
 assert.equal(greet.connectionId,71);
 assert.equal(greet.authPluginName,'caching_sha2_password');
 assert.equal(greet.scramble.toString(),'12345678abcdefghijkl');
 assert.ok((greet.capabilityFlags&C.SSL)!==0);
});
test('MySQL handshake rejects legacy, truncated, unknown plugin and protocol downgrade',()=>{
 assert.throws(()=>parseMysqlHandshake(greeting({legacy:true})),/capabilities/);
 assert.throws(()=>parseMysqlHandshake(greeting({plugin:'not_an_auth_plugin'})),/authentication plugin/);
 assert.throws(()=>parseMysqlHandshake(greeting().subarray(0,35)),/handshake|scramble/);
 const invalid=Buffer.from(greeting());invalid[0]=9;
 assert.throws(()=>parseMysqlHandshake(invalid),/Unsupported/);
 const extra=Buffer.concat([greeting(),Buffer.from([42])]);
 assert.throws(()=>parseMysqlHandshake(extra),/trailing bytes/);
});
test('MySQL SSLRequest and handshake response use minimum privileges, never LOCAL INFILE or multi-statements',()=>{
 const greet=parseMysqlHandshake(greeting());
 const ssl=createMysqlSslRequest(greet);
 assert.equal(ssl.length,32);
 assert.equal(ssl[8],45);
 assert.ok(ssl.subarray(9).every(x=>x===0));
 assert.ok((ssl.readUInt32LE(0)&C.SSL)!==0);
 assert.equal(ssl.readUInt32LE(0)&C.LOCAL_FILES,0);
 assert.equal(ssl.readUInt32LE(0)&C.MULTI_STATEMENTS,0);
 const response=createMysqlHandshakeResponse(greet,{
  user:'tester',password:'secret',database:'demo',verifiedTls:true
 });
 assert.ok((response.readUInt32LE(0)&C.SSL)!==0);
 assert.ok((response.readUInt32LE(0)&C.CONNECT_WITH_DB)!==0);
 assert.ok(response.includes(Buffer.from('tester\0')));
 assert.ok(response.includes(Buffer.from('demo\0')));
 assert.ok(!response.includes(Buffer.from('secret')));
 assert.throws(()=>createMysqlSslRequest(parseMysqlHandshake(greeting({tls:false}))),/TLS/);
 assert.throws(()=>createMysqlHandshakeResponse(greet,{
  user:'tester',password:'secret',verifiedTls:false
 }),/TLS or an explicit loopback/);
 assert.throws(()=>createMysqlHandshakeResponse(greet,{
  user:'tester',password:'secret',verifiedTls:true,isolatedLoopback:true
 }),/TLS or an explicit loopback/);
 const local=createMysqlHandshakeResponse(parseMysqlHandshake(greeting({tls:false})),{
  user:'tester',password:'secret',isolatedLoopback:true,verifiedTls:false
 });
 assert.equal(local.readUInt32LE(0)&C.SSL,0);
});
test('MySQL caching SHA-2 and native-password scramble implementations remain distinct',()=>{
 for(const plugin of ['caching_sha2_password','mysql_native_password']){
  const g=parseMysqlHandshake(greeting({plugin}));
  const a=mysqlPasswordToken(g,'correct horse battery staple');
  const b=mysqlPasswordToken(g,'correct horse battery staple');
  assert.equal(a.length,plugin==='caching_sha2_password'?32:20);
  assert.deepEqual(a,b);
  assert.notDeepEqual(a,mysqlPasswordToken(g,'wrong password'));
  assert.equal(mysqlPasswordToken(g,'').length,0);
 }
 assert.throws(()=>mysqlPasswordToken(parseMysqlHandshake(greeting()),'bad\0value'),TypeError);
});
test('MySQL full authentication never sends a cleartext password without verified TLS',()=>{
 assert.throws(()=>createMysqlFullAuthPassword('secret',false),/Refusing unverified/);
 assert.deepEqual(createMysqlFullAuthPassword('secret',true),Buffer.from('secret\0'));
 assert.throws(()=>createMysqlFullAuthPassword('no\0',true),/Refusing unverified/);
});
