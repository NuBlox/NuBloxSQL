'use strict';

// Qualified only against short-lived MongoDB services in GitHub Actions.
// No production database or credentials are used.
const assert=require('node:assert/strict');
const {createNativeConnection}=require('../../../..');

function options() {
  const config={
    database:'nublox_native_ci',
    connectTimeout:15000,
    commandTimeout:15000,
    maxResults:20
  };
  const host=process.env.MONGODB_HOST || '127.0.0.1';
  const port=Number(process.env.MONGODB_PORT || 27017);
  if (process.env.MONGODB_REPLICA_SET) {
    config.seeds=[{host,port}];
    config.replicaSet=process.env.MONGODB_REPLICA_SET;
  } else {
    config.host=host;
    config.port=port;
  }
  if (process.env.MONGODB_USERNAME) {
    config.username=process.env.MONGODB_USERNAME;
    config.password=process.env.MONGODB_PASSWORD;
    config.authSource='admin';
  }
  return config;
}
async function main() {
  const config=options();
  if (config.username) {
    // A wrong password must be rejected by the *real authenticated server*.
    // Use a synthetic invalid value, never display or log the credential.
    const invalid=createNativeConnection('mongodb',{
      ...config,password:'an-invalid-credential-for-the-ephemeral-test'
    });
    await assert.rejects(invalid.connect(),error=>
      error.code==='NUBLOX_MONGODB_CONNECT_FAILED' &&
      !error.message.includes(config.password));
    await invalid.close();
  }
  const db=createNativeConnection('mongodb',config);
  await db.connect();
  try {
    assert.equal(await db.ping(),true);
    const collection='native_integration_'+process.pid;
    const marker='nublox-'+process.pid+'-'+Date.now();
    assert.equal((await db.insertOne(collection,{marker,category:'integration',value:1}))
      .acknowledged,true);
    assert.equal((await db.findOne(collection,{marker})).value,1);
    assert.equal((await db.countDocuments(collection,{marker})),1);
    assert.equal((await db.updateOne(collection,{marker},{$set:{value:2}})).modifiedCount,1);
    const docs=await db.find(collection,{marker},{limit:5,batchSize:2});
    assert.equal(docs.length,1);
    assert.equal(docs[0].value,2);
    const streamed=[];
    for await (const item of db.iterate(collection,{marker},{limit:3,batchSize:1})) {
      streamed.push(item);
      break;
    }
    assert.equal(streamed.length,1);
    assert.equal(streamed[0].value,2);
    assert.equal((await db.deleteOne(collection,{marker})).deletedCount,1);
    assert.equal(await db.findOne(collection,{marker}),null);
    assert.equal(await db.countDocuments(collection,{marker}),0);
  } finally {
    await db.close();
  }
  console.log('MongoDB native document adapter live CRUD/cursor'+
    (config.replicaSet ? '/replica-set' : '')+
    (config.username ? '/authenticated' : '')+': PASS');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
