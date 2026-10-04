'use strict';

var schemaSnapshot = require('./SchemaSnapshot');

var SCHEMA_VERSION = 1;
var SAFETY = Object.freeze([
  'safe',
  'dependency-sensitive',
  'manual-review',
  'potentially-lossy',
  'destructive'
]);
var RANK = Object.freeze({
  safe: 0,
  'dependency-sensitive': 1,
  'manual-review': 2,
  'potentially-lossy': 3,
  destructive: 4
});

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

function same(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function snapshotOf(value) {
  if (value && value.schemaVersion === schemaSnapshot.SCHEMA_VERSION && typeof value.semanticHash === 'string') return value;
  return schemaSnapshot.build(value);
}

function semanticType(type) {
  if (!type) return null;
  return {
    family: type.family,
    precision: type.precision,
    scale: type.scale,
    length: type.length,
    timezone: type.timezone === true,
    unsigned: type.unsigned === true
  };
}

function objectSemantic(value) {
  var out = {
    kind: value.kind,
    database: value.database,
    schema: value.schema,
    table: value.table,
    name: value.name
  };
  if (value.kind === 'column') {
    out.ordinal = value.ordinal;
    out.canonicalType = semanticType(value.canonicalType);
    out.nullability = value.nullability;
    out.default = value.default;
    out.primaryKey = value.primaryKey;
    out.identity = value.identity;
    out.generated = value.generated;
  } else if (value.kind === 'index') {
    out.unique = value.unique;
    out.primary = value.primary;
    out.method = value.method;
    out.predicate = value.predicate;
    out.keyParts = value.keyParts;
  } else if (value.kind === 'foreign-key') {
    out.columns = value.columns;
    out.referencedDatabase = value.referencedDatabase;
    out.referencedSchema = value.referencedSchema;
    out.referencedTable = value.referencedTable;
    out.referencedColumns = value.referencedColumns;
    out.onUpdate = value.onUpdate;
    out.onDelete = value.onDelete;
    out.match = value.match;
    out.deferrable = value.deferrable;
    out.initiallyDeferred = value.initiallyDeferred;
  } else if (value.kind === 'constraint') {
    out.type = value.type;
    out.columns = value.columns;
    out.definition = value.definition;
    out.deferrable = value.deferrable;
    out.initiallyDeferred = value.initiallyDeferred;
  }
  return out;
}

function flatten(snapshot) {
  var objects = [];
  (snapshot.databases || []).forEach(function (value) { objects.push(value); });
  (snapshot.schemas || []).forEach(function (value) { objects.push(value); });
  (snapshot.tables || []).forEach(function (table) {
    objects.push(table);
    (table.columns || []).forEach(function (value) { objects.push(value); });
    (table.indexes || []).forEach(function (value) { objects.push(value); });
    (table.foreignKeys || []).forEach(function (value) { objects.push(value); });
    (table.constraints || []).forEach(function (value) { objects.push(value); });
  });
  objects.sort(function (a, b) { return a.logicalKey.localeCompare(b.logicalKey); });
  return objects;
}

function mapByKey(values) {
  var out = Object.create(null);
  values.forEach(function (value) { out[value.logicalKey] = value; });
  return out;
}

function propertyDeltas(before, after) {
  var left = objectSemantic(before);
  var right = objectSemantic(after);
  var keys = Object.create(null);
  Object.keys(left).forEach(function (key) { keys[key] = true; });
  Object.keys(right).forEach(function (key) { keys[key] = true; });
  return Object.keys(keys).sort().filter(function (key) {
    return !same(left[key], right[key]);
  }).map(function (key) {
    return freeze({ property: key, before: left[key] === undefined ? null : left[key], after: right[key] === undefined ? null : right[key] });
  });
}

function typeSafety(before, after) {
  if (!before || !after) return 'manual-review';
  if (same(semanticType(before), semanticType(after))) return 'safe';

  if (before.family === 'int16' && (after.family === 'int32' || after.family === 'int64') && !before.unsigned && !after.unsigned) return 'safe';
  if (before.family === 'int32' && after.family === 'int64' && !before.unsigned && !after.unsigned) return 'safe';

  if (before.family !== after.family) return 'potentially-lossy';
  if (before.timezone !== after.timezone) return 'potentially-lossy';
  if (before.unsigned && !after.unsigned) return 'potentially-lossy';

  if (before.family === 'decimal') {
    if (before.precision !== null && after.precision !== null && after.precision < before.precision) return 'potentially-lossy';
    if (before.scale !== null && after.scale !== null && after.scale < before.scale) return 'potentially-lossy';
    return 'safe';
  }
  if ((before.family === 'text' || before.family === 'binary') && before.length !== null && after.length !== null) {
    return after.length < before.length ? 'potentially-lossy' : 'safe';
  }
  if ((before.family === 'time' || before.family === 'timestamp') && before.scale !== null && after.scale !== null) {
    return after.scale < before.scale ? 'potentially-lossy' : 'safe';
  }
  return 'manual-review';
}

function maxSafety(values) {
  var highest = 'safe';
  values.forEach(function (value) {
    if (RANK[value] > RANK[highest]) highest = value;
  });
  return highest;
}

function classifyAdded(value) {
  if (value.kind === 'column') {
    if (value.nullability === 'not-null' && value.default === null && !value.identity && !(value.generated && value.generated.enabled)) return 'manual-review';
    return 'safe';
  }
  if (value.kind === 'constraint' || value.kind === 'foreign-key') return 'dependency-sensitive';
  return 'safe';
}

function classifyModified(before, after, deltas) {
  var safety = [];
  if (before.kind === 'column') {
    deltas.forEach(function (delta) {
      if (delta.property === 'canonicalType') safety.push(typeSafety(before.canonicalType, after.canonicalType));
      else if (delta.property === 'nullability') {
        safety.push(before.nullability === 'nullable' && after.nullability === 'not-null' ? 'manual-review' : 'safe');
      } else if (delta.property === 'ordinal') {
        safety.push('safe');
      } else if (delta.property === 'default') {
        safety.push('manual-review');
      } else if (delta.property === 'primaryKey' || delta.property === 'identity' || delta.property === 'generated') {
        safety.push('dependency-sensitive');
      } else {
        safety.push('manual-review');
      }
    });
  } else if (before.kind === 'index' || before.kind === 'constraint' || before.kind === 'foreign-key') {
    safety.push('dependency-sensitive');
  } else if (before.kind === 'table' || before.kind === 'view' || before.kind === 'foreign-table') {
    safety.push('manual-review');
  } else {
    safety.push('manual-review');
  }
  return maxSafety(safety.length ? safety : ['safe']);
}

function dependencyKeys(snapshot, key) {
  return (snapshot.dependencies || []).filter(function (edge) {
    return edge.from === key || edge.to === key || edge.via === key;
  });
}

function makeChange(status, before, after, leftSnapshot, rightSnapshot) {
  var value = after || before;
  var deltas = status === 'modified' ? propertyDeltas(before, after) : [];
  var safety = status === 'removed' ? 'destructive' : (status === 'added' ? classifyAdded(after) : classifyModified(before, after, deltas));
  var dependencies = dependencyKeys(status === 'removed' ? leftSnapshot : rightSnapshot, value.logicalKey);

  var dependencyRisk = dependencies.some(function (edge) {
    return edge.relation !== 'contained-by' && edge.relation !== 'defined-on';
  });
  if (safety === 'safe' && dependencyRisk && (status === 'removed' || status === 'modified')) {
    safety = 'dependency-sensitive';
  }

  return freeze({
    status: status,
    safety: safety,
    logicalKey: value.logicalKey,
    kind: value.kind,
    before: before || null,
    after: after || null,
    deltas: freeze(deltas),
    dependencies: freeze(dependencies.slice())
  });
}

function diffDependencies(left, right) {
  function key(edge) {
    return edge.from + '|' + edge.to + '|' + edge.relation + '|' + (edge.via || '');
  }
  var l = Object.create(null), r = Object.create(null);
  (left.dependencies || []).forEach(function (edge) { l[key(edge)] = edge; });
  (right.dependencies || []).forEach(function (edge) { r[key(edge)] = edge; });
  var added = Object.keys(r).filter(function (k) { return !l[k]; }).sort().map(function (k) { return r[k]; });
  var removed = Object.keys(l).filter(function (k) { return !r[k]; }).sort().map(function (k) { return l[k]; });
  return freeze({ added: freeze(added), removed: freeze(removed) });
}

function compare(leftInput, rightInput) {
  var left = snapshotOf(leftInput);
  var right = snapshotOf(rightInput);

  var leftValues = flatten(left);
  var rightValues = flatten(right);
  var leftByKey = mapByKey(leftValues);
  var rightByKey = mapByKey(rightValues);
  var keys = Object.create(null);
  leftValues.forEach(function (value) { keys[value.logicalKey] = true; });
  rightValues.forEach(function (value) { keys[value.logicalKey] = true; });

  var changes = [];
  Object.keys(keys).sort().forEach(function (key) {
    var before = leftByKey[key] || null;
    var after = rightByKey[key] || null;
    if (!before) changes.push(makeChange('added', null, after, left, right));
    else if (!after) changes.push(makeChange('removed', before, null, left, right));
    else if (!same(objectSemantic(before), objectSemantic(after))) changes.push(makeChange('modified', before, after, left, right));
  });

  var unchanged = Object.keys(keys).length - changes.length;
  var summary = {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: unchanged,
    safe: 0,
    'dependency-sensitive': 0,
    'manual-review': 0,
    'potentially-lossy': 0,
    destructive: 0
  };
  changes.forEach(function (change) {
    summary[change.status] += 1;
    summary[change.safety] += 1;
  });

  var dependencyChanges = diffDependencies(left, right);
  if (dependencyChanges.added.length || dependencyChanges.removed.length) {
    summary['dependency-sensitive'] += dependencyChanges.added.length + dependencyChanges.removed.length;
  }

  return freeze({
    schemaVersion: SCHEMA_VERSION,
    left: freeze({ semanticHash: left.semanticHash, sourceHash: left.sourceHash, dialect: left.sourceDialect }),
    right: freeze({ semanticHash: right.semanticHash, sourceHash: right.sourceHash, dialect: right.sourceDialect }),
    equivalent: left.semanticHash === right.semanticHash,
    summary: freeze(summary),
    changes: freeze(changes),
    dependencyChanges: dependencyChanges
  });
}

function changed(diff) {
  if (!diff || diff.schemaVersion !== SCHEMA_VERSION || !diff.summary) throw new TypeError('NuBloxSQL schema diff v' + SCHEMA_VERSION + ' required');
  return diff.summary.added + diff.summary.removed + diff.summary.modified > 0 || diff.dependencyChanges.added.length > 0 || diff.dependencyChanges.removed.length > 0;
}

function highestSafety(diff) {
  if (!diff || diff.schemaVersion !== SCHEMA_VERSION || !diff.summary) throw new TypeError('NuBloxSQL schema diff v' + SCHEMA_VERSION + ' required');
  var result = 'safe';
  SAFETY.forEach(function (value) {
    if (diff.summary[value] > 0 && RANK[value] > RANK[result]) result = value;
  });
  return result;
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.SAFETY = SAFETY;
exports.compare = compare;
exports.changed = changed;
exports.highestSafety = highestSafety;
