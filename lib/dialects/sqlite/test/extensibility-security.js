'use strict';

var assert = require('assert');
var path = require('path');
var sqlite = require('..');

var db = sqlite.createConnection();
try {
  var capabilities = db.extensibilityCapabilities();
  assert.strictEqual(typeof capabilities.scalarFunctions, 'boolean');
  assert.strictEqual(typeof capabilities.aggregates, 'boolean');
  assert.strictEqual(typeof capabilities.extensionLoading, 'boolean');
  assert.strictEqual(typeof capabilities.authorizer, 'boolean');
  assert.strictEqual(typeof capabilities.defensive, 'boolean');
  assert.ok(Object.isFrozen(capabilities));

  assert.strictEqual(capabilities.scalarFunctions, true);
  db.createFunction('double_value', { deterministic: true }, function (value) { return Number(value) * 2; });
  assert.strictEqual(db.query('SELECT double_value(21) AS value').rows[0].value, 42);

  if (capabilities.aggregates) {
    db.exec('CREATE TABLE nums (value INTEGER NOT NULL); INSERT INTO nums VALUES (2), (3), (5)');
    db.createAggregate('nublox_sum', {
      start: 0,
      step: function (state, value) { return state + Number(value); }
    });
    assert.strictEqual(db.query('SELECT nublox_sum(value) AS total FROM nums').rows[0].total, 10);
  } else {
    assert.throws(function () {
      db.createAggregate('nublox_sum', { start: 0, step: function (state, value) { return state + Number(value); } });
    }, function (error) { return error instanceof sqlite.SqliteError && error.code === 'NUBLOXSQL_UNSUPPORTED'; });
  }

  assert.deepStrictEqual(db.extensionPolicy(), { enabled: false, allowlist: [] });
  assert.throws(function () { db.enableExtensionLoading(true); }, function (error) {
    return error instanceof sqlite.SqliteError && error.code === 'NUBLOXSQL_UNSUPPORTED';
  });
  assert.throws(function () { db.loadExtension('./anything.so'); }, function (error) {
    return error instanceof sqlite.SqliteError && error.code === 'NUBLOXSQL_UNSUPPORTED';
  });

  if (capabilities.authorizer) {
    var constants = db.authorizerConstants();
    assert.strictEqual(typeof constants.SQLITE_OK, 'number');
    assert.strictEqual(typeof constants.SQLITE_DENY, 'number');
    assert.strictEqual(typeof constants.SQLITE_CREATE_TABLE, 'number');
    db.setAuthorizer(function (actionCode) {
      return actionCode === constants.SQLITE_CREATE_TABLE ? constants.SQLITE_DENY : constants.SQLITE_OK;
    });
    assert.throws(function () { db.exec('CREATE TABLE blocked (id INTEGER)'); }, sqlite.SqliteError);
    db.setAuthorizer(null);
    db.exec('CREATE TABLE allowed (id INTEGER)');
  } else {
    assert.throws(function () { db.setAuthorizer(function () { return 0; }); }, function (error) {
      return error instanceof sqlite.SqliteError && error.code === 'NUBLOXSQL_UNSUPPORTED';
    });
  }

  if (capabilities.defensive) {
    assert.strictEqual(db.setDefensive(true), true);
    assert.strictEqual(db.setDefensive(false), false);
  } else {
    assert.throws(function () { db.setDefensive(true); }, function (error) {
      return error instanceof sqlite.SqliteError && error.code === 'NUBLOXSQL_UNSUPPORTED';
    });
  }
} finally {
  db.close();
}

var permitted = path.resolve(process.cwd(), 'permitted-extension.so');
var secured = sqlite.createConnection({ allowExtension: true, extensionAllowlist: [permitted] });
try {
  assert.strictEqual(secured.extensionPolicy().enabled, true);
  assert.deepStrictEqual(Array.from(secured.extensionPolicy().allowlist), [permitted]);
  assert.throws(function () { secured.loadExtension('./not-permitted.so'); }, function (error) {
    return error instanceof sqlite.SqliteError && error.category === 'authorization';
  });
  if (secured.extensibilityCapabilities().extensionLoading) {
    assert.strictEqual(secured.enableExtensionLoading(false), false);
  }
} finally {
  secured.close();
}

assert.throws(function () {
  sqlite.createConnection({ extensionAllowlist: ['./x.so'] });
}, /requires allowExtension/);

console.log('SQLite extensibility and runtime security contract passed');
