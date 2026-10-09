'use strict';

const storeModule=require('../../lib/jobs/SqliteJobStore');

async function main(){
  const filename=process.argv[2];
  const workerId=process.argv[3];
  const now=process.argv[4];
  const expiresAt=process.argv[5];
  const store=storeModule.createStore({filename:filename,busyTimeout:10000});
  try{
    const run=await store.leaseNextRun({workerId:workerId,now:now,expiresAt:expiresAt});
    process.stdout.write(JSON.stringify(run));
  }finally{
    store.close();
  }
}

main().catch(function(error){
  console.error(error&&error.stack||error);
  process.exitCode=1;
});
