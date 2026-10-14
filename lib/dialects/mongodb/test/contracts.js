'use strict';

const assert=require('node:assert/strict');
const sql=require('../../../..');
const {MongoNativeConnection,validateConfig,clientOptions}
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
      if (overrides.connectFailure) throw Error('password: TOP_SECRET');
    }
    db(name) {
      calls.push(['database',name]);
      return {collection:collection=>{
        calls.push(['collection',collection]);
        const docs=[{id:1},{id:2}];
        return {
          async findOne(filter,options) {calls.push(['findOne',filter,options]);return {id:1};},
          find(filter,options) {
            calls.push(['find',filter,options]);
            return {async toArray() {
              if (overrides.findFailure) throw Error('password: TOP_SECRET');
              return docs;
            }};
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
  assert.equal(fake.calls[0][1],'mongodb://127.0.0.1:27017/');
  assert.ok(!fake.calls[0][1].includes('TOP_SECRET'));
  assert.deepEqual(await connection.findOne('events',{id:1}),{id:1});
  assert.deepEqual(await connection.find('events',{id:1},{limit:2,batchSize:1}),[{id:1},{id:2}]);
  assert.equal(fake.calls.find(c=>c[0]==='find')[2].limit,2);
  assert.equal(fake.calls.find(c=>c[0]==='find')[2].maxTimeMS,10000);
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
  const failing=mockDriver({findFailure:true});
  const faulty=new MongoNativeConnection({database:'warehouse'},{MongoClient:failing.MongoClient});
  await faulty.connect();
  await assert.rejects(()=>faulty.find('events'),error=>
    error.code==='NUBLOX_MONGODB_FIND_FAILED'&&!error.message.includes('TOP_SECRET'));
  await faulty.close();

  console.log('MongoDB native document adapter offline contract: PASS');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
