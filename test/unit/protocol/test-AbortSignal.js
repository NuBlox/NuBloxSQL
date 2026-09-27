'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var Protocol = require(path.resolve(common.lib, 'protocol/Protocol'));

function createProtocol() {
  return new Protocol({
    config     : {},
    connection : {state: 'authenticated'}
  });
}

test('AbortSignal protocol cancellation', {
  'pre-aborted query never starts and is non-fatal': function(done) {
    var protocol = createProtocol();
    var controller = new AbortController();
    var emitted = 0;

    controller.abort('already cancelled');
    protocol.on('data', function() { emitted++; });

    protocol.query({sql: 'SELECT 1', signal: controller.signal}, function(error) {
      assert.ok(error);
      assert.strictEqual(error.name, 'AbortError');
      assert.strictEqual(error.code, 'ABORT_ERR');
      assert.strictEqual(error.fatal, false);
      assert.strictEqual(error.cause, 'already cancelled');
      assert.strictEqual(emitted, 0);

      process.nextTick(function() {
        assert.strictEqual(protocol._queue.length, 0);
        assert.strictEqual(protocol._fatalError, null);
        done();
      });
    });
  },

  'queued cancellation removes only the queued query': function(done) {
    var protocol = createProtocol();
    var controller = new AbortController();
    var first = protocol.query({sql: 'SELECT SLEEP(60)'}, function() {});
    var second = protocol.query({sql: 'SELECT 2', signal: controller.signal}, function(error) {
      assert.ok(error);
      assert.strictEqual(error.name, 'AbortError');
      assert.strictEqual(error.code, 'ABORT_ERR');
      assert.strictEqual(error.fatal, false);
      assert.strictEqual(second._started, false);

      process.nextTick(function() {
        assert.strictEqual(protocol._queue.length, 1);
        assert.strictEqual(protocol._queue[0], first);
        assert.strictEqual(protocol._fatalError, null);
        done();
      });
    });

    assert.strictEqual(first._started, true);
    assert.strictEqual(second._started, false);
    controller.abort();
  },

  'active cancellation is fatal to preserve protocol synchronization': function(done) {
    var protocol = createProtocol();
    var controller = new AbortController();
    var ended = false;

    protocol.on('end', function() { ended = true; });

    protocol.query({sql: 'SELECT SLEEP(60)', signal: controller.signal}, function(error) {
      assert.ok(error);
      assert.strictEqual(error.name, 'AbortError');
      assert.strictEqual(error.code, 'ABORT_ERR');
      assert.strictEqual(error.fatal, true);
      assert.strictEqual(protocol._fatalError, error);
      assert.strictEqual(ended, true);
      done();
    });

    controller.abort('stop active query');
  },

  'first of multiple signals wins': function(done) {
    var protocol = createProtocol();
    var first = new AbortController();
    var second = new AbortController();

    protocol.query({
      sql     : 'SELECT 1',
      signals : [first.signal, second.signal]
    }, function(error) {
      assert.ok(error);
      assert.strictEqual(error.code, 'ABORT_ERR');
      assert.strictEqual(error.cause, 'second signal');
      done();
    });

    second.abort('second signal');
  },

  'rejects malformed signals': function() {
    assert.throws(function() {
      return createProtocol().query({sql: 'SELECT 1', signal: {aborted: false}});
    }, /signal must be an AbortSignal-like object/);

    assert.throws(function() {
      return createProtocol().query({sql: 'SELECT 1', signals: {}});
    }, /signals must be an array/);
  }
});
