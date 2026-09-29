'use strict';

var assert = require('assert');
var protocol = require('..').protocol;

var scramble = Buffer.from('12345678901234567890', 'ascii');

function testNativeVector() {
  var token = protocol.mysqlNativePassword('secret', scramble);
  assert.strictEqual(token.toString('hex'), '0f8b9033e0897c0a8338ebe3dea9010dda47ab56');
}

function testCachingSha2Vector() {
  var token = protocol.cachingSha2Password('secret', scramble);
  assert.strictEqual(token.toString('hex'), '51ecd6dedbd34d5445c0a190d4f51acf0d23b94db66c91f3f789faa9193751cd');
}

function testEmptyPassword() {
  assert.strictEqual(protocol.mysqlNativePassword('', scramble).length, 0);
  assert.strictEqual(protocol.cachingSha2Password('', scramble).length, 0);
  assert.deepStrictEqual(Array.from(protocol.cleartextPassword('')), [0]);
}

function testRsaScrambleTransform() {
  var transformed = protocol.scramblePasswordForRsa('abc', Buffer.from([1, 2]));
  assert.deepStrictEqual(Array.from(transformed), [96, 96, 98, 2]);
}

[testNativeVector, testCachingSha2Vector, testEmptyPassword, testRsaScrambleTransform].forEach(function (test) {
  test();
  process.stdout.write('ok - ' + test.name + '\n');
});
