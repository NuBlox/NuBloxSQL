'use strict';

var assert = require('assert');
var limits = require('../lib/ResultLimits');
var postgresql = require('..');

function row(values) {
  return { values: values.map(function (value) { return value === null ? null : Buffer.from(value); }) };
}

function testDefaultsAndOverrides() {
  var state = limits.create({}, {});
  assert.strictEqual(state.maxRows, 100000);
  assert.strictEqual(state.maxResultBytes, 64 * 1024 * 1024);
  assert.strictEqual(state.maxRowBytes, 16 * 1024 * 1024);

  state = limits.create({ maxRows: 10 }, { maxRows: 2, maxResultBytes: 20, maxRowBytes: 10 });
  assert.strictEqual(state.maxRows, 2);
  assert.strictEqual(state.maxResultBytes, 20);
  assert.strictEqual(state.maxRowBytes, 10);
}

function testRowLimit() {
  var state = { _resultLimits: limits.create({}, { maxRows: 1 }) };
  limits.observeRow(state, row(['a']));
  assert.throws(function () { limits.observeRow(state, row(['b'])); }, function (error) {
    return error instanceof limits.PostgreSqlResultLimitError && error.code === 'NUBLOX_POSTGRESQL_MAX_ROWS';
  });
}

function testByteLimits() {
  var state = { _resultLimits: limits.create({}, { maxResultBytes: 3, maxRowBytes: 2 }) };
  limits.observeRow(state, row(['ab']));
  assert.throws(function () { limits.observeRow(state, row(['cd'])); }, function (error) {
    return error.code === 'NUBLOX_POSTGRESQL_MAX_RESULT_BYTES';
  });

  state = { _resultLimits: limits.create({}, { maxRowBytes: 1 }) };
  assert.throws(function () { limits.observeRow(state, row(['ab'])); }, function (error) {
    return error.code === 'NUBLOX_POSTGRESQL_MAX_ROW_BYTES';
  });
}

function testPublicSurface() {
  assert.strictEqual(typeof postgresql.PostgreSqlResultLimitError, 'function');
  assert.strictEqual(postgresql.DEFAULT_RESULT_LIMITS.maxRows, 100000);
  var connection = postgresql.createConnection({ user: 'test', maxRows: 7, maxResultBytes: 99, maxRowBytes: 33 });
  assert.strictEqual(connection.maxRows, 7);
  assert.strictEqual(connection.maxResultBytes, 99);
  assert.strictEqual(connection.maxRowBytes, 33);
}

[testDefaultsAndOverrides, testRowLimit, testByteLimits, testPublicSurface].forEach(function (test) { test(); });
console.log('ok - PostgreSQL result limits');
