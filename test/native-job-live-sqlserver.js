'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nublox = require('..');

// Only disabled Agent jobs are created inside disposable CI containers.
// Native discovery under test is strictly read-only.
function config() {
  if (!process.env.MSSQL_SA_PASSWORD) throw new Error('SQL Server CI password missing');
  const caPath = process.env.MSSQL_CA_PATH;
  return {
    dialect:'sqlserver', host:process.env.MSSQL_HOST || '127.0.0.1',
    port:Number(process.env.MSSQL_PORT || 1433), user:'sa',
    password:process.env.MSSQL_SA_PASSWORD, database:'master',
    ...(caPath ? {ca:fs.readFileSync(caPath),
      serverName:process.env.MSSQL_SERVER_NAME || 'sqlserver',
      rejectUnauthorized:true} : {tdsVersion:'7.4', rejectUnauthorized:false}),
    pool:false, connectTimeout:10000, queryTimeout:20000
  };
}
async function main() {
  const db = nublox.createClient(config());
  const name = 'NuBloxSQL_NativeJob_Live_CI';
  const literal = "N'" + name + "'";
  try {
    await db.execute('IF EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = ' +
      literal + ') EXEC msdb.dbo.sp_delete_job @job_name = ' + literal);
    await db.execute('EXEC msdb.dbo.sp_add_job @job_name = ' + literal +
      ', @enabled = 0, @description = N\'NuBloxSQL disposable CI fixture\'');

    const inventory = await db.discoverNativeJobs({maxRows:100});
    const basic = inventory.jobs.find(job=>job.name===name);
    assert.ok(basic,'disabled Agent job must be visible');
    assert.equal(basic.enabled,false);
    assert.equal(basic.operational,undefined);

    const report = await db.discoverNativeJobs({maxRows:100,includeOperational:true});
    const job = report.jobs.find(item=>item.name===name);
    assert.ok(job,'disabled Agent job must appear in operational results');
    assert.equal(report.dialect,'sqlserver');
    assert.equal(report.complete,false);
    assert.equal(job.kind,'sqlserver-agent-job');
    assert.match(job.id,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
    assert.equal(job.enabled,false);
    assert.equal(job.operational.scheduleCount,0);
    assert.equal(job.operational.lastRun,null);
    assert.equal(job.operational.nextRunLocal,null);
    assert.equal(job.operational.nextRunMayBeStale,true);
    assert.equal(job.operational.runningStateReliable,false);
    assert.ok(Object.isFrozen(job.operational));
    assert.ok(!JSON.stringify(report).includes('NuBloxSQL disposable CI fixture'));
    console.log('NuBloxSQL live SQL Server Agent native job operational qualification: PASS');
  } finally {
    try {
      await db.execute('IF EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = ' +
        literal + ') EXEC msdb.dbo.sp_delete_job @job_name = ' + literal);
    } catch(error) {
      console.error('SQL Server fixture cleanup failed:',error.message);
      process.exitCode=1;
    }
    await db.close();
  }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
