'use strict';

var identity = require('./ObjectIdentity');
var SCHEMA_VERSION = 1;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { freeze(value[key]); });
  return Object.freeze(value);
}

function portableOf(snapshot) {
  var portable = snapshot && snapshot.portable ? snapshot.portable : snapshot;
  if (!portable || !Array.isArray(portable.tables)) {
    throw new TypeError('NuBloxSQL dependency graph requires portable metadata with tables');
  }
  return portable;
}

function makeNode(kind, metadata, dialect, context) {
  context = context || {};
  return freeze({
    id: identity.objectId(kind, metadata, Object.assign({ dialect: dialect }, context)),
    kind: kind,
    name: metadata && metadata.name ? String(metadata.name) : null,
    database: metadata && metadata.database !== undefined ? metadata.database : (context.database || null),
    schema: metadata && metadata.schema !== undefined ? metadata.schema : (context.schema || null),
    table: metadata && metadata.table !== undefined ? metadata.table : (context.table || null),
    metadata: metadata || null
  });
}

function makeEdge(from, to, relation, via) {
  return freeze({ from: from, to: to, relation: relation, via: via || null });
}

function build(snapshot) {
  var portable = portableOf(snapshot);
  var dialect = portable.dialect || snapshot.dialect || 'unknown';
  var nodes = [];
  var edges = [];
  var nodeIds = Object.create(null);
  var edgeKeys = Object.create(null);

  function addNode(value) {
    if (!nodeIds[value.id]) {
      nodeIds[value.id] = true;
      nodes.push(value);
    }
    return value.id;
  }

  function addEdge(value) {
    var key = value.from + '|' + value.to + '|' + value.relation + '|' + (value.via || '');
    if (!edgeKeys[key]) {
      edgeKeys[key] = true;
      edges.push(value);
    }
  }

  function tableContext(table) {
    return { database: table.database, schema: table.schema, table: table.name };
  }

  // Pass 1: establish the complete identity set before resolving relationships.
  (portable.databases || []).forEach(function (database) {
    addNode(makeNode('database', database, dialect));
  });

  (portable.schemas || []).forEach(function (schema) {
    addNode(makeNode('schema', schema, dialect));
  });

  portable.tables.forEach(function (table) {
    var context = tableContext(table);
    addNode(makeNode(table.kind || 'table', table, dialect));
    (table.columns || []).forEach(function (column) {
      addNode(makeNode('column', column, dialect, context));
    });
    (table.indexes || []).forEach(function (index) {
      addNode(makeNode('index', index, dialect, context));
    });
    (table.constraints || []).forEach(function (constraint) {
      addNode(makeNode('constraint', constraint, dialect, context));
    });
    (table.foreignKeys || []).forEach(function (foreignKey) {
      addNode(makeNode('foreign-key', foreignKey, dialect, context));
    });
  });

  // Pass 2: resolve containment and dependency edges against the full identity set.
  (portable.schemas || []).forEach(function (schema) {
    var schemaId = identity.objectId('schema', schema, { dialect: dialect });
    var databaseId = identity.objectId('database', { name: schema.database }, { dialect: dialect });
    if (nodeIds[databaseId]) addEdge(makeEdge(schemaId, databaseId, 'contained-by'));
  });

  portable.tables.forEach(function (table) {
    var tableKind = table.kind || 'table';
    var tableId = identity.objectId(tableKind, table, { dialect: dialect });
    var schemaId = identity.objectId('schema', { database: table.database, name: table.schema }, { dialect: dialect });
    if (nodeIds[schemaId]) addEdge(makeEdge(tableId, schemaId, 'contained-by'));

    (table.columns || []).forEach(function (column) {
      var columnId = identity.objectId('column', column, {
        dialect: dialect, database: table.database, schema: table.schema, table: table.name
      });
      addEdge(makeEdge(columnId, tableId, 'defined-on'));
    });

    (table.indexes || []).forEach(function (index) {
      var indexId = identity.objectId('index', index, {
        dialect: dialect, database: table.database, schema: table.schema, table: table.name
      });
      addEdge(makeEdge(indexId, tableId, 'defined-on'));
      (index.keyParts || []).forEach(function (part) {
        if (!part || !part.column) return;
        var columnId = identity.objectId('column', {
          database: table.database, schema: table.schema, table: table.name, name: part.column
        }, { dialect: dialect });
        if (nodeIds[columnId]) addEdge(makeEdge(indexId, columnId, 'uses-column'));
      });
    });

    (table.constraints || []).forEach(function (constraint) {
      var constraintId = identity.objectId('constraint', constraint, {
        dialect: dialect, database: table.database, schema: table.schema, table: table.name
      });
      addEdge(makeEdge(constraintId, tableId, 'defined-on'));
      (constraint.columns || []).forEach(function (name) {
        var columnId = identity.objectId('column', {
          database: table.database, schema: table.schema, table: table.name, name: name
        }, { dialect: dialect });
        if (nodeIds[columnId]) addEdge(makeEdge(constraintId, columnId, 'uses-column'));
      });
    });

    (table.foreignKeys || []).forEach(function (foreignKey) {
      var foreignKeyId = identity.objectId('foreign-key', foreignKey, {
        dialect: dialect, database: table.database, schema: table.schema, table: table.name
      });
      addEdge(makeEdge(foreignKeyId, tableId, 'defined-on'));

      var referencedDatabase = foreignKey.referencedDatabase == null ? table.database : foreignKey.referencedDatabase;
      var referencedSchema = foreignKey.referencedSchema == null ? table.schema : foreignKey.referencedSchema;
      var referencedTableId = identity.objectId('table', {
        database: referencedDatabase, schema: referencedSchema, name: foreignKey.referencedTable
      }, { dialect: dialect });

      if (nodeIds[referencedTableId]) {
        addEdge(makeEdge(foreignKeyId, referencedTableId, 'references'));
        addEdge(makeEdge(tableId, referencedTableId, 'references', foreignKeyId));
      }

      (foreignKey.columns || []).forEach(function (name, index) {
        var localColumnId = identity.objectId('column', {
          database: table.database, schema: table.schema, table: table.name, name: name
        }, { dialect: dialect });
        if (nodeIds[localColumnId]) addEdge(makeEdge(foreignKeyId, localColumnId, 'uses-column'));

        var referencedName = (foreignKey.referencedColumns || [])[index];
        if (!referencedName) return;
        var remoteColumnId = identity.objectId('column', {
          database: referencedDatabase, schema: referencedSchema,
          table: foreignKey.referencedTable, name: referencedName
        }, { dialect: dialect });
        if (nodeIds[remoteColumnId]) addEdge(makeEdge(foreignKeyId, remoteColumnId, 'references-column'));
        if (nodeIds[localColumnId] && nodeIds[remoteColumnId]) {
          addEdge(makeEdge(localColumnId, remoteColumnId, 'references-column', foreignKeyId));
        }
      });
    });
  });

  nodes.sort(function (a, b) { return a.id.localeCompare(b.id); });
  edges.sort(function (a, b) {
    return (a.from + '|' + a.to + '|' + a.relation + '|' + (a.via || '')).localeCompare(
      b.from + '|' + b.to + '|' + b.relation + '|' + (b.via || '')
    );
  });

  return freeze({
    schemaVersion: SCHEMA_VERSION,
    identitySchemaVersion: identity.SCHEMA_VERSION,
    dialect: dialect,
    nodes: freeze(nodes),
    edges: freeze(edges)
  });
}

