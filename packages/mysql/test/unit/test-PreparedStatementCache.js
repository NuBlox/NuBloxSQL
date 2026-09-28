'use strict';

var assert = require('assert');
var PreparedStatementCache = require('../../lib/PreparedStatementCache');

var cache = new PreparedStatementCache(2);
var first = {id: 1, sql: 'SELECT 1'};
var second = {id: 2, sql: 'SELECT 2'};
var third = {id: 3, sql: 'SELECT 3'};

assert.strictEqual(cache.get(first.sql), null);
cache.notePrepare();
assert.deepStrictEqual(cache.set(first.sql, first), []);
assert.strictEqual(cache.get(first.sql), first);

cache.notePrepare();
cache.set(second.sql, second);
assert.strictEqual(cache.stats().size, 2);

// first was just touched, so second becomes the least-recently-used entry.
assert.strictEqual(cache.get(first.sql), first);
cache.notePrepare();
var removed = cache.set(third.sql, third);
assert.deepStrictEqual(removed, [second]);
assert.strictEqual(cache.get(second.sql), null);
assert.strictEqual(cache.get(first.sql), first);
assert.strictEqual(cache.get(third.sql), third);

var stats = cache.stats();
assert.strictEqual(stats.limit, 2);
assert.strictEqual(stats.size, 2);
assert.strictEqual(stats.prepares, 3);
assert.strictEqual(stats.evictions, 1);
assert.ok(stats.hits >= 3);
assert.ok(stats.misses >= 2);
assert.ok(stats.hitRate > 0 && stats.hitRate < 1);

assert.strictEqual(cache.delete(first.sql), first);
assert.strictEqual(cache.stats().size, 1);
assert.strictEqual(cache.clear().length, 1);
assert.strictEqual(cache.stats().size, 0);

cache.noteReprepare();
assert.strictEqual(cache.stats().reprepares, 1);

var disabled = new PreparedStatementCache(0);
assert.strictEqual(disabled.get('SELECT 1'), null);
assert.deepStrictEqual(disabled.set('SELECT 1', first), []);
assert.strictEqual(disabled.stats().size, 0);
assert.strictEqual(disabled.stats().misses, 1);
