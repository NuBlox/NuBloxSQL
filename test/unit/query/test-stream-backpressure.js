'use strict';

var assert = require('assert');
var Diagnostics = require('diagnostics_channel');
var path = require('path');
var common = require('../../common');
var test = require('utest');

var Query = require(path.resolve(common.lib, 'protocol/sequences/Query'));
var BackpressureChannel = Diagnostics.channel('nublox.mysql.stream.backpressure');

test('Query stream backpressure', {
  'uses native object-mode high-water marks and pauses at the threshold': function () {
    var pauses = 0;
    var resumes = 0;
    var events = [];
    var listener = function listener(event) {
      events.push(event);
    };
    var query = new Query({sql: 'SELECT id FROM stream'});

    query._connection = {
      threadId : 42,
      pause    : function () { pauses++; },
      resume   : function () { resumes++; }
    };

    BackpressureChannel.subscribe(listener);

    try {
      var stream = query.stream({highWaterMark: 1});

      assert.strictEqual(stream.readableObjectMode, true);
      assert.strictEqual(stream.readableHighWaterMark, 1);

      query.emit('result', {id: 1}, 0);
      assert.strictEqual(pauses, 1);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].action, 'pause');
      assert.strictEqual(events[0].highWaterMark, 1);
      assert.strictEqual(events[0].threadId, 42);
      assert.strictEqual(events[0].sql, 'SELECT id FROM stream');

      assert.deepStrictEqual(stream.read(), {id: 1});
      assert.ok(resumes >= 1);
      assert.strictEqual(events[1].action, 'resume');
    } finally {
      BackpressureChannel.unsubscribe(listener);
    }
  },

  'does not mutate caller stream options': function () {
    var query = new Query({sql: 'SELECT 1'});
    var options = {highWaterMark: 4};
    var stream = query.stream(options);

    assert.deepStrictEqual(options, {highWaterMark: 4});
    assert.strictEqual(stream.readableHighWaterMark, 4);
    assert.strictEqual(stream.readableObjectMode, true);
  },

  'supports zero high-water mark for immediate backpressure': function () {
    var query = new Query({sql: 'SELECT 1'});
    var stream = query.stream({highWaterMark: 0});

    assert.strictEqual(stream.readableHighWaterMark, 0);
  },

  'rejects invalid high-water marks deterministically': function () {
    assert.throws(function () {
      return new Query({sql: 'SELECT 1'}).stream({highWaterMark: -1});
    }, /non-negative integer/);

    assert.throws(function () {
      return new Query({sql: 'SELECT 1'}).stream({highWaterMark: 1.5});
    }, /non-negative integer/);
  }
});
