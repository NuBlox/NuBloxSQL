'use strict';

var Buffer = require('safe-buffer').Buffer;

var LOGICAL_TIMESTAMP_TYPECODE = 2;
var MAX_PREVIOUS_GTID_SIDS = 65536;
var MAX_PREVIOUS_GTID_INTERVALS = 1048576;
var UUID_BYTES = 16;

exports.decodeGtidEvent = function decodeGtidEvent(event, payload, anonymous) {
  requireBytes(payload, 25, 'GTID event fixed body');

  event.gtidFlags = payload[0];
  event.sid = payload.slice(1, 1 + UUID_BYTES);
  event.sidText = formatUuid(event.sid);
  event.gno = readUInt64LE(payload, 17);
  event.gtid = anonymous
    ? null
    : event.sidText + ':' + event.gno.toString();
  event.anonymous = anonymous === true;

  var offset = 25;

  if (offset === payload.length) {
    return;
  }

  event.logicalTimestampType = payload[offset++];

  if (event.logicalTimestampType !== LOGICAL_TIMESTAMP_TYPECODE) {
    event.gtidExtension = payload.slice(offset);
    return;
  }

  requireBytesFrom(payload, offset, 16, 'GTID logical timestamp fields');
  event.lastCommitted = readUInt64LE(payload, offset);
  offset += 8;
  event.sequenceNumber = readUInt64LE(payload, offset);
  offset += 8;

  // Newer MySQL releases append commit timestamps, transaction length and
  // server-version metadata. Preserve the bounded extension until those
  // fields are promoted to their own compatibility tranche.
  if (offset < payload.length) {
    event.gtidExtension = payload.slice(offset);
  }
};

exports.decodePreviousGtidsEvent = function decodePreviousGtidsEvent(event, payload) {
  requireBytes(payload, 8, 'PREVIOUS_GTIDS_LOG_EVENT SID count');

  var offset = 0;
  var sidCountValue = readUInt64LE(payload, offset);
  offset += 8;

  if (sidCountValue > global.BigInt(MAX_PREVIOUS_GTID_SIDS)) {
    var sidLimitError = decodeError(
      'PREVIOUS_GTIDS_LOG_EVENT SID count exceeds safety limit',
      'BINLOG_GTID_SET_TOO_LARGE'
    );
    sidLimitError.sidCount = sidCountValue;
    sidLimitError.limit = MAX_PREVIOUS_GTID_SIDS;
    throw sidLimitError;
  }

  var sidCount = Number(sidCountValue);
  var sets = new Array(sidCount);
  var totalIntervals = 0;

  for (var sidIndex = 0; sidIndex < sidCount; sidIndex++) {
    requireBytesFrom(payload, offset, UUID_BYTES + 8, 'PREVIOUS_GTIDS_LOG_EVENT SID entry');

    var sid = payload.slice(offset, offset + UUID_BYTES);
    offset += UUID_BYTES;

    var intervalCountValue = readUInt64LE(payload, offset);
    offset += 8;

    if (intervalCountValue > global.BigInt(MAX_PREVIOUS_GTID_INTERVALS)) {
      throw intervalLimitError(intervalCountValue, totalIntervals);
    }

    var intervalCount = Number(intervalCountValue);
    totalIntervals += intervalCount;

    if (totalIntervals > MAX_PREVIOUS_GTID_INTERVALS) {
      throw intervalLimitError(global.BigInt(intervalCount), totalIntervals);
    }

    if (intervalCount > Math.floor((payload.length - offset) / 16)) {
      throw decodeError(
        'PREVIOUS_GTIDS_LOG_EVENT interval list is truncated',
        'BINLOG_EVENT_TRUNCATED'
      );
    }

    var intervals = new Array(intervalCount);

    for (var intervalIndex = 0; intervalIndex < intervalCount; intervalIndex++) {
      var start = readUInt64LE(payload, offset);
      var end = readUInt64LE(payload, offset + 8);
      offset += 16;

      if (start === global.BigInt(0) || end <= start) {
        throw decodeError(
          'PREVIOUS_GTIDS_LOG_EVENT contains an invalid GTID interval',
          'BINLOG_GTID_SET_INVALID_INTERVAL'
        );
      }

      intervals[intervalIndex] = {
        start : start,
        end   : end
      };
    }

    sets[sidIndex] = {
      sid       : sid,
      sidText   : formatUuid(sid),
      intervals : intervals
    };
  }

  if (offset !== payload.length) {
    event.gtidSetExtension = payload.slice(offset);
  }

  event.previousGtids = sets;
  event.previousGtidSidCount = sidCount;
  event.previousGtidIntervalCount = totalIntervals;
};

function intervalLimitError(intervalCount, totalIntervals) {
  var error = decodeError(
    'PREVIOUS_GTIDS_LOG_EVENT interval count exceeds safety limit',
    'BINLOG_GTID_SET_TOO_LARGE'
  );
  error.intervalCount = intervalCount;
  error.totalIntervals = totalIntervals;
  error.limit = MAX_PREVIOUS_GTID_INTERVALS;
  return error;
}

function formatUuid(buffer) {
  requireBytes(buffer, UUID_BYTES, 'GTID SID');

  var hex = buffer.toString('hex');
  return hex.slice(0, 8) + '-' +
    hex.slice(8, 12) + '-' +
    hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' +
    hex.slice(20, 32);
}

function readUInt64LE(buffer, offset) {
  requireBytesFrom(buffer, offset, 8, '64-bit GTID integer');

  var value = global.BigInt(0);
  for (var index = 0; index < 8; index++) {
    value |= global.BigInt(buffer[offset + index]) << global.BigInt(index * 8);
  }

  return value;
}

function requireBytes(buffer, bytes, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes) {
    throw decodeError(label + ' is truncated', 'BINLOG_EVENT_TRUNCATED');
  }
}

function requireBytesFrom(buffer, offset, bytes, label) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + bytes > buffer.length) {
    throw decodeError(label + ' is truncated', 'BINLOG_EVENT_TRUNCATED');
  }
}

function decodeError(message, code) {
  var error = new Error(message);
  error.code = code;
  return error;
}
