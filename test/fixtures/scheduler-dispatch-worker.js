'use strict';

const { createStore } = require('../../lib/jobs/SqliteJobStore');
const { createApprovalPolicy } = require('../../lib/jobs/JobApprovalPolicy');
const { createExecutorRegistry } = require('../../lib/jobs/JobKernel');
const [filename, when] = process.argv.slice(2);
const store = createStore({filename,clock:()=>Number(when)});
try {
  const registry=createExecutorRegistry();
  registry.register('inspection.host',{
    retrySafe:true,async execute(){return {done:true};},
    async verify(){return true;}
  });
  const result=store.dispatchDueSchedules({approvalPolicy:createApprovalPolicy(),registry});
  process.stdout.write(JSON.stringify(result));
} finally {
  store.close();
}
