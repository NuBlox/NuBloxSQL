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

function limitError(message, code, property, value, limit) {
  var error = new Error(message);
  error.code = code;
  error.fatal = true;
  error[property] = value;
  error.limit = limit;
  return error;
}
