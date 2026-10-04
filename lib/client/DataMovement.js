'use strict';

var crypto = require('crypto');
var sqlApi = require('./Sql');

var SCHEMA_VERSION = 1;
var CHECKPOINT_SCHEMA_VERSION = 1;
var STATUSES = Object.freeze(['succeeded','failed','dry-run']);
var INVALID_ROW_POLICIES = Object.freeze(['stop','skip']);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { freeze(value[key]); });
  return Object.freeze(value);
}

function now(clock) {
  return new Date((clock || Date.now)()).toISOString();
}

function normalizeTable(value) {
  var parts = Array.isArray(value) ? value.slice() : String(value || '').split('.');
  if (!parts.length || parts.some(function (part) { return typeof part !== 'string' || !part.trim(); })) {
    throw new TypeError('NuBloxSQL data movement target.table must be a non-empty identifier or identifier parts');
  }
  return parts.map(function (part) { return part.trim(); });
}

function normalizeColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) {
    throw new TypeError('NuBloxSQL data movement target.columns must be a non-empty array');
  }
  var targets = Object.create(null);
  return freeze(columns.map(function (entry) {
    if (typeof entry === 'string') entry = { source: entry, target: entry };
    if (!entry || typeof entry !== 'object') throw new TypeError('NuBloxSQL data movement column mappings must be strings or objects');
    var source = String(entry.source || '').trim();
    var target = String(entry.target || '').trim();
    if (!source || !target) throw new TypeError('NuBloxSQL data movement mappings require non-empty source and target names');
    if (targets[target]) throw new Error('NuBloxSQL data movement target column is mapped more than once: ' + target);
    targets[target] = true;
    return freeze({ source: source, target: target, required: entry.required === true });
  }));
}

function stablePlanShape(sourceClient, targetClient, spec) {
  var compiled = sourceClient && typeof sourceClient.compile === 'function'
    ? sourceClient.compile(spec.source.statement)
    : { text: String(spec.source.statement || '') };
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceDialect: sourceClient && sourceClient.dialect || null,
    targetDialect: targetClient && targetClient.dialect || null,
    sourceSql: compiled.text,
    targetTable: normalizeTable(spec.target.table),
    columns: normalizeColumns(spec.target.columns).map(function (entry) {
      return { source: entry.source, target: entry.target, required: entry.required };
    })
  };
}

function hashPlan(sourceClient, targetClient, spec) {
  return crypto.createHash('sha256').update(JSON.stringify(stablePlanShape(sourceClient, targetClient, spec))).digest('hex');
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('NuBloxSQL data movement requires a transfer specification');
  if (!spec.source || spec.source.statement === undefined) throw new TypeError('NuBloxSQL data movement source.statement is required');
  if (!spec.target) throw new TypeError('NuBloxSQL data movement target is required');
  return {
    table: normalizeTable(spec.target.table),
    columns: normalizeColumns(spec.target.columns)
  };
}

function identifierFragment(parts) {
  return new sqlApi.SqlFragment(['', ''], [sqlApi.sql.identifier.apply(null, parts)]);
}

function valueFragment(value) {
  return new sqlApi.SqlFragment(['', ''], [value]);
}

function insertStatement(tableParts, columns, rows) {
  var columnFragments = columns.map(function (entry) { return identifierFragment([entry.target]); });
  var rowFragments = rows.map(function (row) {
    var fragments = columns.map(function (entry) { return valueFragment(row[entry.target]); });
    return new sqlApi.SqlFragment(['(', ')'], [sqlApi.sql.join(fragments, ', ')]);
  });
  return new sqlApi.SqlFragment(
    ['INSERT INTO ', ' (', ') VALUES ', ''],
    [
      sqlApi.sql.identifier.apply(null, tableParts),
      sqlApi.sql.join(columnFragments, ', '),
      sqlApi.sql.join(rowFragments, ', ')
    ]
  );
}

function mapRow(row, columns) {
  var mapped = {};
  columns.forEach(function (entry) {
    var value = row == null ? undefined : row[entry.source];
    if (entry.required && (value === undefined || value === null)) {
      throw new Error('NuBloxSQL data movement required source value is missing: ' + entry.source);
    }
    mapped[entry.target] = value;
  });
  return mapped;
}

