'use strict';

var assert = require('assert');
var sql = require('..');

function source(dialect, rows) {
  return {
    dialect: dialect,
    compile: function (statement) { return { text: String(statement), parameters: [] }; },
    stream: function () {
      return (async function* () {
        for (var i = 0; i < rows.length; i += 1) yield rows[i];
      })();
    }
  };
}

function spec() {
  return {
    source: { statement: 'SELECT id, name FROM source ORDER BY id' },
    target: { table: ['public', 'target'], columns: ['id', 'name'] }
  };
}

async function postgresPlannerAndExecution() {
  var target = sql.createClient({ dialect: 'postgresql', pool: false, host: 'localhost', user: 'test', database: 'test' });
  var calls = [];
  target._ensureConnected = async function () { return target.native; };
  target.native.copyFrom = async function (statement, payload) {
    calls.push({ statement: statement, payload: payload });
    return { rowCount: 2 };
  };
  target.execute = async function () { throw new Error('portable fallback should not be used'); };

  var transferPlan = sql.planDataMovement(source('sqlite', []), target, spec());
  assert.strictEqual(transferPlan.strategy, 'postgresql-copy-csv');
  assert.strictEqual(transferPlan.accelerated, true);
  assert.strictEqual(transferPlan.fallback, 'portable-batched-insert');

  var result = await sql.moveData(source('sqlite', [
    { id: 1, name: 'Ada' },
    { id: 2, name: 'Grace "Amazing"' },
    { id: 3, name: null }
  ]), target, spec(), { batchSize: 2 });

  assert.strictEqual(result.status, 'succeeded');
  assert.deepStrictEqual(result.strategiesUsed, ['postgresql-copy-csv']);
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0].statement, /^COPY "public"\."target" \("id", "name"\) FROM STDIN/);
  assert.match(calls[0].payload, /"Grace ""Amazing"""/);
  assert.match(calls[1].payload, /\\N/);
  await target.close();
}

async function mysqlPlannerAndExecution() {
  var target = sql.createClient({
    dialect: 'mysql',
    pool: false,
    host: 'localhost',
    user: 'test',
    database: 'test',
    localInfile: true
  });
  var calls = [];
  target._ensureConnected = async function () { return target.native; };
  target.native.loadDataLocal = async function (statement, payload, options) {
    calls.push({ statement: statement, payload: payload, options: options });
    return { affectedRows: 2 };
  };
  target.execute = async function () { throw new Error('portable fallback should not be used'); };

  var transferPlan = sql.planDataMovement(source('postgresql', []), target, {
    source: { statement: 'SELECT id, name FROM source ORDER BY id' },
    target: { table: 'target', columns: ['id', 'name'] }
  });
  assert.strictEqual(transferPlan.strategy, 'mysql-local-infile-tsv');
  assert.strictEqual(transferPlan.accelerated, true);

  var result = await sql.moveData(source('postgresql', [
    { id: 1, name: 'line one' },
    { id: 2, name: 'line\ntwo' }
  ]), target, {
    source: { statement: 'SELECT id, name FROM source ORDER BY id' },
    target: { table: 'target', columns: ['id', 'name'] }
  }, { batchSize: 10 });

  assert.strictEqual(result.status, 'succeeded');
  assert.deepStrictEqual(result.strategiesUsed, ['mysql-local-infile-tsv']);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].statement, /^LOAD DATA LOCAL INFILE 'nubloxsql-data-movement\.tsv'/);
  assert.strictEqual(calls[0].options.filename, 'nubloxsql-data-movement.tsv');
  assert.match(calls[0].payload, /line\\ntwo/);
  await target.close();
}

async function automaticLosslessFallback() {
  var target = sql.createClient({ dialect: 'postgresql', pool: false, host: 'localhost', user: 'test', database: 'test' });
  var nativeCalls = 0;
  var portableCalls = 0;
  target._ensureConnected = async function () { return target.native; };
  target.native.copyFrom = async function () { nativeCalls += 1; };
  target.execute = async function () { portableCalls += 1; return { affectedRows: 1 }; };

  var oneColumn = {
    source: { statement: 'SELECT payload FROM source ORDER BY id' },
    target: { table: 'target', columns: ['payload'] }
  };
  var result = await sql.moveData(source('sqlite', [{ payload: { nested: true } }]), target, oneColumn);
  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(nativeCalls, 0);
  assert.strictEqual(portableCalls, 1);
  assert.deepStrictEqual(result.strategiesUsed, ['portable-batched-insert']);

  var requiredNative = await sql.moveData(source('sqlite', [{ payload: { nested: true } }]), target, oneColumn, { strategy: 'native' });
  assert.strictEqual(requiredNative.status, 'failed');
  assert.match(requiredNative.error.message, /cannot encode/);
  await target.close();
}

