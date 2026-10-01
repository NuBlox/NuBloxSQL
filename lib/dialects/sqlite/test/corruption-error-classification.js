'use strict';

var assert = require('node:assert');
var errors = require('../../../client/Error');

['SQLITE_NOTADB', 'SQLITE_CORRUPT', 'SQLITE_FORMAT'].forEach(function (code) {
  var native = new Error('synthetic ' + code);
  native.name = 'SqliteError';
  native.code = code;
  var normalized = errors.normalizeError('sqlite', native, 'query');
  assert.strictEqual(normalized.category, 'connection');
  assert.strictEqual(normalized.retryable, false);
  assert.strictEqual(normalized.nativeCode, code);
});

['SQLITE_BUSY', 'SQLITE_LOCKED'].forEach(function (code) {
  var native = new Error('synthetic ' + code);
  native.name = 'SqliteError';
  native.code = code;
  var normalized = errors.normalizeError('sqlite', native, 'query');
  assert.strictEqual(normalized.category, 'timeout');
  assert.strictEqual(normalized.retryable, true);
  assert.strictEqual(normalized.nativeCode, code);
});

console.log('ok - SQLite corruption and contention retry classification');