function checkpoint(planHash, counters, failedRow) {
  return freeze({
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    dataMovementSchemaVersion: SCHEMA_VERSION,
    planHash: planHash,
    rowOffset: counters.offset,
    rowsRead: counters.read,
    rowsWritten: counters.written,
    rowsSkipped: counters.skipped,
    failedRow: failedRow == null ? null : failedRow
  });
}

function validateCheckpoint(value, planHash) {
  if (!value || value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION || value.dataMovementSchemaVersion !== SCHEMA_VERSION) {
    throw new TypeError('NuBloxSQL data movement checkpoint v' + CHECKPOINT_SCHEMA_VERSION + ' required');
  }
  if (value.planHash !== planHash) throw new Error('NuBloxSQL data movement checkpoint plan hash mismatch');
  if (!Number.isSafeInteger(value.rowOffset) || value.rowOffset < 0) throw new Error('NuBloxSQL data movement checkpoint rowOffset is invalid');
  return value;
}

function emit(onEvent, type, payload) {
  if (typeof onEvent === 'function') onEvent(freeze(Object.assign({ type: type }, payload || {})));
}

async function writeBatch(targetClient, table, columns, rows, options) {
  if (!rows.length) return;
  var statement = insertStatement(table, columns, rows);
  await targetClient.execute(statement, options.operation || {});
}

