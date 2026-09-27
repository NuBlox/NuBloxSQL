'use strict';

var Types = require('./constants/types');

exports.assertColumnCount = function assertColumnCount(connection, fieldCount) {
  var limit = connection && connection.config && connection.config.maxResultSetColumns;

  if (!limit || fieldCount <= limit) {
    return;
  }

  throw limitError(
    'Result set column count exceeds maxResultSetColumns: ' + fieldCount + ' > ' + limit,
    'PROTOCOL_RESULTSET_COLUMNS_TOO_LARGE',
    'columnCount',
    fieldCount,
    limit
  );
};

exports.assertTextFieldSize = function assertTextFieldSize(connection, parser) {
  assertLengthCodedFieldSize(connection, parser);
};

exports.assertBinaryFieldSize = function assertBinaryFieldSize(connection, field, parser) {
  if (!isLengthCodedBinaryType(field.type)) {
    return;
  }

  assertLengthCodedFieldSize(connection, parser);
};

exports.noteMetadataPacket = function noteMetadataPacket(connection, resultSet, packetLength) {
  if (!resultSet || !packetLength) {
    return;
  }

  resultSet.metadataBytes = (resultSet.metadataBytes || 0) + packetLength;

  var limit = connection && connection.config && connection.config.maxMetadataSize;
  if (!limit || resultSet.metadataBytes <= limit) {
    return;
  }

  throw limitError(
    'Result set metadata exceeds maxMetadataSize: ' + resultSet.metadataBytes + ' > ' + limit,
    'PROTOCOL_RESULTSET_METADATA_TOO_LARGE',
    'metadataSize',
    resultSet.metadataBytes,
    limit
  );
};

exports.noteRowPacket = function noteRowPacket(connection, resultSet, packetLength, buffered) {
  if (!resultSet || !packetLength) {
    return;
  }

  var config = connection && connection.config;
  var rowLimit = config && config.maxRowSize;

  if (rowLimit && packetLength > rowLimit) {
    throw limitError(
      'Result row exceeds maxRowSize: ' + packetLength + ' > ' + rowLimit,
      'PROTOCOL_RESULTSET_ROW_TOO_LARGE',
      'rowSize',
      packetLength,
      rowLimit
    );
  }

  if (!buffered) {
    return;
  }

  resultSet.bufferedRows = (resultSet.bufferedRows || 0) + 1;
  resultSet.bufferedBytes = (resultSet.bufferedBytes || 0) + packetLength;

  var rowCountLimit = config && config.maxBufferedRows;
  if (rowCountLimit && resultSet.bufferedRows > rowCountLimit) {
    throw limitError(
      'Buffered result row count exceeds maxBufferedRows: ' + resultSet.bufferedRows + ' > ' + rowCountLimit,
      'PROTOCOL_RESULTSET_ROWS_TOO_LARGE',
      'rowCount',
      resultSet.bufferedRows,
      rowCountLimit
    );
  }

  var resultSizeLimit = config && config.maxResultSetSize;
  if (resultSizeLimit && resultSet.bufferedBytes > resultSizeLimit) {
    throw limitError(
      'Buffered result payload exceeds maxResultSetSize: ' + resultSet.bufferedBytes + ' > ' + resultSizeLimit,
      'PROTOCOL_RESULTSET_SIZE_TOO_LARGE',
      'resultSetSize',
      resultSet.bufferedBytes,
      resultSizeLimit
    );
  }
};

function assertLengthCodedFieldSize(connection, parser) {
  var limit = connection && connection.config && connection.config.maxFieldSize;
  if (!limit) {
    return;
  }

  var fieldLength = peekLengthCodedLength(parser);
  if (fieldLength === null) {
    return;
  }

  var exceedsLimit = typeof fieldLength === 'bigint'
    ? fieldLength > global.BigInt(limit)
    : fieldLength > limit;

  if (!exceedsLimit) {
    return;
  }

  var reportedLength = typeof fieldLength === 'bigint' && fieldLength > global.BigInt(Number.MAX_SAFE_INTEGER)
    ? fieldLength.toString()
    : Number(fieldLength);

  throw limitError(
    'Result field exceeds maxFieldSize: ' + reportedLength + ' > ' + limit,
    'PROTOCOL_RESULTSET_FIELD_TOO_LARGE',
    'fieldSize',
    reportedLength,
    limit
  );
}

function peekLengthCodedLength(parser) {
  var first = parser.peak(0);

  if (first <= 250) {
    return first;
  }

  if (first === 251) {
    return null;
  }

  if (first === 252) {
    return parser.peak(1) | (parser.peak(2) << 8);
  }

  if (first === 253) {
    return parser.peak(1) |
      (parser.peak(2) << 8) |
      (parser.peak(3) << 16);
  }

  if (first === 254) {
    var value = global.BigInt(0);

    for (var i = 0; i < 8; i++) {
      value |= global.BigInt(parser.peak(i + 1)) << global.BigInt(i * 8);
    }

    return value;
  }

  return 0;
}

function isLengthCodedBinaryType(type) {
  switch (type) {
    case Types.TINY:
    case Types.SHORT:
    case Types.YEAR:
    case Types.LONG:
    case Types.INT24:
    case Types.FLOAT:
    case Types.DOUBLE:
    case Types.LONGLONG:
    case Types.DATE:
    case Types.NEWDATE:
    case Types.DATETIME:
    case Types.DATETIME2:
    case Types.TIMESTAMP:
    case Types.TIMESTAMP2:
    case Types.TIME:
    case Types.TIME2:
      return false;
    default:
      return true;
  }
}

function limitError(message, code, property, value, limit) {
  var error = new Error(message);
  error.code = code;
  error.fatal = true;
  error[property] = value;
  error.limit = limit;
  return error;
}
