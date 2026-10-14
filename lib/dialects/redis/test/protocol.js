'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const sql = require('../../..');
const codec = require('../lib/Resp2');

function checkProtocol() {
  assert.equal(codec.parse(Buffer.from('+PONG\r\n')).value,'PONG');
  assert.equal(codec.parse(Buffer.from('$-1\r\n')).value,null);
  assert.equal(codec.parse(Buffer.from('*-1\r\n')).value,null);
  assert.deepEqual(codec.parse(Buffer.from('*2\r\n$1\r\na\r\n$-1\r\n')).value,
    [Buffer.from('a'),null]);
  assert.equal(codec.parse(Buffer.from(':9223372036854775807\r\n')).value,9223372036854775807n);
  assert.equal(codec.parse(Buffer.from('$4\r\nab')).value,undefined);
  assert.deepEqual(codec.parse(Buffer.from('$2\r\n\x00\xff\r\n','binary')).value,Buffer.from([0,255]));
  assert.deepEqual(codec.encode('GET',[Buffer.from([0,255])]),
    Buffer.from('*2\r\n$3\r\nGET\r\n$2\r\n\x00\xff\r\n','binary'));
  for(const data of ['?abc\r\n','$3\r\nabcXX',':not-a-number\r\n',
    '*99999\r\n', '$999999999\r\n', '+'.repeat(70000)]) {
    assert.throws(()=>codec.parse(Buffer.from(data)),/RESP2/);
  }
  assert.throws(()=>codec.parse(Buffer.from('*1\r\n*1\r\n*1\r\n+OK\r\n'),
    {maxDepth:2}), /nesting/);
  for(const bad of [null,{},[],Infinity,NaN]) {
    assert.throws(()=>codec.encode('GET',[bad]),/Redis arguments/);
  }
  assert.throws(()=>codec.encode('GET',[Buffer.alloc(200)],32),/byte budget/);
  assert.throws(()=>codec.encode('GET FOO',[]),/command name/);
}
function checkConfig() {
  for (const config of [
    {host:'db.example.test'}, {host:'db.example.test',tls:false},
    {host:'127.0.0.1',tls:{rejectUnauthorized:false}},
    {host:'127.0.0.1',tls:true},
    {host:'db.example.test',tls:{unknownSetting:true}},
    {host:'db.example.test',tls:{servername:'127.0.0.1'}},
    {host:'localhost',commandTimeout:0},
    {host:'localhost',maxResponseBytes:16777217},
    {host:'localhost',username:'admin'},
    {host:'localhost',port:70000},
    {host:'localhost',password:123},
    {host:'localhost',foo:'ignored'}
  ]) assert.throws(()=>sql.createNativeConnection('redis',config));
  assert.throws(()=>sql.createNativeConnection('mysql',{}),/Unsupported native non-SQL/);
  assert.throws(()=>sql.createNativeConnection('mongodb',{}),/Unsupported native non-SQL/);
  assert.throws(()=>sql.createClient({dialect:'redis'}),/Unsupported NuBloxSQL dialect/);
  const secured=sql.createNativeConnection('redis',{
    host:'db.example.test',tls:{servername:'redis.example.test'}
  });
  assert.equal(secured.config.host,'db.example.test');
  assert.equal(secured.connected,false);
}
async function withServer(handler,run) {
  const server=net.createServer(socket=>{
    let input=Buffer.alloc(0);
    socket.on('data',chunk=>{
      input=Buffer.concat([input,chunk]);
      try {
        while (input.length) {
          const frame=codec.parse(input);
          if (!frame) break;
          input=input.subarray(frame.bytes);
          handler(socket,frame.value.map(x=>x.toString('utf8')));
        }
      } catch(e){socket.destroy(e);}
    });
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  try {await run(server.address().port);}
  finally {await new Promise(resolve=>server.close(resolve));}
}
async function checkNetwork() {
  const seen=[];
  await withServer((socket,args)=>{
    seen.push(args[0]);
    if(args[0]==='AUTH')socket.write('+OK\r\n');
    else if(args[0]==='SELECT')socket.write('+OK\r\n');
    else if(args[0]==='PING') {
      const bytes=Buffer.from('+PONG\r\n');
      socket.write(bytes.subarray(0,3));
      setTimeout(()=>socket.write(bytes.subarray(3)),2);
    }
    else if(args[0]==='GET')socket.write('$3\r\nabc\r\n');
    else if(args[0]==='SET')socket.write('+OK\r\n');
    else if(args[0]==='DEL')socket.write(':1\r\n');
    else if(args[0]==='EXISTS')socket.write(':0\r\n');
    else if(args[0]==='BAD')socket.write('-WRONGTYPE Operation against wrong type\r\n');
    else if(args[0]==='HANG'){} // Trigger deadline safety.
    else if(args[0]==='OVERSIZE')socket.write('$1000\r\n');
    else socket.write('-ERR unsupported test command\r\n');
  },async port=>{
    const conn=sql.createNativeConnection({
      technology:'redis',host:'127.0.0.1',port,username:'tester',password:'secret',
      database:1,commandTimeout:80,maxResponseBytes:300,maxCommandBytes:256
    });
    await conn.connect();
    assert.equal(conn.connected,true);
    assert.deepEqual(seen.slice(0,2),['AUTH','SELECT']);
    assert.equal(await conn.ping(),'PONG');
    const batch=await Promise.all([conn.set('k','v'),conn.get('k'),conn.del('k'),conn.command('EXISTS','k')]);
    assert.deepEqual(batch,['OK',Buffer.from('abc'),1,0]);
    await assert.rejects(conn.command('BAD'),e=>e.code==='WRONGTYPE');
    assert.equal(await conn.ping(),'PONG','native server errors are recoverable');
    await assert.rejects(conn.command('OVERSIZE'),/byte budget/);
    assert.equal(conn.ended,true,'malformed or oversized response must close connection');
    await assert.rejects(conn.ping(),/not ready/);
    await conn.close();
  });
  await withServer((socket,args)=>{
    if (args[0]==='HANG')return;
    socket.write('+PONG\r\n');
  },async port=>{
    const conn=sql.createNativeConnection('redis',{host:'127.0.0.1',port,commandTimeout:30});
    await conn.connect();
    await assert.rejects(conn.command('HANG'),/timed out/);
    assert.equal(conn.ended,true);
    await conn.end();
  });
  await withServer((socket,args)=>{
    if(args[0]==='AUTH') socket.write('-WRONGPASS invalid username-password pair\r\n');
  },async port=>{
    const conn=sql.createNativeConnection('redis',{host:'127.0.0.1',port,password:'TOP_SECRET'});
    await assert.rejects(conn.connect(),error=>{
      assert.equal(error.message,'Redis authentication failed');
      assert.ok(!error.message.includes('TOP_SECRET'));
      return true;
    });
    assert.equal(conn.ended,true);
  });
}
async function main() {
  checkProtocol();
  checkConfig();
  await checkNetwork();
  console.log('Redis native RESP2 protocol and connection contracts: PASS');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
