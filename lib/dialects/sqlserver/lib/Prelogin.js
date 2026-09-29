'use strict';

var TOKENS = Object.freeze({
  VERSION: 0x00,
  ENCRYPTION: 0x01,
  INSTOPT: 0x02,
  THREADID: 0x03,
  MARS: 0x04,
  TRACEID: 0x05,
  FEDAUTHREQUIRED: 0x06,
  NONCEOPT: 0x07,
  TERMINATOR: 0xff
});

var ENCRYPTION = Object.freeze({
  OFF: 0x00,
  ON: 0x01,
  NOT_SUPPORTED: 0x02,
  REQUIRED: 0x03
});

function versionBytes(version) {
  version = version || {};
  var major = version.major === undefined ? 0 : version.major;
  var minor = version.minor === undefined ? 0 : version.minor;
  var build = version.build === undefined ? 0 : version.build;
  var subbuild = version.subbuild === undefined ? 0 : version.subbuild;
  if (!Number.isInteger(major) || major < 0 || major > 255) throw new RangeError('SQL Server PRELOGIN version.major must be an unsigned byte');
  if (!Number.isInteger(minor) || minor < 0 || minor > 255) throw new RangeError('SQL Server PRELOGIN version.minor must be an unsigned byte');
  if (!Number.isInteger(build) || build < 0 || build > 0xffff) throw new RangeError('SQL Server PRELOGIN version.build must be an unsigned 16-bit integer');
  if (!Number.isInteger(subbuild) || subbuild < 0 || subbuild > 0xffff) throw new RangeError('SQL Server PRELOGIN version.subbuild must be an unsigned 16-bit integer');
  var out = Buffer.allocUnsafe(6);
  out[0] = major;
  out[1] = minor;
  out.writeUInt16BE(build, 2);
  out.writeUInt16BE(subbuild, 4);
  return out;
}

function threadIdBytes(threadId) {
  if (!Number.isInteger(threadId) || threadId < 0 || threadId > 0xffffffff) throw new RangeError('SQL Server PRELOGIN threadId must be an unsigned 32-bit integer');
  var out = Buffer.allocUnsafe(4);
  out.writeUInt32LE(threadId >>> 0, 0);
  return out;
}

function normalizeInstance(instance) {
  if (instance === undefined || instance === null || instance === '') return Buffer.from([0]);
  if (typeof instance !== 'string') throw new TypeError('SQL Server instance name must be a string');
  if (instance.indexOf('\0') !== -1) throw new TypeError('SQL Server instance name cannot contain NUL bytes');
  return Buffer.concat([Buffer.from(instance, 'ascii'), Buffer.from([0])]);
}

function encode(options) {
  options = options || {};
  var encryption = options.encryption === undefined ? ENCRYPTION.ON : options.encryption;
  if (!Object.values(ENCRYPTION).includes(encryption)) throw new RangeError('Invalid SQL Server PRELOGIN encryption setting');
  var mars = options.mars === true ? 1 : 0;
  var entries = [
    { token: TOKENS.VERSION, data: versionBytes(options.version) },
    { token: TOKENS.ENCRYPTION, data: Buffer.from([encryption]) },
    { token: TOKENS.INSTOPT, data: normalizeInstance(options.instance) },
    { token: TOKENS.THREADID, data: threadIdBytes(options.threadId === undefined ? 0 : options.threadId) },
    { token: TOKENS.MARS, data: Buffer.from([mars]) }
  ];
  if (options.fedAuthRequired !== undefined) entries.push({ token: TOKENS.FEDAUTHREQUIRED, data: Buffer.from([options.fedAuthRequired ? 1 : 0]) });
  if (options.nonce !== undefined) {
    var nonce = Buffer.from(options.nonce);
    if (nonce.length !== 32) throw new RangeError('SQL Server PRELOGIN nonce must be exactly 32 bytes');
    entries.push({ token: TOKENS.NONCEOPT, data: nonce });
  }

  var tableLength = (entries.length * 5) + 1;
  var totalDataLength = entries.reduce(function (sum, entry) { return sum + entry.data.length; }, 0);
  var out = Buffer.allocUnsafe(tableLength + totalDataLength);
  var tableOffset = 0;
  var dataOffset = tableLength;
  entries.forEach(function (entry) {
    out[tableOffset++] = entry.token;
    out.writeUInt16BE(dataOffset, tableOffset); tableOffset += 2;
    out.writeUInt16BE(entry.data.length, tableOffset); tableOffset += 2;
    entry.data.copy(out, dataOffset);
    dataOffset += entry.data.length;
  });
  out[tableOffset] = TOKENS.TERMINATOR;
  return out;
}

function decode(payload) {
  payload = Buffer.from(payload);
  var entries = [];
  var offset = 0;
  while (true) {
    if (offset >= payload.length) throw new RangeError('SQL Server PRELOGIN option table is missing terminator');
    var token = payload[offset++];
    if (token === TOKENS.TERMINATOR) break;
    if (offset + 4 > payload.length) throw new RangeError('Incomplete SQL Server PRELOGIN option entry');
    var dataOffset = payload.readUInt16BE(offset); offset += 2;
    var dataLength = payload.readUInt16BE(offset); offset += 2;
    if (dataOffset + dataLength > payload.length) throw new RangeError('SQL Server PRELOGIN option points outside payload');
    entries.push(Object.freeze({ token: token, offset: dataOffset, length: dataLength, data: payload.subarray(dataOffset, dataOffset + dataLength) }));
  }
  if (!entries.length || entries[0].token !== TOKENS.VERSION) throw new RangeError('SQL Server PRELOGIN VERSION must be the first option');
  var byToken = Object.create(null);
  entries.forEach(function (entry) { byToken[entry.token] = entry; });
  return Object.freeze({
    entries: Object.freeze(entries),
    version: byToken[TOKENS.VERSION] ? byToken[TOKENS.VERSION].data : null,
    encryption: byToken[TOKENS.ENCRYPTION] && byToken[TOKENS.ENCRYPTION].length ? byToken[TOKENS.ENCRYPTION].data[0] : null,
    instance: byToken[TOKENS.INSTOPT] ? byToken[TOKENS.INSTOPT].data : null,
    threadId: byToken[TOKENS.THREADID] && byToken[TOKENS.THREADID].length === 4 ? byToken[TOKENS.THREADID].data.readUInt32LE(0) : null,
    mars: byToken[TOKENS.MARS] && byToken[TOKENS.MARS].length ? byToken[TOKENS.MARS].data[0] === 1 : null,
    fedAuthRequired: byToken[TOKENS.FEDAUTHREQUIRED] && byToken[TOKENS.FEDAUTHREQUIRED].length ? byToken[TOKENS.FEDAUTHREQUIRED].data[0] === 1 : null,
    nonce: byToken[TOKENS.NONCEOPT] ? byToken[TOKENS.NONCEOPT].data : null
  });
}

exports.TOKENS = TOKENS;
exports.ENCRYPTION = ENCRYPTION;
exports.versionBytes = versionBytes;
exports.encode = encode;
exports.decode = decode;
