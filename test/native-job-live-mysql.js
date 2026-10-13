'use strict';
const assert = require('node:assert/strict');
const nublox = require('..');

// Fixture DDL is limited to disposable CI instances; public discovery is SELECT-only.
async function main() {
  const schema = process.env.MYSQL_DATABASE;
  if (!schema || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(schema) || !process.env.MYSQL_ROOT_PASSWORD) {
    throw new Error('MySQL CI schema and administrative credentials are required');
  }
  const db = nublox.createClient({
    dialect:'mysql', host:process.env.MYSQL_HOST || '127.0.0.1',
    port:Number(process.env.MYSQL_PORT || 3306),
    user:'root', password:process.env.MYSQL_ROOT_PASSWORD,
    database:schema, pool:false, ssl:false, getServerPublicKey:true
  });
  const quote = String.fromCharCode(96);
  const recurring = 'nublox_native_discovery_recurring_ci';
  const once = 'nublox_native_discovery_once_ci';
  const prefix = quote + schema + quote + '.';
  const name = event => prefix + quote + event + quote;
  try {
    await db.execute('DROP EVENT IF EXISTS ' + name(recurring));
    await db.execute('DROP EVENT IF EXISTS ' + name(once));
    await db.execute('CREATE EVENT ' + name(recurring) +
      ' ON SCHEDULE EVERY 2 HOUR STARTS CURRENT_TIMESTAMP + INTERVAL 5 MINUTE ' +
      'DISABLE DO SELECT 1');
    await db.execute('CREATE EVENT ' + name(once) +
      ' ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 7 DAY ' +
      'DISABLE DO SELECT 1');

    const inventory = await db.discoverNativeJobs({maxRows:100});
    const baseline = inventory.jobs.find(j=>j.schema===schema && j.name===recurring);
    assert.ok(baseline, 'the disabled fixture must be visible');
    assert.equal(baseline.enabled,false);
    assert.equal(baseline.operational,undefined);

    const report = await db.discoverNativeJobs({maxRows:100,includeOperational:true});
    const repeated = report.jobs.find(j=>j.schema===schema && j.name===recurring);
    const oneTime = report.jobs.find(j=>j.schema===schema && j.name===once);
    assert.ok(repeated && oneTime, 'both event types must be present');
    assert.equal(report.dialect,'mysql');
    assert.equal(report.complete,false);
    assert.equal(repeated.scheduleKind,'RECURRING');
    assert.equal(repeated.operational.outcome,'not-reported');
    assert.equal(repeated.operational.lastExecutedLocal,null);
    assert.equal(repeated.operational.schedule.intervalValue,'2');
    assert.equal(repeated.operational.schedule.intervalField,'HOUR');
    assert.match(repeated.operational.schedule.startsLocal,/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.equal(repeated.operational.schedule.executeAtLocal,null);
    assert.equal(oneTime.scheduleKind,'ONE TIME');
    assert.match(oneTime.operational.schedule.executeAtLocal,/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.equal(oneTime.operational.schedule.intervalValue,null);
    assert.ok(Object.isFrozen(repeated.operational.schedule));
    assert.ok(!JSON.stringify(report).includes('EVENT_DEFINITION'));
    assert.ok(!JSON.stringify(report).includes('DEFINER'));
    console.log('NuBloxSQL live MySQL native job operational qualification: PASS');
  } finally {
    for (const event of [recurring,once]) {
      try {await db.execute('DROP EVENT IF EXISTS ' + name(event));}
      catch (error) { console.error('MySQL fixture cleanup failed:',error.message); process.exitCode=1; }
    }
    await db.close();
  }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
