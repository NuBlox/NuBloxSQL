'use strict';

const assert=require('node:assert/strict');
const sql=require('../../../..');
const {MongoNativeConnection,validateConfig,clientOptions,connectionUri}
  =require('../lib/Connection');

function mockDriver(overrides = {}) {
  const calls=[];
  class MongoClient {
    constructor(uri,options) {
      calls.push(['construct',uri,options]);
      if (overrides.constructorFailure) throw Error('password: TOP_SECRET');
    }
    async connect() {
      calls.push(['connect']);
      if (overrides.connectGate) await overrides.connectGate;
      if (overrides.connectFailure) throw Error('password: TOP_SECRET');
    }
    db(name) {
      calls.push(['database',name]);
      return {
        async command(doc,options) {
          calls.push(['adminCommand',doc,options]);
          if (overrides.pingFailure) throw Error('secret: TOP_SECRET');
          return {ok:overrides.pingBadResult ? 0 : 1};
        },
        collection:collection=>{
        calls.push(['collection',collection]);
        const docs=[{id:1},{id:2}];
        return {
          async findOne(filter,options) {calls.push(['findOne',filter,options]);return {id:1};},
          find(filter,options) {
            calls.push(['find',filter,options]);
            return {
              async toArray() {
                if (overrides.findFailure) throw Error('password: TOP_SECRET');
                return docs;
              },
              async *[Symbol.asyncIterator]() {
                for (const doc of docs) {
                  if (overrides.iterationFailure) throw Error('password: TOP_SECRET');
                  yield doc;
                }
              },
              async close() {
                calls.push(['cursor.close']);
                if (overrides.closeCursorFailure) throw Error('password: TOP_SECRET');
              }
            };
          },
          async insertOne(doc,opts) {
            calls.push(['insertOne',doc,opts]);
            return {acknowledged:true,insertedId:'inserted'};
          },
          async updateOne(filter,update,opts) {
            calls.push(['updateOne',filter,update,opts]);
            return {matchedCount:1,modifiedCount:1};
          },
          async deleteOne(filter,opts) {
            calls.push(['deleteOne',filter,opts]);
            return {deletedCount:1};
          },
          async countDocuments(filter,opts) {
            calls.push(['countDocuments',filter,opts]);return 2;
          }
        };
      }};
    }
    async close() {calls.push(['close']);}
  }
  return {MongoClient,calls};
}

