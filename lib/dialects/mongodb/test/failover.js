'use strict';

// Ephemeral-only resilience qualification. CI runs three local MongoDB
// containers and intentionally STOPS the elected primary.
// Never run this against customer systems or shared Docker infrastructure.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {createNativeConnection}=require('../../../..');

const PORTS=[27017,27018,27019];
const DB='nublox_failover_ci';
const COLLECTION='resilience_probe';

function primaryContainer() {
  for (let i=0;i<PORTS.length;i++) {
    const name='nublox-mongo-failover-'+(i+1);
    const result=execFileSync('docker',[
      'exec',name,'mongosh','--quiet','--host','127.0.0.1',
      '--port',String(PORTS[i]),'--eval',
      'db.hello().isWritablePrimary'
    ],{timeout:20000,encoding:'utf8'}).trim();
    if (result==='true') return name;
  }
  throw new Error('Ephemeral replica set has no elected primary');
}

async function waitForSecondaryReplication(connection,marker) {
  const deadline=Date.now()+45000;
  while(Date.now()<deadline) {
    try {
      // This is test-only synchronization using the official driver.
      // A majority-committed secondary read prevents testing rollback of
      // a write that never reached an electable member.
      const doc=await connection._client.db(DB).collection(COLLECTION)
        .findOne({marker},{
          readPreference:'secondary',readConcern:{level:'majority'},maxTimeMS:5000
        });
      if (doc) return;
    } catch (_) {
      // Election/topology startup can briefly defer secondary reads.
    }
    await delay(750);
  }
  throw new Error('Replication readiness deadline exceeded');
}

async function main() {
  if (process.env.NUBLOX_EPHEMERAL_MONGO_FAILOVER !== 'three-node-ci') {
    throw new Error('Refusing destructive failover outside explicitly scoped CI');
  }
  const db=createNativeConnection('mongodb',{
    database:DB,replicaSet:'nubloxrs',
    seeds:PORTS.map(port=>({host:'127.0.0.1',port})),
    connectTimeout:12000,commandTimeout:12000,maxPoolSize:4
  });
  await db.connect();
  try {
    assert.equal(await db.ping(),true);
    const marker='nublox-failover-'+process.pid+'-'+Date.now();
    assert.equal((await db.insertOne(COLLECTION,{marker,value:'before'}))
      .acknowledged,true);
    await waitForSecondaryReplication(db,marker);

    const oldPrimary=primaryContainer();
    execFileSync('docker',['stop','--time','1',oldPrimary],{
      timeout:30000,stdio:'pipe'
    });

    let recovered=false;
    let retryableFailures=0;
    const deadline=Date.now()+90000;
    while(Date.now()<deadline) {
      try {
        const ping=await db.ping();
        const doc=await db.findOne(COLLECTION,{marker});
        if (ping && doc?.value==='before') {
          recovered=true;
          break;
        }
      } catch (error) {
        // Once the primary is lost, the driver can legitimately time out
        // during a new election. Our adapter must still be usable afterward.
        if (!['NUBLOX_MONGODB_PING_FAILED',
               'NUBLOX_MONGODB_FIND_ONE_FAILED'].includes(error.code)) throw error;
        retryableFailures++;
      }
      await delay(1000);
    }
    assert.equal(recovered,true,'native client must discover a newly elected primary');
    assert.equal(db.connected,true,'the public connection must remain usable');
    assert.equal((await db.updateOne(COLLECTION,{marker},
      {$set:{value:'after'}})).matchedCount,1);
    assert.equal((await db.findOne(COLLECTION,{marker})).value,'after');
    assert.equal((await db.deleteOne(COLLECTION,{marker})).deletedCount,1);
    // Metrics are counts only. Never include topology addresses, credentials
    // or database contents in machine-readable CI evidence.
    console.log(JSON.stringify({
      status:'passed',scenario:'three-member-primary-loss',
      oldPrimaryStopped:true,newPrimaryDiscovered:true,
      readWriteRecovery:true,
      temporaryElectionFailures:retryableFailures,
      qualification:'ephemeral-replica-set-only-not-cloud-certification'
    }));
  } finally {
    await db.close();
  }
}
main().catch(error=>{
  // Do not emit raw MongoDB messages, addresses or authentication materials.
  console.error('NuBloxSQL ephemeral failover qualification failed: '+
    (/^NUBLOX_MONGODB_[A-Z_]+$/.test(error.code||'') ? error.code :
     'CHECK_FAILED'));
  process.exitCode=1;
});
