'use strict';

var assert = require('assert');
var sql = require('..');

async function testEmbeddedLifecycle() {
  var client = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });

  assert.strictEqual(client.lifecycleState, 'idle');
  assert.strictEqual(client.isOpen, false);
  assert.strictEqual(client.isClosed, false);

  var opened = await client.open();
  assert.strictEqual(opened, client);
  assert.strictEqual(client.lifecycleState, 'open');
  assert.strictEqual(client.isOpen, true);

  var row = await client.one('SELECT 1 AS value');
  assert.strictEqual(row.value, 1);

  await client.end();
  assert.strictEqual(client.lifecycleState, 'closed');
  assert.strictEqual(client.isOpen, false);
  assert.strictEqual(client.isClosed, true);

  await client.close();
  await assert.rejects(function () { return client.connect(); }, /lifecycle state is closed/);
  await assert.rejects(function () { return client.query('SELECT 1'); }, /lifecycle state is closed/);
}

async function testConcurrentOpenAndClose() {
  var connectCalls = 0;
  var endCalls = 0;
  var releaseConnect;
  var connectGate = new Promise(function (resolve) { releaseConnect = resolve; });

  var target = {
    connected: false,
    ended: false,
    connect: async function connect() {
      connectCalls += 1;
      await connectGate;
      this.connected = true;
      return this;
    },
    end: async function end() {
      endCalls += 1;
      this.connected = false;
      this.ended = true;
    },
    query: async function query() { return { rows: [{ value: 1 }] }; }
  };

  var adapter = {
    descriptor: {
      capabilities: Object.freeze({}),
      supports: function supports() { return false; },
      services: Object.freeze({})
    },
    createConnection: function createConnection() { return target; }
  };

  var client = new sql.Client(adapter, 'mysql', { pool: false });
  var firstOpen = client.connect();
  var secondOpen = client.open();

  await Promise.resolve();
  assert.strictEqual(client.lifecycleState, 'opening');
  assert.strictEqual(connectCalls, 1);

  releaseConnect();
  var opened = await Promise.all([firstOpen, secondOpen]);
  assert.strictEqual(opened[0], client);
  assert.strictEqual(opened[1], client);
  assert.strictEqual(client.lifecycleState, 'open');

  var firstClose = client.close();
  var secondClose = client.end();
  await Promise.all([firstClose, secondClose]);

  assert.strictEqual(endCalls, 1);
  assert.strictEqual(client.lifecycleState, 'closed');
}

async function testFailedOpenCanRetry() {
  var attempts = 0;
  var target = {
    connected: false,
    ended: false,
    connect: async function connect() {
      attempts += 1;
      if (attempts === 1) throw new Error('transient connect failure');
      this.connected = true;
      return this;
    },
    end: async function end() {
      this.connected = false;
      this.ended = true;
    }
  };

  var adapter = {
    descriptor: {
      capabilities: Object.freeze({}),
      supports: function supports() { return false; },
      services: Object.freeze({})
    },
    createConnection: function createConnection() { return target; }
  };

  var client = new sql.Client(adapter, 'postgresql', { pool: false });
  await assert.rejects(function () { return client.connect(); }, /transient connect failure/);
  assert.strictEqual(client.lifecycleState, 'idle');

  await client.connect();
  assert.strictEqual(attempts, 2);
  assert.strictEqual(client.lifecycleState, 'open');
  await client.close();
}

async function testPoolLifecycleIsLogicalNotPhysical() {
  var endCalls = 0;
  var pool = {
    _ended: false,
    end: async function end() { this._ended = true; endCalls += 1; }
  };
  var adapter = {
    descriptor: {
      capabilities: Object.freeze({}),
      supports: function supports() { return false; },
      services: Object.freeze({})
    },
    createPool: function createPool() { return pool; }
  };

  var client = new sql.Client(adapter, 'mysql', { pool: true });
  assert.strictEqual(client.lifecycleState, 'idle');
  await client.connect();
  assert.strictEqual(client.lifecycleState, 'open');
  assert.strictEqual(pool._ended, false);
  await client.close();
  assert.strictEqual(endCalls, 1);
  assert.strictEqual(client.lifecycleState, 'closed');
}

async function main() {
  assert.deepStrictEqual(sql.CLIENT_LIFECYCLE_STATES, {
    IDLE: 'idle',
    OPENING: 'opening',
    OPEN: 'open',
    CLOSING: 'closing',
    CLOSED: 'closed'
  });

  await testEmbeddedLifecycle();
  await testConcurrentOpenAndClose();
  await testFailedOpenCanRetry();
  await testPoolLifecycleIsLogicalNotPhysical();
  console.log('NuBloxSQL portable async client lifecycle contract passed');
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
