'use strict';

var crypto = require('crypto');
var identity = require('./ObjectIdentity');
var dependencyGraph = require('./DependencyGraph');
var typeSemantics = require('./TypeSemantics');

var SCHEMA_VERSION = 1;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { freeze(value[key]); });
  return Object.freeze(value);
}

function stable(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  var out = {};
  Object.keys(value).sort().forEach(function (key) {
    if (value[key] !== undefined) out[key] = stable(value[key]);
  });
  return out;
}

function stringify(value) {
  return JSON.stringify(stable(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(stringify(value)).digest('hex');
}

function segment(value) {
  if (value === undefined || value === null || value === '') return '~';
  return encodeURIComponent('v:' + String(value));
}

function logicalKey(kind, parts) {
  parts = parts || {};
  return [
    String(kind),
    segment(parts.database),
    segment(parts.schema),
    segment(parts.table),
    segment(parts.name)
  ].join('/');
}

function canonicalSemantic(type) {
  if (!type) return null;
  return freeze({
    family: type.family,
    precision: type.precision,
    scale: type.scale,
    length: type.length,
    timezone: type.timezone === true,
    unsigned: type.unsigned === true
  });
}

function objectBase(kind, metadata, dialect, context) {
  context = context || {};
  var id = identity.objectId(kind, metadata, Object.assign({ dialect: dialect }, context));
  var parsed = identity.parse(id);
  return {
    id: id,
    logicalKey: logicalKey(kind, parsed),
    kind: kind,
    database: parsed.database,
    schema: parsed.schema,
    table: parsed.table,
    name: parsed.name
  };
}

function normalizeDefault(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return 'hex:' + value.toString('hex');
  if (value instanceof Uint8Array) return 'hex:' + Buffer.from(value).toString('hex');
  return stable(value);
}

function buildColumn(column, table, dialect) {
  var base = objectBase('column', column, dialect, {
    database: table.database,
    schema: table.schema,
    table: table.name
  });
  var canonical = typeSemantics.infer(dialect, column.nativeType || column.dataType, column);
  return freeze(Object.assign(base, {
    ordinal: column.ordinal,
    sourceNativeType: column.nativeType || column.dataType || null,
    canonicalType: canonical,
    nullability: column.nullability,
    default: normalizeDefault(column.default),
    primaryKey: column.primaryKey === true,
    identity: column.identity === true,
    generated: freeze({
      enabled: !!(column.generated && column.generated.enabled),
      kind: column.generated ? column.generated.kind : null,
      expression: column.generated ? column.generated.expression : null
    })
  }));
}

function buildIndex(index, table, dialect) {
  var base = objectBase('index', index, dialect, {
    database: table.database,
    schema: table.schema,
    table: table.name
  });
  return freeze(Object.assign(base, {
    unique: index.unique === true,
    primary: index.primary === true,
    method: index.method || null,
    predicate: index.predicate || null,
    keyParts: freeze((index.keyParts || []).map(function (part) {
      return freeze({
        ordinal: part.ordinal,
        column: part.column || null,
        expression: part.expression || null,
        descending: part.descending === true,
        collation: part.collation || null,
        included: part.included === true
      });
    }))
  }));
}

function buildForeignKey(foreignKey, table, dialect) {
  var base = objectBase('foreign-key', foreignKey, dialect, {
    database: table.database,
    schema: table.schema,
    table: table.name
  });
  return freeze(Object.assign(base, {
    columns: freeze((foreignKey.columns || []).slice()),
    referencedDatabase: foreignKey.referencedDatabase,
    referencedSchema: foreignKey.referencedSchema,
    referencedTable: foreignKey.referencedTable,
    referencedColumns: freeze((foreignKey.referencedColumns || []).slice()),
    onUpdate: foreignKey.onUpdate || null,
    onDelete: foreignKey.onDelete || null,
    match: foreignKey.match || null,
    deferrable: foreignKey.deferrable,
    initiallyDeferred: foreignKey.initiallyDeferred
  }));
}

function buildConstraint(constraint, table, dialect) {
  var base = objectBase('constraint', constraint, dialect, {
    database: table.database,
    schema: table.schema,
    table: table.name
  });
  return freeze(Object.assign(base, {
    type: constraint.type,
    columns: freeze((constraint.columns || []).slice()),
    definition: constraint.definition || null,
    deferrable: constraint.deferrable,
    initiallyDeferred: constraint.initiallyDeferred
  }));
}

function buildTable(table, dialect) {
  var kind = table.kind || 'table';
  var base = objectBase(kind, table, dialect);
  var columns = (table.columns || []).map(function (column) { return buildColumn(column, table, dialect); })
    .sort(function (a, b) {
      var ao = a.ordinal === null ? Number.MAX_SAFE_INTEGER : a.ordinal;
      var bo = b.ordinal === null ? Number.MAX_SAFE_INTEGER : b.ordinal;
      return ao - bo || a.logicalKey.localeCompare(b.logicalKey);
    });
  var indexes = (table.indexes || []).map(function (entry) { return buildIndex(entry, table, dialect); })
    .sort(function (a, b) { return a.logicalKey.localeCompare(b.logicalKey); });
  var foreignKeys = (table.foreignKeys || []).map(function (entry) { return buildForeignKey(entry, table, dialect); })
    .sort(function (a, b) { return a.logicalKey.localeCompare(b.logicalKey); });
  var constraints = (table.constraints || []).map(function (entry) { return buildConstraint(entry, table, dialect); })
    .sort(function (a, b) { return a.logicalKey.localeCompare(b.logicalKey); });

  return freeze(Object.assign(base, {
    columns: freeze(columns),
    indexes: freeze(indexes),
    foreignKeys: freeze(foreignKeys),
    constraints: freeze(constraints)
  }));
}

function semanticObject(value) {
  var base = {
    logicalKey: value.logicalKey,
    kind: value.kind,
    database: value.database,
    schema: value.schema,
    table: value.table,
    name: value.name
  };

  if (value.kind === 'column') {
    return Object.assign(base, {
      ordinal: value.ordinal,
      canonicalType: canonicalSemantic(value.canonicalType),
      nullability: value.nullability,
      default: value.default,
      primaryKey: value.primaryKey,
      identity: value.identity,
      generated: value.generated
    });
  }
  if (value.kind === 'index') {
    return Object.assign(base, {
      unique: value.unique,
      primary: value.primary,
      method: value.method,
      predicate: value.predicate,
      keyParts: value.keyParts
    });
  }
  if (value.kind === 'foreign-key') {
    return Object.assign(base, {
      columns: value.columns,
      referencedDatabase: value.referencedDatabase,
      referencedSchema: value.referencedSchema,
      referencedTable: value.referencedTable,
      referencedColumns: value.referencedColumns,
      onUpdate: value.onUpdate,
      onDelete: value.onDelete,
      match: value.match,
      deferrable: value.deferrable,
      initiallyDeferred: value.initiallyDeferred
    });
  }
  if (value.kind === 'constraint') {
    return Object.assign(base, {
      type: value.type,
      columns: value.columns,
      definition: value.definition,
      deferrable: value.deferrable,
      initiallyDeferred: value.initiallyDeferred
    });
  }
  if (value.columns) {
    return Object.assign(base, {
      columns: value.columns.map(semanticObject),
      indexes: value.indexes.map(semanticObject),
      foreignKeys: value.foreignKeys.map(semanticObject),
      constraints: value.constraints.map(semanticObject)
    });
  }
  return base;
}

function graphLogicalEdges(graph) {
  var byId = Object.create(null);
  graph.nodes.forEach(function (node) {
    var parsed = identity.parse(node.id);
    byId[node.id] = logicalKey(node.kind, parsed);
  });
  return graph.edges.map(function (edge) {
    return freeze({
      from: byId[edge.from] || edge.from,
      to: byId[edge.to] || edge.to,
      relation: edge.relation,
      via: edge.via ? (byId[edge.via] || edge.via) : null
    });
  }).sort(function (a, b) {
    return (a.from + '|' + a.to + '|' + a.relation + '|' + (a.via || '')).localeCompare(
      b.from + '|' + b.to + '|' + b.relation + '|' + (b.via || '')
    );
  });
}

function build(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('NuBloxSQL canonical schema snapshot requires metadata');
  var portable = snapshot.portable || snapshot;
  if (!portable || !Array.isArray(portable.tables)) {
    throw new TypeError('NuBloxSQL canonical schema snapshot requires portable metadata with tables');
  }

  var dialect = portable.dialect || snapshot.dialect || 'unknown';
  var databases = (portable.databases || []).map(function (entry) {
    return freeze(objectBase('database', entry, dialect));
  }).sort(function (a, b) { return a.logicalKey.localeCompare(b.logicalKey); });

  var schemas = (portable.schemas || []).map(function (entry) {
    return freeze(objectBase('schema', entry, dialect));
  }).sort(function (a, b) { return a.logicalKey.localeCompare(b.logicalKey); });

  var tables = portable.tables.map(function (entry) { return buildTable(entry, dialect); })
    .sort(function (a, b) { return a.logicalKey.localeCompare(b.logicalKey); });

  var graph = dependencyGraph.build(portable);
  var dependencies = freeze(graphLogicalEdges(graph));

  var semantic = {
    databases: databases.map(semanticObject),
    schemas: schemas.map(semanticObject),
    tables: tables.map(semanticObject),
    dependencies: dependencies
  };

  var source = {
    dialect: dialect,
    scope: stable(portable.scope || {}),
    semantic: semantic,
    sourceNativeTypes: tables.map(function (table) {
      return {
        logicalKey: table.logicalKey,
        columns: table.columns.map(function (column) {
          return { logicalKey: column.logicalKey, sourceNativeType: column.sourceNativeType };
        })
      };
    })
  };

  return freeze({
    schemaVersion: SCHEMA_VERSION,
    sourceDialect: dialect,
    scope: freeze(stable(portable.scope || {})),
    objectIdentitySchemaVersion: identity.SCHEMA_VERSION,
    typeSemanticsSchemaVersion: typeSemantics.SCHEMA_VERSION,
    dependencyGraphSchemaVersion: dependencyGraph.SCHEMA_VERSION,
    semanticHash: hash(semantic),
    sourceHash: hash(source),
    databases: freeze(databases),
    schemas: freeze(schemas),
    tables: freeze(tables),
    dependencies: dependencies
  });
}

function fingerprint(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== SCHEMA_VERSION || typeof snapshot.semanticHash !== 'string') {
    throw new TypeError('NuBloxSQL schema fingerprint requires a canonical schema snapshot v' + SCHEMA_VERSION);
  }
  return snapshot.semanticHash;
}

function equivalent(left, right) {
  return fingerprint(left) === fingerprint(right);
}

function sourceEquivalent(left, right) {
  if (!left || !right || left.schemaVersion !== SCHEMA_VERSION || right.schemaVersion !== SCHEMA_VERSION) {
    throw new TypeError('NuBloxSQL source schema comparison requires canonical schema snapshot v' + SCHEMA_VERSION);
  }
  return left.sourceHash === right.sourceHash;
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.logicalKey = logicalKey;
exports.build = build;
exports.fingerprint = fingerprint;
exports.equivalent = equivalent;
exports.sourceEquivalent = sourceEquivalent;
