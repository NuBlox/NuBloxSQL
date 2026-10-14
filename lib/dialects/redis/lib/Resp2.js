'use strict';

// Bounded RESP2 codec. Redis requests are arrays of binary-safe bulk strings;
// bulk string replies remain Buffer values, never lossy UTF-8 conversions.
const CRLF = Buffer.from('\r\n');

class RedisReplyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RedisReplyError';
    this.code = /^[A-Z][A-Z0-9_]*\b/.exec(message)?.[0] || 'REDIS_ERROR';
  }
}
function numberLine(line, allowNull) {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(line)) throw new Error('Invalid RESP2 integer header');
  const n = Number(line);
  if (!Number.isSafeInteger(n) || n < (allowNull ? -1 : 0)) {
    throw new Error('RESP2 count outside bounded range');
  }
  return n;
}
function parse(buffer, options = {}) {
  const maxBytes = options.maxBytes || 8 * 1024 * 1024;
  const maxElements = options.maxElements || 4096;
  const maxDepth = options.maxDepth || 16;
  if (!Buffer.isBuffer(buffer)) throw new TypeError('RESP2 input must be a Buffer');
  if (buffer.length > maxBytes) throw new RangeError('RESP2 response exceeds byte budget');
  let elements = 0;
  function read(offset, depth) {
    if (depth > maxDepth) throw new RangeError('RESP2 nesting limit exceeded');
    if (offset >= buffer.length) return null;
    const type = String.fromCharCode(buffer[offset]);
    if (!'+-:$*'.includes(type)) throw new Error('Unsupported RESP2 reply type');
    const lineEnd = buffer.indexOf(CRLF, offset + 1);
    if (lineEnd < 0) {
      if (buffer.length - offset > 65536) throw new RangeError('RESP2 header too long');
      return null;
    }
    if (lineEnd - offset > 65536) throw new RangeError('RESP2 header too long');
    const line = buffer.toString('utf8', offset + 1, lineEnd);
    let pos = lineEnd + 2;
    if (type === '+') return {value:line, bytes:pos};
    if (type === '-') return {value:new RedisReplyError(line), bytes:pos};
    if (type === ':') {
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(line)) throw new Error('Invalid RESP2 integer');
      const n = BigInt(line);
      return {value:n >= BigInt(Number.MIN_SAFE_INTEGER) &&
        n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n, bytes:pos};
    }
    const length = numberLine(line, true);
    if (length === -1) return {value:null, bytes:pos};
    if (type === '$') {
      if (length > maxBytes) throw new RangeError('RESP2 bulk string exceeds byte budget');
      if (length + 2 > buffer.length - pos) return null;
      if (buffer[pos + length] !== 13 || buffer[pos + length + 1] !== 10) {
        throw new Error('Invalid RESP2 bulk terminator');
      }
      return {value:Buffer.from(buffer.subarray(pos, pos + length)), bytes:pos + length + 2};
    }
    if (length > maxElements || elements + length > maxElements) {
      throw new RangeError('RESP2 array element budget exceeded');
    }
    elements += length;
    const array = [];
    for (let i = 0; i < length; i++) {
      const part = read(pos, depth + 1);
      if (part === null) return null;
      array.push(part.value);
      pos = part.bytes;
    }
    return {value:array, bytes:pos};
  }
  return read(0, 0);
}
function encode(command, args = [], maxBytes = 1024 * 1024) {
  if (typeof command !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(command)) {
    throw new TypeError('Redis command must be a single ASCII command name');
  }
  if (!Array.isArray(args) || args.length > 1023) {
    throw new RangeError('Redis command arguments must be an array of at most 1023 entries');
  }
  const values = [command, ...args];
  const parts = [Buffer.from('*' + values.length + '\r\n')];
  let size = parts[0].length;
  for (const value of values) {
    if (typeof value !== 'string' && !Buffer.isBuffer(value) &&
        typeof value !== 'number' && typeof value !== 'bigint') {
      throw new TypeError('Redis arguments must be strings, Buffers or numbers');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Redis arguments must contain finite numbers');
    }
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    const header = Buffer.from('$' + data.length + '\r\n');
    size += header.length + data.length + 2;
    if (size > maxBytes) throw new RangeError('Redis request exceeds byte budget');
    parts.push(header, data, CRLF);
  }
  return Buffer.concat(parts, size);
}
module.exports = {RedisReplyError, parse, encode};
