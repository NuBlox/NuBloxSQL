'use strict';

var assert = require('assert');
var sql = require('..');

async function liveSqliteTransferContract() {
  var source = sql.createClient({ dialect: 'sqlite', filename: ':memory:' });
  var target = sql.createClient({ dialect: 'sqlite', filename: ':memory:' });
  try {
    await source.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    await source.execute(sql.sql`INSERT INTO users (id, name) VALUES (${1}, ${'Ada'}), (${2}, ${'Grace'}), (${3}, ${'Linus'})`);
    await target.execute('CREATE TABLE copied_users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL)');

    var checkpoints = [];
    var events = [];
    var result = await sql.moveData(source, target, {
      source: { statement: 'SELECT id, name FROM users ORDER BY id' },
      target: {
        table: 'copied_users',
        columns: [
          { source: 'id', target: 'id', required: true },
          { source: 'name', target: 'display_name', required: true }
        ]
      }
    }, {
      batchSize: 2,
      onCheckpoint: function (value) { checkpoints.push(value); },
      onEvent: function (value) { events.push(value.type); }
    });

    assert.strictEqual(result.status, 'succeeded');
    assert.strictEqual(result.rowsRead, 3);
    assert.strictEqual(result.rowsWritten, 3);
    assert.strictEqual(result.rowsSkipped, 0);
    assert.strictEqual(checkpoints.length, 2);
    assert.ok(events.indexOf('data-movement-start') !== -1);
    assert.ok(events.indexOf('data-movement-complete') !== -1);

    var rows = await target.all('SELECT id, display_name FROM copied_users ORDER BY id');
    assert.deepStrictEqual(rows.map(function (row) { return [row.id, row.display_name]; }), [
      [1, 'Ada'], [2, 'Grace'], [3, 'Linus']
    ]);
  } finally {
    await source.close();
    await target.close();
  }
}

async function validationAndSkipContract() {
  var source = {
    dialect: 'postgresql',
    compile: function () { return { text: 'select rows' }; },
    stream: function () {
      return (async function* () {
        yield { id: 1, name: 'ok' };
        yield { id: 2, name: null };
        yield { id: 3, name: 'also-ok' };
      })();
    }
  };
  var writes = [];
  var target = {
    dialect: 'mysql',
    execute: async function (statement) {
      writes.push(statement);
      return { affectedRows: 2 };
    }
  };

  var result = await sql.moveData(source, target, {
    source: { statement: 'select rows' },
    target: { table: 'users', columns: [{ source: 'id', target: 'id' }, { source: 'name', target: 'name', required: true }] }
  }, { batchSize: 10, onInvalid: 'skip' });

  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(result.rowsRead, 3);
  assert.strictEqual(result.rowsWritten, 2);
  assert.strictEqual(result.rowsSkipped, 1);
  assert.strictEqual(writes.length, 1);
}

async function checkpointResumeContract() {
  var rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  function source() {
    return {
      dialect: 'sqlite',
      compile: function () { return { text: 'SELECT id FROM source ORDER BY id' }; },
      stream: function () {
        return (async function* () { for (var i = 0; i < rows.length; i += 1) yield rows[i]; })();
      }
    };
  }

  var calls = 0;
  var failingTarget = {
    dialect: 'sqlite',
    execute: async function () {
      calls += 1;
      if (calls === 2) throw new Error('write failed');
      return { affectedRows: 2 };
    }
  };

  var spec = {
    source: { statement: 'SELECT id FROM source ORDER BY id' },
    target: { table: 'target', columns: ['id'] }
  };

  var first = await sql.moveData(source(), failingTarget, spec, { batchSize: 2 });
  assert.strictEqual(first.status, 'failed');
  assert.strictEqual(first.checkpoint.rowOffset, 4);
  assert.strictEqual(first.rowsWritten, 2);

  var resumedWrites = 0;
  var healthyTarget = {
    dialect: 'sqlite',
    execute: async function () { resumedWrites += 1; return { affectedRows: 2 }; }
  };
  var resumed = await sql.resumeDataMovement(source(), healthyTarget, spec, first.checkpoint, { batchSize: 2 });
  assert.strictEqual(resumed.status, 'succeeded');
  assert.strictEqual(resumedWrites, 0);
  assert.strictEqual(resumed.rowsWritten, 2);

  await assert.rejects(function () {
    return sql.resumeDataMovement(source(), healthyTarget, {
      source: { statement: 'SELECT id FROM source ORDER BY id' },
      target: { table: 'different_target', columns: ['id'] }
    }, first.checkpoint);
  }, /plan hash mismatch/);
}

async function dryRunContract() {
  var source = {
    dialect: 'postgresql',
    compile: function () { return { text: 'select one' }; },
    stream: function () { return (async function* () { yield { id: 1 }; })(); }
  };
  var writes = 0;
  var target = { dialect: 'postgresql', execute: async function () { writes += 1; } };
  var result = await sql.moveData(source, target, {
    source: { statement: 'select one' },
    target: { table: 'users', columns: ['id'] }
  }, { dryRun: true });
  assert.strictEqual(result.status, 'dry-run');
  assert.strictEqual(result.rowsWritten, 1);
  assert.strictEqual(writes, 0);
}

Promise.resolve()
  .then(liveSqliteTransferContract)
  .then(validationAndSkipContract)
  .then(checkpointResumeContract)
  .then(dryRunContract)
  .then(function () { console.log('NuBloxSQL data movement contract: PASS'); })
  .catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
