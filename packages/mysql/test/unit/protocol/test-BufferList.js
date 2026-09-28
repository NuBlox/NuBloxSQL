'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var BufferList = require(path.resolve(common.lib, 'protocol/BufferList'));

test('BufferList', {
  'preserves FIFO order and byte size': function() {
    var list = new BufferList();

    list.push(Buffer.from('a'));
    list.push(Buffer.from('bc'));
    list.push(Buffer.from('def'));

    assert.strictEqual(list.size, 6);
    assert.strictEqual(list.shift().toString(), 'a');
    assert.strictEqual(list.size, 5);
    assert.strictEqual(list.shift().toString(), 'bc');
    assert.strictEqual(list.size, 3);
    assert.strictEqual(list.shift().toString(), 'def');
    assert.strictEqual(list.size, 0);
    assert.strictEqual(list.shift(), undefined);
  },

  'ignores empty buffers': function() {
    var list = new BufferList();

    list.push(Buffer.alloc(0));
    list.push(null);

    assert.strictEqual(list.size, 0);
    assert.strictEqual(list.shift(), undefined);
  },

  'remains correct across queue compaction': function() {
    var list = new BufferList();
    var total = 4096;

    for (var i = 0; i < total; i++) {
      list.push(Buffer.from([i & 0xff]));
    }

    for (var i = 0; i < total; i++) {
      var value = list.shift();
      assert.ok(value);
      assert.strictEqual(value[0], i & 0xff);
    }

    assert.strictEqual(list.size, 0);
    assert.strictEqual(list.shift(), undefined);
  }
});
