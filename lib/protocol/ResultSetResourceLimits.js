'use strict';

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

function limitError(message, code, property, value, limit) {
  var error = new Error(message);
  error.code = code;
  error.fatal = true;
  error[property] = value;
  error.limit = limit;
  return error;
}
