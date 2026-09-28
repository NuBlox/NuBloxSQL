'use strict';

var TABLE = createTable();

exports.compute = function compute(buffer, end, maskFormatDescriptionInUseFlag) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('CRC32 input must be a Buffer');
  }

  if (!Number.isSafeInteger(end) || end < 0 || end > buffer.length) {
    throw new RangeError('CRC32 end must be within the input buffer');
  }

  var crc = 0xffffffff;

  for (var index = 0; index < end; index++) {
    var value = buffer[index];

    // MySQL may clear LOG_EVENT_BINLOG_IN_USE_F after the FDE was written.
    // The checksum is defined over the event with that mutable flag cleared.
    if (maskFormatDescriptionInUseFlag && index === 17) {
      value &= 0xfe;
    }

    crc = TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

function createTable() {
  var table = new Array(256);

  for (var index = 0; index < 256; index++) {
    var value = index;

    for (var bit = 0; bit < 8; bit++) {
      value = (value & 1)
        ? (0xedb88320 ^ (value >>> 1))
        : (value >>> 1);
    }

    table[index] = value >>> 0;
  }

  return table;
}
