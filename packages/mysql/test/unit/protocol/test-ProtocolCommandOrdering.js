'use strict';

var assert = require('assert');
var common = require('../../common');
var test = require('utest');

var Protocol = require(common.lib + '/protocol/Protocol');

test('Protocol command ordering', {
  'serializes commands and resets sequence ids at command boundaries': function() {
    var protocol = new Protocol({
      config     : {},
      connection : {}
    });
    var writes = [];

    protocol.on('data', function (buffer) {
      writes.push(Buffer.from(buffer));
    });

    var first = protocol.query({sql: 'SELECT 1'});
    var second = protocol.query({sql: 'SELECT 2'});

    assert.strictEqual(protocol._queue.length, 2);
    assert.strictEqual(writes.length, 1, 'only the active command may be written');
    assert.strictEqual(writes[0][3], 0, 'first command starts with packet sequence id 0');
    assert.strictEqual(writes[0][4], 0x03, 'first payload is COM_QUERY');
    assert.strictEqual(writes[0].slice(5).toString(), 'SELECT 1');

    first.end();

    assert.strictEqual(protocol._queue.length, 1);
    assert.strictEqual(protocol._queue[0], second);
    assert.strictEqual(writes.length, 2, 'next command starts only after the active command ends');
    assert.strictEqual(writes[1][3], 0, 'next command resets packet sequence id to 0');
    assert.strictEqual(writes[1][4], 0x03, 'second payload is COM_QUERY');
    assert.strictEqual(writes[1].slice(5).toString(), 'SELECT 2');

    second.end();
    assert.strictEqual(protocol._queue.length, 0);
  }
});
