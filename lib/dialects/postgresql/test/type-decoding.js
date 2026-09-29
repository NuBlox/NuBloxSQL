'use strict';

var assert = require('assert');
var types = require('../lib/TypeDecoder');

function field(oid) { return { dataTypeOid: oid }; }
function value(oid, text) { return types.decodeText(field(oid), text === null ? null : Buffer.from(text)); }

assert.strictEqual(value(16, 't'), true);
assert.strictEqual(value(16, 'f'), false);
assert.strictEqual(value(21, '42'), 42);
assert.strictEqual(value(23, '-42'), -42);
assert.strictEqual(value(26, '1234'), 1234);
assert.strictEqual(value(20, '9223372036854775807'), 9223372036854775807n);
assert.strictEqual(value(1700, '12345678901234567890.123456789'), '12345678901234567890.123456789');
assert.strictEqual(value(701, 'Infinity'), Infinity);
assert.strictEqual(value(701, '-Infinity'), -Infinity);
assert.ok(Number.isNaN(value(701, 'NaN')));
assert.deepStrictEqual(value(114, '{"ok":true}'), { ok: true });
assert.deepStrictEqual(value(3802, '[1,2,3]'), [1, 2, 3]);
assert.deepStrictEqual(value(17, '\\x0001ff'), Buffer.from([0, 1, 255]));
assert.strictEqual(value(1082, '2026-09-28'), '2026-09-28');
assert.strictEqual(value(1114, '2026-09-28 12:34:56'), '2026-09-28 12:34:56');
var timestamp = value(1184, '2026-09-28 12:34:56+00');
assert.ok(timestamp instanceof Date);
assert.strictEqual(timestamp.toISOString(), '2026-09-28T12:34:56.000Z');
assert.strictEqual(value(1184, 'infinity'), 'infinity');
assert.strictEqual(value(2950, '550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
assert.strictEqual(value(999999, 'opaque'), 'opaque');
assert.strictEqual(value(23, null), null);

console.log('ok - PostgreSQL deterministic type decoding');
