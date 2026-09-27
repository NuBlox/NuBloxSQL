'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var ResourceLimits = require(path.resolve(common.lib, 'protocol/ResultSetResourceLimits'));

function connection(options) {
  return {config: options || {}};
}

test('ResultSetResourceLimits', {
  'accepts result-set column counts within the configured limit': function() {
    assert.doesNotThrow(function() {
      ResourceLimits.assertColumnCount(connection({maxResultSetColumns: 4}), 4);
    });
  },

  'rejects result-set column counts above the configured limit': function() {
    var error;

    try {
      ResourceLimits.assertColumnCount(connection({maxResultSetColumns: 4}), 5);
    } catch (err) {
      error = err;
    }

    assert.ok(error);
    assert.strictEqual(error.code, 'PROTOCOL_RESULTSET_COLUMNS_TOO_LARGE');
    assert.strictEqual(error.fatal, true);
    assert.strictEqual(error.columnCount, 5);
    assert.strictEqual(error.limit, 4);
  },

  'accumulates metadata packet sizes within the configured limit': function() {
    var resultSet = {};
    var conn = connection({maxMetadataSize: 16});

    ResourceLimits.noteMetadataPacket(conn, resultSet, 7);
    ResourceLimits.noteMetadataPacket(conn, resultSet, 9);

    assert.strictEqual(resultSet.metadataBytes, 16);
  },

  'rejects cumulative metadata above the configured limit': function() {
    var resultSet = {};
    var conn = connection({maxMetadataSize: 16});
    var error;

    ResourceLimits.noteMetadataPacket(conn, resultSet, 10);

    try {
      ResourceLimits.noteMetadataPacket(conn, resultSet, 7);
    } catch (err) {
      error = err;
    }

    assert.ok(error);
    assert.strictEqual(error.code, 'PROTOCOL_RESULTSET_METADATA_TOO_LARGE');
    assert.strictEqual(error.fatal, true);
    assert.strictEqual(error.metadataSize, 17);
    assert.strictEqual(error.limit, 16);
  }
});
