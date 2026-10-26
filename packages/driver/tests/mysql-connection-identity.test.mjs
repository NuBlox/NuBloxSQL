import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {validate} from '../dist/vendors/mysql/configuration.js';
import {connectMysql} from '../dist/vendors/mysql/adapter.js';

const baseline={
  engine:'mysql',host:'127.0.0.1',port:3306,
  user:'app_user',password:'secure-password',database:'app_db',
  security:'isolated-local',timeoutMs:1000
};

test('NUL characters never reach MySQL Classic C-string login fields',()=>{
  for(const [key,value] of [
    ['user','root\0ignored'],['user','\0root'],
    ['password','private\0truncated'],['database','main\0alternate'],
    ['host','127.0.0.1\0spoof']
  ]){
    assert.throws(
      ()=>validate({...baseline,[key]:value}),
      error=>error.code==='INVALID_INPUT',
      'reject embedded NUL in '+key
    );
  }
  assert.equal(validate({...baseline,password:''}).password,'');
  assert.equal(validate(baseline).database,'app_db');
});

test('verified TLS rejects blank, NUL and invalid explicit server identities',()=>{
  const target={...baseline,security:'verified-tls'};
  for(const serverName of ['', '   ', 'localhost\0suffix', null, 42]){
    assert.throws(
      ()=>validate({...target,serverName}),
      error=>error.code==='INVALID_INPUT'
    );
  }
  for(const ca of ['', '  ', 'PEM\0malformed', null, 42]){
    assert.throws(()=>validate({...target,ca}),
      error=>error.code==='INVALID_INPUT');
  }
  assert.equal(validate({...target,serverName:'localhost'}).serverName,'localhost');
  assert.equal(validate({...target,serverName:undefined,ca:undefined}).security,'verified-tls');
});

test('invalid connection identities reject before any TCP connection opens',{timeout:3000},async()=>{
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);
    socket.on('close',()=>sockets.delete(socket));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  let accepted=0;
  server.on('connection',()=>{accepted++;});
  const target={...baseline,port:server.address().port};
  try{
    const invalid=[
      {...target,user:'root\0guest'},
      {...target,password:'one\0two'},
      {...target,database:'db\0other'},
      {...target,security:'verified-tls',serverName:''},
      {...target,security:'verified-tls',serverName:'localhost\0evil'},
      {...target,security:'verified-tls',ca:''}
    ];
    const results=await Promise.allSettled(invalid.map(t=>connectMysql(t)));
    assert.ok(results.every(x=>x.status==='rejected'&&x.reason.code==='INVALID_INPUT'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(accepted,0,'no invalid identity should open a transport');
    assert.equal(sockets.size,0);
  }finally{
    for(const socket of sockets)socket.destroy();
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
