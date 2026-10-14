'use strict';

// SQL result adaptation shared by Client query and prepared paths.
function inferCommand(text) {
  var match = String(text || '').trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : '';
}

function normalizeResult(dialect, text, result) {
  result = result || {};
  var rows = Array.isArray(result.rows) ? result.rows : [];
  var fields = Array.isArray(result.fields) ? result.fields : [];
  var rowCount = result.rowCount;
  if (rowCount === undefined || rowCount === null) rowCount = rows.length;
  var affectedRows = result.affectedRows;
  if (affectedRows === undefined && result.changes !== undefined) affectedRows = result.changes;
  return {
    rows: rows,
    fields: fields,
    rowCount: rowCount,
    affectedRows: affectedRows === undefined ? null : affectedRows,
    insertId: result.insertId === undefined ? null : result.insertId,
    command: result.command || inferCommand(text),
    dialect: dialect,
    native: result
  };
}

module.exports = Object.freeze({inferCommand, normalizeResult});
