'use strict';

var assert = require('assert');
var common = require('../../common');
var test = require('utest');

var Protocol = require(common.lib + '/protocol/Protocol');
var Sequences = require(common.lib + '/protocol/sequences');

test('COM_RESET_CONNECTION', {
  'writes command byte 0x1f and preserves classic command ordering': function() {
    var protocol = new Protocol({
      config     : {},
      connection : {}
    });
    var writes = [];

    protocol.on('data', function onData(buffer) {
      writes.push(Buffer.from(buffer));
    });

    var reset = new Sequences.ResetConnection({});
    var query = protocol.query({sql: 'SELECT 1'});

    reset._connection = protocol._connection;
    protocol._enqueue(reset);

    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0][4], 0x03, 'active COM_QUERY is written first');

    query.end();

    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes[1][3], 0, 'reset starts a fresh packet sequence');
    assert.strictEqual(writes[1][4], 0x1f, 'payload is COM_RESET_CONNECTION');

    reset.end();
    assert.strictEqual(protocol._queue.length, 0);
  },

  'carries deadline and abort options through Sequence': function() {
    var controller = new AbortController();
    var reset = new Sequences.ResetConnection({
      operationTimeout : 125,
      signal           : controller.signal,
      timeout          : 50
    });

    assert.strictEqual(reset._operationTimeout, 125);
    assert.strictEqual(reset._timeout, 50);
    assert.strictEqual(reset._signalManagedByProtocol, true);
  }
});
