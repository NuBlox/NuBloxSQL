'use strict';

var VOCABULARY_VERSION = 1;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach(freeze);
    return Object.freeze(value);
  }
  Object.keys(value).forEach(function (key) { freeze(value[key]); });
  return Object.freeze(value);
}

function stringOrNull(value) {
  return value === undefined || value === null ? null : String(value);
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function array(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function normalizeKind(type) {
  type = String(type || 'table').toLowerCase();
  if (type === 'view') return 'view';
  if (type === 'foreign-table' || type === 'foreign table') return 'foreign-table';
  return 'table';
}

function normalizeConstraintType(type) {
  var value = String(type || '').toLowerCase().replace(/_/g, '-');
  if (value === 'primary' || value === 'primary-key') return 'primary-key';
  if (value === 'foreign' || value === 'foreign-key') return 'foreign-key';
  if (value === 'unique') return 'unique';
  if (value === 'check') return 'check';
  if (value === 'not-null' || value === 'not null') return 'not-null';
  return value || 'unknown';
}

function normalizeGenerated(entry) {
  var enabled = entry.generated === true || entry.isGenerated === true || entry.generationExpression != null;
  return freeze({
    enabled: enabled,
    kind: enabled ? stringOrNull(entry.generatedKind || entry.generationKind || entry.extra) : null,
    expression: enabled ? stringOrNull(entry.generationExpression || entry.generatedExpression) : null
  });
}

function normalizeDatabase(entry) {
  return freeze({ kind: 'database', name: String(entry.name), native: entry.native === undefined ? null : entry.native });
}

function normalizeSchema(entry) {
  return freeze({
    kind: 'schema',
    database: stringOrNull(entry.database),
    name: String(entry.name),
    native: entry.native === undefined ? null : entry.native
  });
}

function normalizeColumn(entry) {
  var nullable = booleanOrNull(entry.nullable);
  return freeze({
    kind: 'column',
    database: stringOrNull(entry.database),
    schema: stringOrNull(entry.schema),
    table: String(entry.table),
    name: String(entry.name),
    ordinal: Number.isInteger(entry.ordinal) ? entry.ordinal : null,
    dataType: stringOrNull(entry.dataType),
    nativeType: stringOrNull(entry.nativeType),
    nullability: nullable === null ? 'unknown' : (nullable ? 'nullable' : 'not-null'),
    default: entry.default === undefined ? null : entry.default,
    primaryKey: entry.primaryKey === true,
    identity: entry.identity === true || entry.autoIncrement === true || entry.autoincrement === true,
    generated: normalizeGenerated(entry),
    native: entry.native === undefined ? null : entry.native
  });
}

function normalizeIndex(entry) {
  var keyParts = Array.isArray(entry.keyParts) ? entry.keyParts.map(function (part, index) {
    part = part || {};
    return freeze({
      ordinal: Number.isInteger(part.ordinal) ? part.ordinal : index,
      column: stringOrNull(part.column !== undefined ? part.column : array(entry.columns)[index]),
      expression: stringOrNull(part.expression),
      descending: part.descending === true,
      collation: stringOrNull(part.collation),
      included: part.included === true
    });
  }) : array(entry.columns).map(function (column, index) {
    return freeze({ ordinal: index, column: stringOrNull(column), expression: null, descending: false, collation: null, included: false });
  });
  return freeze({
    kind: 'index',
    database: stringOrNull(entry.database),
    schema: stringOrNull(entry.schema),
    table: String(entry.table),
    name: String(entry.name),
    unique: entry.unique === true,
    primary: entry.primary === true,
    method: stringOrNull(entry.method),
    predicate: stringOrNull(entry.predicate || entry.where),
    keyParts: keyParts,
    native: entry.native === undefined ? null : entry.native
  });
}

function normalizeForeignKey(entry) {
  return freeze({
    kind: 'foreign-key',
    database: stringOrNull(entry.database),
    schema: stringOrNull(entry.schema),
    table: String(entry.table),
    name: stringOrNull(entry.name),
    columns: array(entry.columns).map(String),
    referencedDatabase: stringOrNull(entry.referencedDatabase),
    referencedSchema: stringOrNull(entry.referencedSchema),
    referencedTable: String(entry.referencedTable),
    referencedColumns: array(entry.referencedColumns).map(String),
    onUpdate: stringOrNull(entry.onUpdate),
    onDelete: stringOrNull(entry.onDelete),
    match: stringOrNull(entry.match),
    deferrable: booleanOrNull(entry.deferrable),
    initiallyDeferred: booleanOrNull(entry.initiallyDeferred),
    native: entry.native === undefined ? null : entry.native
  });
}

function normalizeConstraint(entry) {
  return freeze({
    kind: 'constraint',
    database: stringOrNull(entry.database),
    schema: stringOrNull(entry.schema),
    table: String(entry.table),
    name: stringOrNull(entry.name),
    type: normalizeConstraintType(entry.type),
    columns: array(entry.columns).map(String),
    definition: stringOrNull(entry.definition || entry.expression),
    deferrable: booleanOrNull(entry.deferrable),
    initiallyDeferred: booleanOrNull(entry.initiallyDeferred),
    native: entry.native === undefined ? null : entry.native
  });
}

function normalizeTable(entry) {
  return freeze({
    kind: normalizeKind(entry.type),
    database: stringOrNull(entry.database),
    schema: stringOrNull(entry.schema),
    name: String(entry.name),
    columns: array(entry.columns).map(normalizeColumn),
    indexes: array(entry.indexes).map(normalizeIndex),
    foreignKeys: array(entry.foreignKeys).map(normalizeForeignKey),
    constraints: array(entry.constraints).map(normalizeConstraint),
    native: entry.native === undefined ? null : entry.native
  });
}

function project(snapshot) {
  return freeze({
    vocabularyVersion: VOCABULARY_VERSION,
    dialect: snapshot.dialect,
    scope: freeze(Object.assign({}, snapshot.scope || {})),
    databases: array(snapshot.databases).map(normalizeDatabase),
    schemas: array(snapshot.schemas).map(normalizeSchema),
    tables: array(snapshot.tables).map(normalizeTable)
  });
}

exports.VOCABULARY_VERSION = VOCABULARY_VERSION;
exports.project = project;
exports.normalizeDatabase = normalizeDatabase;
exports.normalizeSchema = normalizeSchema;
exports.normalizeTable = normalizeTable;
exports.normalizeColumn = normalizeColumn;
exports.normalizeIndex = normalizeIndex;
exports.normalizeForeignKey = normalizeForeignKey;
exports.normalizeConstraint = normalizeConstraint;