function related(graph, startId, direction, options) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('NuBloxSQL dependency traversal requires a dependency graph');
  }
  options = options || {};
  var transitive = options.transitive !== false;
  var relationFilter = null;
  if (Array.isArray(options.relations)) {
    relationFilter = Object.create(null);
    options.relations.forEach(function (relation) { relationFilter[relation] = true; });
  }

  var seen = Object.create(null);
  var queue = [startId];
  var ids = [];
  seen[startId] = true;

  while (queue.length) {
    var current = queue.shift();
    graph.edges.forEach(function (entry) {
      if (relationFilter && !relationFilter[entry.relation]) return;
      var next = null;
      if (direction === 'dependencies' && entry.from === current) next = entry.to;
      if (direction === 'dependents' && entry.to === current) next = entry.from;
      if (next && !seen[next]) {
        seen[next] = true;
        ids.push(next);
        if (transitive) queue.push(next);
      }
    });
    if (!transitive) break;
  }

  return freeze(ids.map(function (id) {
    return graph.nodes.find(function (entry) { return entry.id === id; });
  }).filter(Boolean));
}

function dependencies(graph, id, options) {
  return related(graph, id, 'dependencies', options);
}

function dependents(graph, id, options) {
  return related(graph, id, 'dependents', options);
}

function impact(graph, id, options) {
  return freeze({
    object: graph.nodes.find(function (entry) { return entry.id === id; }) || null,
    dependencies: dependencies(graph, id, options),
    dependents: dependents(graph, id, options)
  });
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.build = build;
exports.dependencies = dependencies;
exports.dependents = dependents;
exports.impact = impact;
