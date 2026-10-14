'use strict';

// Qualified only against short-lived MongoDB services in GitHub Actions.
// No production database or credentials are used.
const assert=require('node:assert/strict');
const {createNativeConnection}=require('../../../..');

async function main() {
  const db=createNativeConnection('mongodb',{
    host:process.env.MONGODB_HOST || '127.0.0.1',
    port:Number(process.env.MONGODB_PORT || 27017),
    database:'nublox_native_ci',
    connectTimeout:15000,
    commandTimeout:15000,
    maxResults:20
  });
  await db.connect();
  try {
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
    assert.equal((await db.deleteOne(collection,{marker})).deletedCount,1);
    assert.equal(await db.findOne(collection,{marker}),null);
    assert.equal(await db.countDocuments(collection,{marker}),0);
  } finally {
    await db.close();
  }
  console.log('MongoDB native document adapter live CRUD: PASS');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