async function main() {
  const pkg=require('../../../..');
  assert.equal(pkg.databaseTechnologyRegistry.get('mongodb').runtime.adapter,'mongodb');
  assert.deepEqual(pkg.databaseTechnologyRegistry.inspect('mongodb').executableOperations,
    ['document.read','document.write']);
  assert.ok(pkg.databaseTechnologyRegistry.validate().valid);
  assert.throws(()=>pkg.createConnection({dialect:'mongodb'}),/Unsupported NuBloxSQL dialect/);
  assert.throws(()=>pkg.createNativeConnection('neo4j',{}),/Unsupported native non-SQL/);
  assert.ok(pkg.createNativeConnection('mongodb',{database:'test'}) instanceof MongoNativeConnection);
  assert.ok(pkg.createNativeConnection({technology:'mongodb',database:'test'}) instanceof MongoNativeConnection);
  for(const bad of [
    {database:'test',host:'db.example.test'},
    {database:'test',host:'mongodb://db.example.test'},
    {database:'test',host:'db.example.test',tls:false},
    {database:'test',tls:'insecure'},
    {database:'test',password:'secret'},
    {database:'test',username:'u'},
    {database:'test',port:65536},
    {database:'test',commandTimeout:0},
    {database:'test',maxResults:1001},
    {database:'test',tlsCAFile:'/dev/null'},
    {database:'test',tlsInsecure:true},
    {database:'test',tlsAllowInvalidCertificates:true},
    {database:'test',uri:'mongodb://admin:secret@localhost'},
    {database:'test',foo:true},
    {database:''},
    {}
  ]) assert.throws(()=>validateConfig(bad), 'unsafe config must fail before network');

  // Topology hostlists must be bounded, unambiguous and fail closed
  // before any MongoClient is allocated.
  for (const config of [
    {database:'test',srvHost:'cluster.example.test',tls:false},
    {database:'test',srvHost:'127.0.0.1'},
    {database:'test',srvHost:'localhost'},
    {database:'test',srvHost:'cluster.example.test',host:'127.0.0.1'},
    {database:'test',srvHost:'cluster.example.test',port:27017},
    {database:'test',srvHost:'cluster.example.test',seeds:[{host:'localhost'}]},
    {database:'test',seeds:[]},
    {database:'test',seeds:[{host:'127.0.0.1'}]},
    {database:'test',seeds:[{host:'127.0.0.1',port:27017}],replicaSet:'rs0',port:27017},
    {database:'test',seeds:[{host:'127.0.0.1'},{host:'127.0.0.1',port:27017}],replicaSet:'rs0'},
    {database:'test',seeds:[{host:'127.0.0.1',password:'p'}],replicaSet:'rs0'},
    {database:'test',seeds:[{host:'db.example.test'}],replicaSet:'rs0'},
    {database:'test',seeds:[{host:'127.0.0.1'}],replicaSet:'rs0?authSource=admin'},
    {database:'test',replicaSet:'rs0&tls=false'},
    {database:'test',replicaSet:'bad name'}
  ]) assert.throws(()=>validateConfig(config), 'unsafe topology must fail before networking');

  const replica=validateConfig({
    database:'warehouse',replicaSet:'rs42',
    seeds:[{host:'db-1.example.test',port:27017},{host:'db-2.example.test',port:27018}],
    tls:true
  });
  assert.equal(connectionUri(replica),
    'mongodb://db-1.example.test:27017,db-2.example.test:27018/');
  assert.equal(clientOptions(replica).directConnection,false);
  assert.equal(clientOptions(replica).replicaSet,'rs42');
  assert.equal(clientOptions(replica).tls,true);
  assert.equal(Object.isFrozen(replica.seeds),true);
  assert.equal(Object.isFrozen(replica.seeds[0]),true);
  const dns=validateConfig({database:'warehouse',srvHost:'cluster.example.test'});
  assert.equal(dns.tls,true,'SRV TLS cannot be disabled');
  assert.equal(connectionUri(dns),'mongodb+srv://cluster.example.test/');
  assert.equal(clientOptions(dns).directConnection,false);
  assert.equal(clientOptions(dns).tls,true);
  const ipv6=validateConfig({database:'warehouse',host:'::1'});
  assert.equal(connectionUri(ipv6),'mongodb://[::1]:27017/');
  const singleReplica=validateConfig({database:'warehouse',replicaSet:'rs0'});
  assert.equal(clientOptions(singleReplica).directConnection,false);

  const fakeTopology=mockDriver();
  const replicaConn=new MongoNativeConnection(replica,{MongoClient:fakeTopology.MongoClient});
  await replicaConn.connect();
  assert.equal(fakeTopology.calls[0][1],connectionUri(replica));
  assert.equal(fakeTopology.calls[0][2].replicaSet,'rs42');
  await replicaConn.close();
  const fakeSrv=mockDriver();
  const srvConn=new MongoNativeConnection(dns,{MongoClient:fakeSrv.MongoClient});
  await srvConn.connect();
  assert.equal(fakeSrv.calls[0][1],'mongodb+srv://cluster.example.test/');
  assert.equal(fakeSrv.calls[0][2].tls,true);
  await srvConn.close();

  const secure=validateConfig({
    database:'warehouse',host:'db.example.test',tls:true,
    username:'reader',password:'TOP_SECRET',authSource:'admin',tlsCAFile:'/trusted/ca.pem'
  });
  const opts=clientOptions(secure);
  assert.equal(opts.tls,true);
  assert.equal(opts.auth.password,'TOP_SECRET');
  assert.equal(opts.authSource,'admin');
  assert.equal(opts.tlsCAFile,'/trusted/ca.pem');
  assert.equal(opts.retryWrites,false);
  assert.equal(opts.retryReads,true);
  assert.equal(opts.directConnection,true);
  assert.equal(opts.tlsAllowInvalidCertificates,undefined);
  assert.equal(opts.tlsAllowInvalidHostnames,undefined);
  assert.equal(opts.tlsInsecure,undefined);

  const fake=mockDriver();
  const connection=new MongoNativeConnection({
    database:'warehouse',username:'reader',password:'TOP_SECRET'
  },{MongoClient:fake.MongoClient});
  await connection.connect();
  assert.strictEqual(await connection.connect(),connection);
  assert.equal(connection.connected,true);
  assert.equal(await connection.ping(),true);
  assert.deepEqual(fake.calls.find(x=>x[0]==='adminCommand').slice(1),
    [{ping:1},{maxTimeMS:10000}]);
  assert.equal(fake.calls[0][1],'mongodb://127.0.0.1:27017/');
  assert.ok(!fake.calls[0][1].includes('TOP_SECRET'));
  assert.deepEqual(await connection.findOne('events',{id:1}),{id:1});
  assert.deepEqual(await connection.find('events',{id:1},{limit:2,batchSize:1}),[{id:1},{id:2}]);
  assert.equal(fake.calls.find(c=>c[0]==='find')[2].limit,2);
  assert.equal(fake.calls.find(c=>c[0]==='find')[2].maxTimeMS,10000);
  assert.equal(fake.calls.filter(c=>c[0]==='cursor.close').length,1);
  const streamed=[];
  for await (const doc of connection.iterate('events',{}, {limit:2,batchSize:1})) {
    streamed.push(doc);
    break;
  }
  assert.deepEqual(streamed,[{id:1}]);
  assert.equal(fake.calls.filter(c=>c[0]==='cursor.close').length,2,
    'early cursor exit releases server cursor');
  assert.equal((await connection.insertOne('events',{id:3})).insertedId,'inserted');
  assert.equal((await connection.updateOne('events',{id:3},{$set:{name:'ok'}})).matchedCount,1);
  assert.equal((await connection.deleteOne('events',{id:3})).deletedCount,1);
  assert.equal(await connection.countDocuments('events'),2);
  for(const invalid of [
    () => connection.find('events',{}, {limit:9999}),
    () => connection.find('events',{}, {sort:{id:1}}),
    () => connection.find('events',[]),
    () => connection.insertOne('events',[]),
    () => connection.findOne(''),
    () => connection.findOne('$system')
  ]) await assert.rejects(async()=>invalid());
  await connection.close();
  await connection.end();
  assert.equal(fake.calls.filter(c=>c[0]==='close').length,1);
  assert.equal(connection.ended,true);
  await assert.rejects(()=>connection.findOne('events'),/NOT_CONNECTED/);
  await assert.rejects(()=>connection.connect(),/CLOSED/);

  for(const flags of [{connectFailure:true},{constructorFailure:true}]) {
    const badFake=mockDriver(flags);
    const db=new MongoNativeConnection({database:'warehouse',username:'reader',password:'TOP_SECRET'},
      {MongoClient:badFake.MongoClient});
    await assert.rejects(()=>db.connect(),error=>{
      assert.equal(error.code,'NUBLOX_MONGODB_CONNECT_FAILED');
      assert.ok(!error.message.includes('TOP_SECRET'));
      return true;
    });
    assert.equal(db.ended,true);
  }
  for (const failedPing of [{pingFailure:true},{pingBadResult:true}]) {
    const fakePing=mockDriver(failedPing);
    const db=new MongoNativeConnection({database:'warehouse',username:'reader',
      password:'TOP_SECRET'},{MongoClient:fakePing.MongoClient});
    await db.connect();
    await assert.rejects(db.ping(),error=>
      error.code==='NUBLOX_MONGODB_PING_FAILED'&&!error.message.includes('TOP_SECRET'));
    assert.equal(db.connected,true,'failed health checks do not mark the pool as closed');
    await db.close();
  }
  const neverConnected=new MongoNativeConnection({database:'warehouse'},
    {MongoClient:mockDriver().MongoClient});
  await assert.rejects(neverConnected.ping(),error=>
    error.code==='NUBLOX_MONGODB_NOT_CONNECTED');

  const failing=mockDriver({findFailure:true});
  const faulty=new MongoNativeConnection({database:'warehouse'},{MongoClient:failing.MongoClient});
  await faulty.connect();
  await assert.rejects(()=>faulty.find('events'),error=>
    error.code==='NUBLOX_MONGODB_FIND_FAILED'&&!error.message.includes('TOP_SECRET'));
  assert.equal(failing.calls.filter(c=>c[0]==='cursor.close').length,1,
    'find failure always closes cursor');
  await faulty.close();

  const iteratorFake=mockDriver({iterationFailure:true});
  const iteratorConnection=new MongoNativeConnection({database:'warehouse'},
    {MongoClient:iteratorFake.MongoClient});
  await iteratorConnection.connect();
  await assert.rejects(async()=>{
    for await (const _ of iteratorConnection.iterate('events')) {}
  },error=>error.code==='NUBLOX_MONGODB_ITERATE_FAILED' &&
    !error.message.includes('TOP_SECRET'));
  assert.equal(iteratorFake.calls.filter(c=>c[0]==='cursor.close').length,1);
  await iteratorConnection.close();

  const closingFake=mockDriver({closeCursorFailure:true});
  const closingConnection=new MongoNativeConnection({database:'warehouse'},
    {MongoClient:closingFake.MongoClient});
  await closingConnection.connect();
  await assert.rejects(()=>closingConnection.find('events'),error=>
    error.code==='NUBLOX_MONGODB_CURSOR_CLOSE_FAILED');
  await closingConnection.close();

  let releaseConnect;
  const pendingConnect=new Promise(resolve=>{releaseConnect=resolve;});
  const racingFake=mockDriver({connectGate:pendingConnect});
  const racing=new MongoNativeConnection({database:'warehouse'},
    {MongoClient:racingFake.MongoClient});
  const connecting=racing.connect();
  const closing=racing.close();
  releaseConnect();
  await assert.rejects(connecting,error=>error.code==='NUBLOX_MONGODB_CONNECT_FAILED');
  await closing;
  assert.equal(racing.ended,true);
  assert.equal(racingFake.calls.filter(c=>c[0]==='close').length,1,
    'concurrent close during connection must release client exactly once');

  console.log('MongoDB native document adapter offline contract: PASS');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