async function sqlitePlannerAndExecution() {
  var target = sql.createClient({ dialect: 'sqlite', pool: false });
  await target.execute('CREATE TABLE target(id INTEGER PRIMARY KEY, name TEXT, active INTEGER)');

  var moveSpec = {
    source: { statement: 'SELECT id, name, active FROM source ORDER BY id' },
    target: { table: 'target', columns: ['id', 'name', 'active'] }
  };
  var transferPlan = sql.planDataMovement(source('postgresql', []), target, moveSpec);
  assert.strictEqual(transferPlan.strategy, 'sqlite-prepared-transaction');
  assert.strictEqual(transferPlan.accelerated, true);
  assert.strictEqual(transferPlan.fallback, 'sqlite-batched-insert');

  var checkpoints = [];
  var result = await sql.moveData(source('postgresql', [
    { id: 1, name: 'Ada', active: true },
    { id: 2, name: 'Grace', active: false },
    { id: 3, name: null, active: true }
  ]), target, moveSpec, {
    batchSize: 2,
    strategy: 'native',
    onCheckpoint: function (checkpoint) { checkpoints.push(checkpoint.rowOffset); }
  });

  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(result.rowsWritten, 3);
  assert.deepStrictEqual(result.strategiesUsed, ['sqlite-prepared-transaction']);
  assert.deepStrictEqual(checkpoints, [2, 3]);
  assert.deepStrictEqual(await target.all('SELECT id, name, active FROM target ORDER BY id'), [
    { id: 1, name: 'Ada', active: 1 },
    { id: 2, name: 'Grace', active: 0 },
    { id: 3, name: null, active: 1 }
  ]);

  await target.execute('CREATE TABLE rollback_target(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL)');
  var rollbackSpec = {
    source: { statement: 'SELECT id, code FROM source ORDER BY id' },
    target: { table: 'rollback_target', columns: ['id', 'code'] }
  };
  var failed = await sql.moveData(source('postgresql', [
    { id: 1, code: 'duplicate' },
    { id: 2, code: 'duplicate' }
  ]), target, rollbackSpec, { batchSize: 2, strategy: 'native' });
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.rowsWritten, 0);
  assert.strictEqual(failed.checkpoint.rowOffset, 0);
  assert.strictEqual((await target.one('SELECT COUNT(*) AS count FROM rollback_target')).count, 0);

  await target.close();
}

async function sqlServerPlannerAndExecution() {
  var target = sql.createClient({ dialect: 'sqlserver', pool: false, host: 'localhost', user: 'test', password: 'test', database: 'test' });
  var calls = [];
  target._ensureConnected = async function () { return target.native; };
  target.native.bulkInsert = async function (table, columns, rows, options) {
    calls.push({ table: table, columns: columns, rows: rows, options: options });
    return { affectedRows: BigInt(rows.length) };
  };
  target.execute = async function () { throw new Error('portable fallback should not be used'); };

  var transferPlan = sql.planDataMovement(source('sqlite', []), target, {
    source: { statement: 'SELECT id, name FROM source ORDER BY id' },
    target: { table: ['dbo', 'target'], columns: ['id', 'name'] }
  });
  assert.strictEqual(transferPlan.strategy, 'sqlserver-tds-bulk');
  assert.strictEqual(transferPlan.accelerated, true);

  var result = await sql.moveData(source('sqlite', [
    { id: 1, name: 'Ada' },
    { id: 2, name: 'Grace' }
  ]), target, {
    source: { statement: 'SELECT id, name FROM source ORDER BY id' },
    target: { table: ['dbo', 'target'], columns: ['id', 'name'] }
  }, { batchSize: 10, strategy: 'native' });

  assert.strictEqual(result.status, 'succeeded');
  assert.deepStrictEqual(result.strategiesUsed, ['sqlserver-tds-bulk']);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].table, ['dbo', 'target']);
  assert.deepStrictEqual(calls[0].columns, ['id', 'name']);
  await target.close();
}

function plannerGuardrails() {
  var mysqlWithoutOptIn = sql.createClient({ dialect: 'mysql', pool: false, host: 'localhost', user: 'test' });
  var plan = sql.planDataMovement(source('sqlite', []), mysqlWithoutOptIn, {
    source: { statement: 'SELECT id FROM source' },
    target: { table: 'target', columns: ['id'] }
  });
  assert.strictEqual(plan.strategy, 'portable-batched-insert');
  assert.strictEqual(plan.accelerated, false);
  assert.throws(function () {
    sql.planDataMovement(source('sqlite', []), mysqlWithoutOptIn, {
      source: { statement: 'SELECT id FROM source' },
      target: { table: 'target', columns: ['id'] }
    }, { strategy: 'native' });
  }, /no qualified native target writer/);
  assert.strictEqual(sql.planDataMovement(source('sqlite', []), mysqlWithoutOptIn, {
    source: { statement: 'SELECT id FROM source' },
    target: { table: 'target', columns: ['id'] }
  }, { strategy: 'portable' }).strategy, 'portable-batched-insert');
  return mysqlWithoutOptIn.close();
}

Promise.resolve()
  .then(plannerGuardrails)
  .then(postgresPlannerAndExecution)
  .then(mysqlPlannerAndExecution)
  .then(sqlitePlannerAndExecution)
  .then(sqlServerPlannerAndExecution)
  .then(automaticLosslessFallback)
  .then(function () { console.log('NuBloxSQL native data movement planner: PASS'); })
  .catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
