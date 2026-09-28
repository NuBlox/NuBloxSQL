'use strict';

var assert = require('assert');
var test = require('utest');

var SessionReset = require('../../lib/SessionReset');

test('SessionReset', {
  'invalidates prepared state before enqueuing reset': function() {
    var events = [];
    var captured;
    var callbackPacket;
    var connection = {};

    connection.config = {};
    connection.threadId = 17;
    connection._implyConnect = function implyConnect() {
      events.push('connect');
    };
    connection.clearPreparedStatementCache = function clearPreparedStatementCache() {
      events.push('clear-cache');
    };
    connection._nubloxPreparedStatementState = {
      manualStatements: [{
        close: function close() {
          events.push('close-manual');
        }
      }]
    };
    connection._protocol = {
      _enqueue: function enqueue(sequence) {
        events.push('enqueue-reset');
        captured = sequence;
        return sequence;
      }
    };

    SessionReset.decorateConnection(connection);
    var returned = connection.resetConnection({operationTimeout: 123}, function onReset(error, packet) {
      assert.ifError(error);
      callbackPacket = packet;
      events.push('callback');
    });

    assert.strictEqual(returned, captured);
    assert.deepStrictEqual(events, ['connect', 'clear-cache', 'close-manual', 'enqueue-reset']);
    assert.strictEqual(captured._operationTimeout, 123);

    captured.end(null, {serverStatus: 2});

    assert.deepStrictEqual(events, [
      'connect',
      'clear-cache',
      'close-manual',
      'enqueue-reset',
      'callback'
    ]);
    assert.deepStrictEqual(callbackPacket, {serverStatus: 2});
  },

  'restores configured database and charset before completing': function() {
    var captured;
    var statements = [];
    var callbackCalled = false;
    var connection = {};

    connection.config = {
      database      : 'nublox_ci',
      charsetNumber : 46
    };
    connection.threadId = 18;
    connection._implyConnect = function implyConnect() {};
    connection.clearPreparedStatementCache = function clearPreparedStatementCache() {};
    connection.escapeId = function escapeId(value) {
      return '`' + value + '`';
    };
    connection.escape = function escape(value) {
      return "'" + value + "'";
    };
    connection.query = function query(options, callback) {
      statements.push(options.sql);
      callback(null);
    };
    connection._protocol = {
      _enqueue: function enqueue(sequence) {
        captured = sequence;
        return sequence;
      }
    };

    SessionReset.decorateConnection(connection);
    connection.resetConnection(function onReset(error) {
      assert.ifError(error);
      callbackCalled = true;
    });

    captured.end(null, {});

    assert.deepStrictEqual(statements, [
      'USE `nublox_ci`',
      "SET NAMES 'utf8mb4' COLLATE 'utf8mb4_bin'"
    ]);
    assert.strictEqual(callbackCalled, true);
  }
});
