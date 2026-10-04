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
  .then(automaticLosslessFallback)
  .then(function () { console.log('NuBloxSQL native data movement planner: PASS'); })
  .catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
