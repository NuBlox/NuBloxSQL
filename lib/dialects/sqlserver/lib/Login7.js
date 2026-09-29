'use strict';

var FIXED_LENGTH = 94;
var MAX_LENGTH = (128 * 1024) - 1;
var TDS_74 = 0x74000004;

function assertUInt32(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(name + ' must be an unsigned 32-bit integer');
  return value >>> 0;
}

function unicode(value, label, maxChars) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new TypeError(label + ' must be a string');
  if (value.length > maxChars) throw new RangeError(label + ' must be at most ' + maxChars + ' Unicode characters');
  if (value.indexOf('\0') !== -1) throw new TypeError(label + ' cannot contain NUL characters');
  return Buffer.from(value, 'utf16le');
}

function obfuscatePassword(value) {
  var bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ''), 'utf16le');
  for (var i = 0; i < bytes.length; i++) {
    var byte = bytes[i];
    bytes[i] = ((((byte << 4) & 0xf0) | ((byte >> 4) & 0x0f)) ^ 0xa5) & 0xff;
  }
  return bytes;
}

function writeOffsetLength(buffer, position, offset, characterLength) {
  if (offset > 0xffff) throw new RangeError('LOGIN7 variable data offset exceeds USHORT range');
  if (characterLength > 0xffff) throw new RangeError('LOGIN7 variable data length exceeds USHORT range');
  buffer.writeUInt16LE(offset, position);
  buffer.writeUInt16LE(characterLength, position + 2);
}

function encode(options) {
  options = options || {};
  if (options.integratedSecurity || options.sspi || options.federatedAuthentication) {
    throw new Error('NuBloxSQL SQL Server LOGIN7 foundation currently supports standard SQL authentication only');
  }

  var fields = {
    hostName: unicode(options.hostName || '', 'SQL Server hostName', 128),
    userName: unicode(options.userName || options.user || '', 'SQL Server userName', 128),
    password: unicode(options.password || '', 'SQL Server password', 128),
    appName: unicode(options.appName || 'NuBloxSQL', 'SQL Server appName', 128),
    serverName: unicode(options.serverName || options.host || '', 'SQL Server serverName', 128),
    clientInterfaceName: unicode(options.clientInterfaceName || 'NuBloxSQL', 'SQL Server clientInterfaceName', 128),
    language: unicode(options.language || '', 'SQL Server language', 128),
    database: unicode(options.database || '', 'SQL Server database', 128),
    attachDbFile: unicode(options.attachDbFile || '', 'SQL Server attachDbFile', 260),
    changePassword: unicode(options.changePassword || '', 'SQL Server changePassword', 128)
  };
  fields.password = obfuscatePassword(fields.password);
  fields.changePassword = obfuscatePassword(fields.changePassword);

  var ordered = [
    ['hostName', fields.hostName],
    ['userName', fields.userName],
    ['password', fields.password],
    ['appName', fields.appName],
    ['serverName', fields.serverName],
    ['clientInterfaceName', fields.clientInterfaceName],
    ['language', fields.language],
    ['database', fields.database],
    ['attachDbFile', fields.attachDbFile],
    ['changePassword', fields.changePassword]
  ];
  var variableLength = ordered.reduce(function (sum, item) { return sum + item[1].length; }, 0);
  var totalLength = FIXED_LENGTH + variableLength;
  if (totalLength > MAX_LENGTH) throw new RangeError('SQL Server LOGIN7 exceeds protocol maximum length');

  var buffer = Buffer.alloc(totalLength);
  buffer.writeUInt32LE(totalLength, 0);
  buffer.writeUInt32LE(assertUInt32(options.tdsVersion === undefined ? TDS_74 : options.tdsVersion, 'SQL Server TDS version'), 4);
  buffer.writeUInt32LE(assertUInt32(options.packetSize === undefined ? 4096 : options.packetSize, 'SQL Server packet size'), 8);
  buffer.writeUInt32LE(assertUInt32(options.clientProgramVersion === undefined ? 1 : options.clientProgramVersion, 'SQL Server client program version'), 12);
  buffer.writeUInt32LE(assertUInt32(options.clientPid === undefined ? process.pid : options.clientPid, 'SQL Server client PID'), 16);
  buffer.writeUInt32LE(assertUInt32(options.connectionId === undefined ? 0 : options.connectionId, 'SQL Server connection ID'), 20);

  buffer[24] = options.optionFlags1 === undefined ? 0xe0 : options.optionFlags1;
  buffer[25] = options.optionFlags2 === undefined ? 0x03 : options.optionFlags2;
  var typeFlags = options.typeFlags === undefined ? 0 : options.typeFlags;
  if (options.readOnlyIntent === true) typeFlags |= 0x20;
  buffer[26] = typeFlags;
  var optionFlags3 = options.optionFlags3 === undefined ? 0 : options.optionFlags3;
  if (fields.changePassword.length) optionFlags3 |= 0x01;
  buffer[27] = optionFlags3;
  buffer.writeInt32LE(options.clientTimeZone === undefined ? 0 : options.clientTimeZone, 28);
  buffer.writeUInt32LE(assertUInt32(options.clientLcid === undefined ? 0x00000409 : options.clientLcid, 'SQL Server client LCID'), 32);

  var current = FIXED_LENGTH;
  var pairPosition = 36;
  function pair(data, forceOffset) {
    var offset = forceOffset === undefined ? current : forceOffset;
    writeOffsetLength(buffer, pairPosition, offset, data.length / 2);
    pairPosition += 4;
    if (data.length) {
      data.copy(buffer, current);
      current += data.length;
    }
  }

  pair(fields.hostName, FIXED_LENGTH);
  pair(fields.userName);
  pair(fields.password);
  pair(fields.appName);
  pair(fields.serverName);
  writeOffsetLength(buffer, pairPosition, 0, 0); pairPosition += 4; // ibUnused/ibExtension
  pair(fields.clientInterfaceName);
  pair(fields.language);
  pair(fields.database);

  var clientId = options.clientId === undefined ? Buffer.alloc(6) : Buffer.from(options.clientId);
  if (clientId.length !== 6) throw new RangeError('SQL Server clientId must be exactly 6 bytes');
  clientId.copy(buffer, pairPosition); pairPosition += 6;

  writeOffsetLength(buffer, pairPosition, 0, 0); pairPosition += 4; // SSPI
  pair(fields.attachDbFile);
  pair(fields.changePassword);
  buffer.writeUInt32LE(0, pairPosition); // cbSSPILong

  return buffer;
}

function decodePasswordBytes(bytes) {
  bytes = Buffer.from(bytes);
  for (var i = 0; i < bytes.length; i++) {
    var byte = bytes[i] ^ 0xa5;
    bytes[i] = ((byte << 4) & 0xf0) | ((byte >> 4) & 0x0f);
  }
  return bytes;
}

exports.FIXED_LENGTH = FIXED_LENGTH;
exports.MAX_LENGTH = MAX_LENGTH;
exports.TDS_74 = TDS_74;
exports.encode = encode;
exports.obfuscatePassword = obfuscatePassword;
exports.decodePasswordBytes = decodePasswordBytes;
