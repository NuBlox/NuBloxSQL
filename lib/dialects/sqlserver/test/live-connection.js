'use strict';

var assert = require('assert');
var fs = require('fs');
var net = require('net');
var sqlserver = require('..');
var nublox = require('../../../..');

function sleep(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
function probeTcp(host,port,timeoutMs){return new Promise(function(resolve){var socket=net.connect({host:host,port:port}),settled=false;function finish(ok){if(settled)return;settled=true;socket.removeAllListeners();socket.destroy();resolve(ok);}socket.setTimeout(timeoutMs,function(){finish(false);});socket.once('connect',function(){finish(true);});socket.once('error',function(){finish(false);});});}
async function waitForServer(host,port){for(var attempt=1;attempt<=90;attempt++){if(await probeTcp(host,port,1000))return;await sleep(1000);}throw new Error('SQL Server did not begin listening on '+host+':'+port+' within 90 seconds');}
async function connectWithRetry(config){var lastError;for(var attempt=1;attempt<=3;attempt++){var connection=sqlserver.createConnection(config);try{await connection.connect();return connection;}catch(error){lastError=error;try{await connection.end();}catch(_){}if(attempt<3)await sleep(1000);}}throw lastError;}

async function main(){
  var password=process.env.MSSQL_SA_PASSWORD,caPath=process.env.MSSQL_CA_PATH;if(!password)throw new Error('MSSQL_SA_PASSWORD is required');if(!caPath)throw new Error('MSSQL_CA_PATH is required');
  var host=process.env.MSSQL_HOST||'127.0.0.1',serverName=process.env.MSSQL_SERVER_NAME||host,port=Number(process.env.MSSQL_PORT||1433),ca=fs.readFileSync(caPath);
  var config={host:host,port:port,user:'sa',password:password,database:'master',connectTimeout:5000,queryTimeout:5000,cancelTimeout:5000,serverName:serverName,ca:ca,rejectUnauthorized:true};
  await waitForServer(host,port);

  var connection=await connectWithRetry(config);
  try {
    assert.strictEqual(connection.connected,true);assert.ok(connection.serverPrelogin);assert.ok(connection.loginResponse);assert.strictEqual(connection.loginResponse.success,true);assert.ok(connection.loginResponse.loginAck);assert.ok(connection.packetSize>=512);
    var result=await connection.query('SELECT CAST(42 AS int) AS answer');assert.strictEqual(result.success,true);assert.strictEqual(result.rows[0].answer,42);
    var parameterized=await connection.queryParameters('SELECT @p1 AS id, @p2 AS name, @p3 AS enabled',[84,'NuBloxSQL',true]);assert.strictEqual(parameterized.rows[0].id,84);assert.strictEqual(parameterized.rows[0].name,'NuBloxSQL');assert.strictEqual(parameterized.rows[0].enabled,true);
    var nativePrepared=connection.prepare('SELECT @p1 AS id, @p2 AS name');
    assert.strictEqual(nativePrepared.handle,null);
    var nativeFirst=await nativePrepared.execute([85,'prepared-one']);assert.strictEqual(nativeFirst.rows[0].id,85);assert.strictEqual(nativeFirst.rows[0].name,'prepared-one');assert.ok(Number.isInteger(nativePrepared.handle)&&nativePrepared.handle>0);
    var nativeHandle=nativePrepared.handle;
    var nativeSecond=await nativePrepared.execute([86,'prepared-two']);assert.strictEqual(nativeSecond.rows[0].id,86);assert.strictEqual(nativeSecond.rows[0].name,'prepared-two');assert.strictEqual(nativePrepared.handle,nativeHandle);
    await nativePrepared.close();assert.strictEqual(nativePrepared.closed,true);assert.strictEqual(nativePrepared.handle,null);
  } finally { await connection.end(); }

  var client=nublox.createClient(Object.assign({dialect:'sqlserver',pool:false},config));
  try {
    var row=await client.one(nublox.sql`SELECT ${126} AS id, ${'public-client'} AS name, ${true} AS enabled`);assert.strictEqual(row.id,126);assert.strictEqual(row.name,'public-client');assert.strictEqual(row.enabled,true);assert.strictEqual(client.dialect,'sqlserver');
    assert.strictEqual(client.supports('transactions'),true);assert.strictEqual(client.supports('savepoints'),true);assert.strictEqual(client.supports('nestedTransactions'),true);assert.strictEqual(client.supports('transactionIsolation'),true);assert.strictEqual(client.supports('readOnlyTransactions'),false);assert.strictEqual(client.supports('queryCancellation'),true);assert.strictEqual(client.supports('preparedStatements'),true);
    await client.query('IF OBJECT_ID(\'tempdb..#nublox_tx\') IS NOT NULL DROP TABLE #nublox_tx; CREATE TABLE #nublox_tx(id int NOT NULL)');
    await client.transaction(async function(tx){assert.notStrictEqual(tx.native.transactionDescriptor,0n);await tx.execute(nublox.sql`INSERT INTO #nublox_tx(id) VALUES (${1})`);try{await tx.transaction(async function(nested){await nested.execute(nublox.sql`INSERT INTO #nublox_tx(id) VALUES (${2})`);throw new Error('rollback nested');});assert.fail('nested transaction should throw');}catch(error){assert.strictEqual(error.message,'rollback nested');}var inside=await tx.all('SELECT id FROM #nublox_tx ORDER BY id');assert.deepStrictEqual(inside.map(function(r){return r.id;}),[1]);},{isolationLevel:'serializable'});
    assert.strictEqual(client.native.transactionDescriptor,0n);var committed=await client.all('SELECT id FROM #nublox_tx ORDER BY id');assert.deepStrictEqual(committed.map(function(r){return r.id;}),[1]);
    try{await client.transaction(async function(tx){await tx.execute(nublox.sql`INSERT INTO #nublox_tx(id) VALUES (${3})`);throw new Error('rollback outer');});assert.fail('outer transaction should throw');}catch(error){assert.strictEqual(error.message,'rollback outer');}
    var rolledBack=await client.all('SELECT id FROM #nublox_tx ORDER BY id');assert.deepStrictEqual(rolledBack.map(function(r){return r.id;}),[1]);await client.query('DROP TABLE #nublox_tx');await assert.rejects(function(){return client.transaction(async function(){},{readOnly:true});},/read-only/);
  } finally { await client.close(); }

  var pooled=nublox.createClient(Object.assign({dialect:'sqlserver',pool:{max:1,acquireTimeout:2000,idleTimeout:5000}},config));
  try {
    assert.strictEqual(pooled.native.connectionLimit,1);
    var pooledRow=await pooled.one('SELECT CAST(200 AS int) AS value');assert.strictEqual(pooledRow.value,200);assert.strictEqual(pooled.native.totalCount,1);assert.strictEqual(pooled.native.idleCount,1);
    var statement=await pooled.prepare(nublox.sql`SELECT ${nublox.sql.parameter('id')} AS id, ${nublox.sql.parameter('name')} AS name`);
    assert.strictEqual(pooled.native.borrowedCount,1);assert.strictEqual(pooled.native.idleCount,0);
    var preparedOne=await statement.one({id:301,name:'pooled-one'});assert.strictEqual(preparedOne.id,301);assert.strictEqual(preparedOne.name,'pooled-one');
    var preparedTwo=await statement.one({id:302,name:'pooled-two'});assert.strictEqual(preparedTwo.id,302);assert.strictEqual(preparedTwo.name,'pooled-two');
    await statement.close();assert.strictEqual(pooled.native.borrowedCount,0);assert.strictEqual(pooled.native.idleCount,1);
    await assert.rejects(function(){return pooled.query("WAITFOR DELAY '00:00:05'; SELECT CAST(1 AS int) AS value",{timeout:150});},function(error){return error&&error.category==='timeout';});
    var afterTimeout=await pooled.one('SELECT CAST(201 AS int) AS value');assert.strictEqual(afterTimeout.value,201);assert.strictEqual(pooled.native.totalCount,1);assert.strictEqual(pooled.native.idleCount,1);
    var controller=new AbortController();setTimeout(function(){controller.abort(new Error('cancel live SQL Server query'));},150);
    await assert.rejects(function(){return pooled.query("WAITFOR DELAY '00:00:05'; SELECT CAST(2 AS int) AS value",{signal:controller.signal,timeout:5000});},function(error){return error&&error.category==='cancelled';});
    var afterCancel=await pooled.one('SELECT CAST(202 AS int) AS value');assert.strictEqual(afterCancel.value,202);assert.strictEqual(pooled.native.totalCount,1);assert.strictEqual(pooled.native.idleCount,1);
    await pooled.transaction(async function(tx){await tx.one('SELECT CAST(203 AS int) AS value');});assert.strictEqual(pooled.native.borrowedCount,0);assert.strictEqual(pooled.native.waitingCount,0);
  } finally { await pooled.close(); }

  console.log('NuBloxSQL live SQL Server TDS 8, RPC, prepared statements, transactions, pooling and ATTENTION cancellation passed');
}
main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});