async function transfer(sourceClient, targetClient, spec, options) {
  options = options || {};
  if (!sourceClient || (typeof sourceClient.stream !== 'function' && typeof sourceClient.all !== 'function')) {
    throw new TypeError('NuBloxSQL data movement requires a source client with stream() or all()');
  }
  if (!targetClient || typeof targetClient.execute !== 'function') {
    throw new TypeError('NuBloxSQL data movement requires a target client with execute()');
  }

  var normalized = validateSpec(spec);
  var batchSize = options.batchSize === undefined ? 500 : Number(options.batchSize);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError('NuBloxSQL data movement batchSize must be a positive safe integer');
  var invalidPolicy = options.onInvalid || 'stop';
  if (INVALID_ROW_POLICIES.indexOf(invalidPolicy) < 0) throw new RangeError('NuBloxSQL data movement onInvalid must be stop or skip');

  var planHash = hashPlan(sourceClient, targetClient, spec);
  var resumeOffset = 0;
  var counters = { read: 0, written: 0, skipped: 0, offset: 0 };
  if (options.resumeFrom) {
    validateCheckpoint(options.resumeFrom, planHash);
    resumeOffset = options.resumeFrom.rowOffset;
    counters.read = resumeOffset;
    counters.written = options.resumeFrom.rowsWritten;
    counters.skipped = options.resumeFrom.rowsSkipped;
    counters.offset = resumeOffset;
  }

  var clock = options.clock || Date.now;
  var startedAt = now(clock);
  var audit = [];
  var buffer = [];
  var sourceRows = typeof sourceClient.stream === 'function'
    ? sourceClient.stream(spec.source.statement, options.source || {})
    : await sourceClient.all(spec.source.statement, options.source || {});
  var sourceIndex = 0;
  var failed = null;

  emit(options.onEvent, 'data-movement-start', {
    planHash: planHash,
    sourceDialect: sourceClient.dialect || null,
    targetDialect: targetClient.dialect || null,
    resumeOffset: resumeOffset
  });

  try {
    for await (var rawRow of sourceRows) {
      if (sourceIndex < resumeOffset) {
        sourceIndex += 1;
        continue;
      }

      var logicalRow = sourceIndex;
      sourceIndex += 1;
      counters.read += 1;
      var mapped;

      try {
        mapped = mapRow(rawRow, normalized.columns);
        if (typeof options.transformRow === 'function') {
          var transformed = await options.transformRow(mapped, {
            sourceRow: rawRow,
            row: logicalRow,
            sourceClient: sourceClient,
            targetClient: targetClient
          });
          if (transformed !== undefined) mapped = transformed;
        }
        if (typeof options.validateRow === 'function') {
          var valid = await options.validateRow(mapped, {
            sourceRow: rawRow,
            row: logicalRow,
            sourceClient: sourceClient,
            targetClient: targetClient
          });
          if (valid !== true && valid !== undefined) {
            throw new Error(typeof valid === 'string' ? valid : 'NuBloxSQL data movement row validation failed');
          }
        }
      } catch (rowError) {
        if (invalidPolicy === 'skip') {
          if (buffer.length) {
            if (options.dryRun !== true) await writeBatch(targetClient, normalized.table, normalized.columns, buffer, options);
            counters.written += buffer.length;
            counters.offset += buffer.length;
            audit.push(freeze({ firstRow: logicalRow - buffer.length, rows: buffer.length, status: options.dryRun === true ? 'planned' : 'succeeded' }));
            buffer = [];
          }
          counters.skipped += 1;
          counters.offset += 1;
          audit.push(freeze({ row: logicalRow, status: 'skipped', error: freeze({ name: rowError.name || 'Error', message: rowError.message || String(rowError) }) }));
          var skippedCp = checkpoint(planHash, counters, null);
          if (typeof options.onCheckpoint === 'function') await options.onCheckpoint(skippedCp);
          emit(options.onEvent, 'data-movement-row-skipped', { row: logicalRow, error: rowError.message || String(rowError), checkpoint: skippedCp });
          continue;
        }
        failed = { row: logicalRow, error: rowError };
        break;
      }

      buffer.push(mapped);
      if (buffer.length >= batchSize) {
        if (options.dryRun !== true) await writeBatch(targetClient, normalized.table, normalized.columns, buffer, options);
        counters.written += buffer.length;
        counters.offset += buffer.length;
        audit.push(freeze({ firstRow: logicalRow - buffer.length + 1, rows: buffer.length, status: options.dryRun === true ? 'planned' : 'succeeded' }));
        buffer = [];
        var cp = checkpoint(planHash, counters, null);
        if (typeof options.onCheckpoint === 'function') await options.onCheckpoint(cp);
        emit(options.onEvent, 'data-movement-checkpoint', { checkpoint: cp });
      }
    }

    if (!failed && buffer.length) {
      if (options.dryRun !== true) await writeBatch(targetClient, normalized.table, normalized.columns, buffer, options);
      counters.written += buffer.length;
      counters.offset += buffer.length;
      audit.push(freeze({ firstRow: counters.offset - buffer.length, rows: buffer.length, status: options.dryRun === true ? 'planned' : 'succeeded' }));
      buffer = [];
      var finalCp = checkpoint(planHash, counters, null);
      if (typeof options.onCheckpoint === 'function') await options.onCheckpoint(finalCp);
      emit(options.onEvent, 'data-movement-checkpoint', { checkpoint: finalCp });
    }
  } catch (error) {
    failed = { row: counters.read ? counters.read - 1 : null, error: error };
  } finally {
    if (sourceRows && typeof sourceRows.close === 'function') {
      try { await sourceRows.close(); } catch (_) {}
    } else if (sourceRows && typeof sourceRows.return === 'function') {
      try { await sourceRows.return(); } catch (_) {}
    }
  }

  var status = failed ? 'failed' : (options.dryRun === true ? 'dry-run' : 'succeeded');
  var result = freeze({
    schemaVersion: SCHEMA_VERSION,
    status: status,
    dryRun: options.dryRun === true,
    planHash: planHash,
    sourceDialect: sourceClient.dialect || null,
    targetDialect: targetClient.dialect || null,
    startedAt: startedAt,
    completedAt: now(clock),
    rowsRead: counters.read,
    rowsWritten: counters.written,
    rowsSkipped: counters.skipped,
    checkpoint: checkpoint(planHash, counters, failed && failed.row),
    audit: freeze(audit.slice()),
    error: failed ? freeze({ name: failed.error.name || 'Error', message: failed.error.message || String(failed.error), row: failed.row }) : null
  });

  emit(options.onEvent, 'data-movement-complete', { result: result });
  return result;
}

async function resume(sourceClient, targetClient, spec, checkpointValue, options) {
  options = Object.assign({}, options || {}, { resumeFrom: checkpointValue });
  return transfer(sourceClient, targetClient, spec, options);
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.CHECKPOINT_SCHEMA_VERSION = CHECKPOINT_SCHEMA_VERSION;
exports.STATUSES = STATUSES;
exports.INVALID_ROW_POLICIES = INVALID_ROW_POLICIES;
exports.planHash = hashPlan;
exports.checkpoint = checkpoint;
exports.run = transfer;
exports.resume = resume;
