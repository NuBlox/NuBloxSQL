'use strict';

var Buffer = require('safe-buffer').Buffer;

var MAX_GNO = (global.BigInt(1) << global.BigInt(63)) - global.BigInt(1);
var MAX_SIDS = 65536;
var MAX_INTERVALS = 1048576;
var UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var INTERVAL_PATTERN = /^(\d+)(?:-(\d+))?$/;

exports.parse = parse;
exports.encode = encode;

function parse(input) {
  if (typeof input !== 'string') {
    throw new TypeError('gtidSet must be a MySQL GTID set string');
  }

  input = input.trim();
  if (!input) {
    return [];
  }

  var components = input.split(',');

  if (components.length > MAX_SIDS) {
    throw limitError('GTID set SID count exceeds safety limit', components.length, MAX_SIDS);
  }

  var sets = new Array(components.length);
  var totalIntervals = 0;
  var seen = Object.create(null);

  for (var componentIndex = 0; componentIndex < components.length; componentIndex++) {
    var component = components[componentIndex].trim();
    var parts = component.split(':');
    var sidText = parts.shift();

    if (!UUID_PATTERN.test(sidText)) {
      throw new TypeError('GTID set contains an invalid SID UUID: ' + sidText);
    }

    sidText = sidText.toLowerCase();
    if (seen[sidText]) {
      throw new TypeError('GTID set contains duplicate SID entries: ' + sidText);
    }
    seen[sidText] = true;

    if (parts.length === 0) {
      throw new TypeError('GTID set SID has no intervals: ' + sidText);
    }

    var intervals = new Array(parts.length);
    totalIntervals += parts.length;

    if (totalIntervals > MAX_INTERVALS) {
      throw limitError('GTID set interval count exceeds safety limit', totalIntervals, MAX_INTERVALS);
    }

    var previousEnd = global.BigInt(0);

    for (var intervalIndex = 0; intervalIndex < parts.length; intervalIndex++) {
      var token = parts[intervalIndex].trim();
      var match = INTERVAL_PATTERN.exec(token);

      if (!match) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
          throw new TypeError('Tagged GTIDs are not yet supported by COM_BINLOG_DUMP_GTID');
        }
        throw new TypeError('GTID set contains an invalid interval: ' + token);
      }

      var start = global.BigInt(match[1]);
      var inclusiveEnd = match[2] === undefined ? start : global.BigInt(match[2]);

      if (start < global.BigInt(1) || inclusiveEnd < start || inclusiveEnd > MAX_GNO) {
        throw new RangeError('GTID interval must be within 1..' + MAX_GNO.toString() + ' and end >= start');
      }

      var end = inclusiveEnd + global.BigInt(1);

      if (start < previousEnd) {
        throw new TypeError('GTID intervals must be ordered and non-overlapping for SID ' + sidText);
      }

      previousEnd = end;
      intervals[intervalIndex] = {
        start : start,
        end   : end
      };
    }

    sets[componentIndex] = {
      sidText   : sidText,
      sid       : uuidToBuffer(sidText),
      intervals : intervals
    };
  }

  return sets;
}

function encode(input) {
  var sets = parse(input);
  var size = 8;

  for (var sidIndex = 0; sidIndex < sets.length; sidIndex++) {
    size += 16 + 8 + sets[sidIndex].intervals.length * 16;
  }

  var buffer = Buffer.allocUnsafe(size);
  var offset = 0;

  writeUInt64LE(buffer, global.BigInt(sets.length), offset);
  offset += 8;

  for (var setIndex = 0; setIndex < sets.length; setIndex++) {
    var set = sets[setIndex];
    set.sid.copy(buffer, offset);
    offset += 16;

    writeUInt64LE(buffer, global.BigInt(set.intervals.length), offset);
    offset += 8;

    for (var intervalIndex = 0; intervalIndex < set.intervals.length; intervalIndex++) {
      var interval = set.intervals[intervalIndex];
      writeUInt64LE(buffer, interval.start, offset);
      writeUInt64LE(buffer, interval.end, offset + 8);
      offset += 16;
    }
  }

  return buffer;
}

function uuidToBuffer(value) {
  return Buffer.from(value.replace(/-/g, ''), 'hex');
}

function writeUInt64LE(buffer, value, offset) {
  for (var index = 0; index < 8; index++) {
    buffer[offset + index] = Number((value >> global.BigInt(index * 8)) & global.BigInt(0xff));
  }
}

function limitError(message, value, limit) {
  var error = new RangeError(message + ': ' + value + ' > ' + limit);
  error.code = 'BINLOG_GTID_SET_TOO_LARGE';
  error.value = value;
  error.limit = limit;
  return error;
}
