'use strict';

var sql = require('./Sql').sql;

function freezeArray(values) {
  return Object.freeze(values.map(function (value) {
    return value && typeof value === 'object' && !Object.isFrozen(value) ? Object.freeze(value) : value;
  }));
}

function normalizeType(value) {
  value = String(value || '').toLowerCase();
  if (value.indexOf('view') >= 0) return 'view';
  if (value.indexOf('foreign') >= 0) return 'foreign-table';
  return 'table';
}

function constraintType(value) {
  value = String(value || '').toLowerCase().replace(/\s+/g, '-');
  if (value === 'primary-key') return 'primary-key';
  if (value === 'foreign-key') return 'foreign-key';
  if (value === 'unique') return 'unique';
  if (value === 'check') return 'check';
  return value || 'unknown';
}

function sqliteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function sqliteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function groupRows(rows, keyFn, mapFn) {
  var order = [];
  var groups = Object.create(null);
  rows.forEach(function (row) {
    var key = keyFn(row);
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(row);
  });
  return order.map(function (key) { return mapFn(groups[key]); });
}

function Metadata(client) {
  this.client = client;
  this.dialect = client.dialect;
}

Metadata.prototype._sqlite = async function _sqlite() {
  return this.client._ensureConnected();
};

Metadata.prototype.databases = async function databases() {
  var rows;
  if (this.dialect === 'mysql') {
    rows = await this.client.all(sql`
      SELECT SCHEMA_NAME AS name,
             DEFAULT_CHARACTER_SET_NAME AS characterSet,
             DEFAULT_COLLATION_NAME AS collation
      FROM information_schema.SCHEMATA
      ORDER BY SCHEMA_NAME
    `);
    return freezeArray(rows.map(function (row) {
      return { name: row.name, characterSet: row.characterSet || null, collation: row.collation || null, native: row };
    }));
  }

  if (this.dialect === 'postgresql') {
    rows = await this.client.all(sql`
      SELECT datname AS name,
             datallowconn AS allowConnections,
             datistemplate AS template,
             pg_encoding_to_char(encoding) AS encoding
      FROM pg_catalog.pg_database
      WHERE datallowconn = TRUE
      ORDER BY datname
    `);
    return freezeArray(rows.map(function (row) {
      return { name: row.name, allowConnections: row.allowConnections !== false, template: row.template === true, encoding: row.encoding || null, native: row };
    }));
  }

  if (this.dialect === 'sqlite') {
    rows = (await this._sqlite()).listDatabases();
    return freezeArray(rows.map(function (row) {
      return { name: row.name, file: row.file || null, sequence: row.sequence, native: row };
    }));
  }

  return freezeArray([]);
};

Metadata.prototype.schemas = async function schemas(options) {
  options = options || {};
  var rows;
  if (this.dialect === 'mysql') {
    rows = await this.databases();
    return freezeArray(rows.map(function (row) {
      return { database: row.name, name: row.name, native: row.native };
    }));
  }

  if (this.dialect === 'postgresql') {
    rows = await this.client.all(sql`
      SELECT catalog_name AS database,
             schema_name AS name,
             schema_owner AS owner
      FROM information_schema.schemata
      WHERE (${options.includeSystem === true} = TRUE)
         OR schema_name NOT IN ('pg_catalog', 'information_schema')
            AND schema_name NOT LIKE 'pg_toast%'
            AND schema_name NOT LIKE 'pg_temp_%'
      ORDER BY schema_name
    `);
    return freezeArray(rows.map(function (row) {
      return { database: row.database || null, name: row.name, owner: row.owner || null, native: row };
    }));
  }

  if (this.dialect === 'sqlite') {
    rows = await this.databases();
    return freezeArray(rows.map(function (row) {
      return { database: row.name, name: row.name, native: row.native };
    }));
  }

  return freezeArray([]);
};

Metadata.prototype.tables = async function tables(options) {
  options = options || {};
  var rows;
  if (this.dialect === 'mysql') {
    rows = await this.client.all(sql`
      SELECT TABLE_SCHEMA AS schemaName,
             TABLE_NAME AS tableName,
             TABLE_TYPE AS tableType,
             ENGINE AS engine,
             TABLE_COLLATION AS collation,
             TABLE_COMMENT AS comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = COALESCE(${options.schema || options.database || null}, DATABASE())
      ORDER BY TABLE_NAME
    `);
    return freezeArray(rows.map(function (row) {
      return {
        database: row.schemaName,
        schema: row.schemaName,
        name: row.tableName,
        type: normalizeType(row.tableType),
        engine: row.engine || null,
        collation: row.collation || null,
        comment: row.comment || null,
        native: row
      };
    }));
  }

  if (this.dialect === 'postgresql') {
    rows = await this.client.all(sql`
      SELECT table_catalog AS databaseName,
             table_schema AS schemaName,
             table_name AS tableName,
             table_type AS tableType,
             is_insertable_into AS insertable
      FROM information_schema.tables
      WHERE table_schema = COALESCE(${options.schema || null}, current_schema())
      ORDER BY table_name
    `);
    return freezeArray(rows.map(function (row) {
      return {
        database: row.databaseName || null,
        schema: row.schemaName,
        name: row.tableName,
        type: normalizeType(row.tableType),
        insertable: String(row.insertable || '').toUpperCase() === 'YES',
        native: row
      };
    }));
  }

  if (this.dialect === 'sqlite') {
    var database = options.database || options.schema || 'main';
    rows = (await this._sqlite()).listTables(database);
    return freezeArray(rows.map(function (row) {
      return {
        database: database,
        schema: database,
        name: row.name,
        type: normalizeType(row.type),
        definition: row.sql || null,
        native: row
      };
    }));
  }

  return freezeArray([]);
};

Metadata.prototype.columns = async function columns(table, options) {
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('NuBloxSQL metadata.columns() requires a table name');
  options = options || {};
  var rows;

  if (this.dialect === 'mysql') {
    rows = await this.client.all(sql`
      SELECT TABLE_SCHEMA AS schemaName,
             TABLE_NAME AS tableName,
             COLUMN_NAME AS columnName,
             ORDINAL_POSITION AS ordinalPosition,
             COLUMN_DEFAULT AS columnDefault,
             IS_NULLABLE AS isNullable,
             DATA_TYPE AS dataType,
             COLUMN_TYPE AS nativeType,
             CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
             NUMERIC_PRECISION AS numericPrecision,
             NUMERIC_SCALE AS numericScale,
             COLUMN_KEY AS columnKey,
             EXTRA AS extra,
             GENERATION_EXPRESSION AS generationExpression,
             COLUMN_COMMENT AS comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = COALESCE(${options.schema || options.database || null}, DATABASE())
        AND TABLE_NAME = ${table}
      ORDER BY ORDINAL_POSITION
    `);
    return freezeArray(rows.map(function (row) {
      return {
        database: row.schemaName,
        schema: row.schemaName,
        table: row.tableName,
        name: row.columnName,
        ordinal: Number(row.ordinalPosition),
        dataType: row.dataType,
        nativeType: row.nativeType || row.dataType,
        nullable: String(row.isNullable).toUpperCase() === 'YES',
        default: row.columnDefault,
        primaryKey: row.columnKey === 'PRI',
        generated: !!row.generationExpression || String(row.extra || '').toLowerCase().indexOf('generated') >= 0,
        identity: String(row.extra || '').toLowerCase().indexOf('auto_increment') >= 0,
        characterMaximumLength: row.characterMaximumLength === null ? null : Number(row.characterMaximumLength),
        numericPrecision: row.numericPrecision === null ? null : Number(row.numericPrecision),
        numericScale: row.numericScale === null ? null : Number(row.numericScale),
        comment: row.comment || null,
        native: row
      };
    }));
  }

  if (this.dialect === 'postgresql') {
    rows = await this.client.all(sql`
      SELECT table_catalog AS databaseName,
             table_schema AS schemaName,
             table_name AS tableName,
             column_name AS columnName,
             ordinal_position AS ordinalPosition,
             column_default AS columnDefault,
             is_nullable AS isNullable,
             data_type AS dataType,
             udt_name AS nativeType,
             character_maximum_length AS characterMaximumLength,
             numeric_precision AS numericPrecision,
             numeric_scale AS numericScale,
             is_identity AS isIdentity,
             is_generated AS isGenerated,
             generation_expression AS generationExpression
      FROM information_schema.columns
      WHERE table_schema = COALESCE(${options.schema || null}, current_schema())
        AND table_name = ${table}
      ORDER BY ordinal_position
    `);
    var pkRows = await this.client.all(sql`
      SELECT a.attname AS columnName
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON TRUE
      JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE c.contype = 'p'
        AND n.nspname = COALESCE(${options.schema || null}, current_schema())
        AND t.relname = ${table}
    `);
    var pk = Object.create(null);
    pkRows.forEach(function (row) { pk[row.columnName] = true; });
    return freezeArray(rows.map(function (row) {
      return {
        database: row.databaseName || null,
        schema: row.schemaName,
        table: row.tableName,
        name: row.columnName,
        ordinal: Number(row.ordinalPosition),
        dataType: row.dataType,
        nativeType: row.nativeType || row.dataType,
        nullable: String(row.isNullable).toUpperCase() === 'YES',
        default: row.columnDefault,
        primaryKey: pk[row.columnName] === true,
        generated: String(row.isGenerated || '').toUpperCase() !== 'NEVER' && String(row.isGenerated || '').length > 0,
        identity: String(row.isIdentity || '').toUpperCase() === 'YES',
        characterMaximumLength: row.characterMaximumLength === null ? null : Number(row.characterMaximumLength),
        numericPrecision: row.numericPrecision === null ? null : Number(row.numericPrecision),
        numericScale: row.numericScale === null ? null : Number(row.numericScale),
        native: row
      };
    }));
  }

  if (this.dialect === 'sqlite') {
    var database = options.database || options.schema || 'main';
    rows = (await this._sqlite()).tableInfo(table, database);
    return freezeArray(rows.map(function (row) {
      return {
        database: database,
        schema: database,
        table: table,
        name: row.name,
        ordinal: Number(row.cid) + 1,
        dataType: row.type || '',
        nativeType: row.type || '',
        nullable: row.notnull !== 1,
        default: row.dflt_value === undefined ? null : row.dflt_value,
        primaryKey: Number(row.pk) > 0,
        primaryKeyOrdinal: Number(row.pk) || null,
        generated: Number(row.hidden) === 2 || Number(row.hidden) === 3,
        hidden: Number(row.hidden) || 0,
        native: row
      };
    }));
  }

  return freezeArray([]);
};

Metadata.prototype.indexes = async function indexes(table, options) {
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('NuBloxSQL metadata.indexes() requires a table name');
  options = options || {};
  var rows;

  if (this.dialect === 'mysql') {
    rows = await this.client.all(sql`
      SELECT TABLE_SCHEMA AS schemaName,
             TABLE_NAME AS tableName,
             INDEX_NAME AS indexName,
             NON_UNIQUE AS nonUnique,
             SEQ_IN_INDEX AS sequenceInIndex,
             COLUMN_NAME AS columnName,
             COLLATION AS collation,
             CARDINALITY AS cardinality,
             INDEX_TYPE AS indexType,
             EXPRESSION AS expression
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = COALESCE(${options.schema || options.database || null}, DATABASE())
        AND TABLE_NAME = ${table}
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `);
    return freezeArray(groupRows(rows, function (row) { return row.indexName; }, function (group) {
      var first = group[0];
      return {
        database: first.schemaName,
        schema: first.schemaName,
        table: first.tableName,
        name: first.indexName,
        unique: Number(first.nonUnique) === 0,
        primary: first.indexName === 'PRIMARY',
        method: first.indexType || null,
        columns: freezeArray(group.map(function (row) { return row.columnName || row.expression || null; })),
        native: freezeArray(group)
      };
    }));
  }

  if (this.dialect === 'postgresql') {
    rows = await this.client.all(sql`
      SELECT current_database() AS databaseName,
             n.nspname AS schemaName,
             t.relname AS tableName,
             idx.relname AS indexName,
             i.indisunique AS isUnique,
             i.indisprimary AS isPrimary,
             am.amname AS method,
             pg_catalog.pg_get_indexdef(idx.oid) AS definition,
             pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate,
             s.n AS position,
             pg_catalog.pg_get_indexdef(idx.oid, s.n, TRUE) AS columnExpression
      FROM pg_catalog.pg_class t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_catalog.pg_index i ON i.indrelid = t.oid
      JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid = idx.relam
      JOIN LATERAL generate_series(1, i.indnkeyatts) AS s(n) ON TRUE
      WHERE n.nspname = COALESCE(${options.schema || null}, current_schema())
        AND t.relname = ${table}
      ORDER BY idx.relname, s.n
    `);
    return freezeArray(groupRows(rows, function (row) { return row.indexName; }, function (group) {
      var first = group[0];
      return {
        database: first.databaseName,
        schema: first.schemaName,
        table: first.tableName,
        name: first.indexName,
        unique: first.isUnique === true,
        primary: first.isPrimary === true,
        method: first.method || null,
        columns: freezeArray(group.map(function (row) { return row.columnExpression || null; })),
        predicate: first.predicate || null,
        definition: first.definition || null,
        native: freezeArray(group)
      };
    }));
  }

  if (this.dialect === 'sqlite') {
    var database = options.database || options.schema || 'main';
    var connection = await this._sqlite();
    rows = connection.query('PRAGMA ' + sqliteIdentifier(database) + '.index_list(' + sqliteLiteral(table) + ')').rows;
    var output = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var detail = connection.query('PRAGMA ' + sqliteIdentifier(database) + '.index_xinfo(' + sqliteLiteral(row.name) + ')').rows;
      var schemaRows = connection.query('SELECT sql FROM ' + sqliteIdentifier(database) + '.sqlite_schema WHERE type = \'index\' AND name = ' + sqliteLiteral(row.name)).rows;
      output.push({
        database: database,
        schema: database,
        table: table,
        name: row.name,
        unique: Number(row.unique) === 1,
        primary: String(row.origin || '').toLowerCase() === 'pk',
        method: 'btree',
        columns: freezeArray(detail.filter(function (entry) { return Number(entry.key) === 1; }).map(function (entry) { return entry.name === null ? null : entry.name; })),
        partial: Number(row.partial) === 1,
        definition: schemaRows.length ? schemaRows[0].sql || null : null,
        native: Object.freeze({ index: row, columns: freezeArray(detail) })
      });
    }
    return freezeArray(output);
  }

  return freezeArray([]);
};

Metadata.prototype.foreignKeys = async function foreignKeys(table, options) {
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('NuBloxSQL metadata.foreignKeys() requires a table name');
  options = options || {};
  var rows;

  if (this.dialect === 'mysql') {
    rows = await this.client.all(sql`
      SELECT kcu.CONSTRAINT_SCHEMA AS schemaName,
             kcu.TABLE_NAME AS tableName,
             kcu.CONSTRAINT_NAME AS constraintName,
             kcu.COLUMN_NAME AS columnName,
             kcu.ORDINAL_POSITION AS ordinalPosition,
             kcu.REFERENCED_TABLE_SCHEMA AS referencedSchema,
             kcu.REFERENCED_TABLE_NAME AS referencedTable,
             kcu.REFERENCED_COLUMN_NAME AS referencedColumn,
             rc.UPDATE_RULE AS updateRule,
             rc.DELETE_RULE AS deleteRule,
             rc.MATCH_OPTION AS matchOption
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
       AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND rc.TABLE_NAME = kcu.TABLE_NAME
      WHERE kcu.CONSTRAINT_SCHEMA = COALESCE(${options.schema || options.database || null}, DATABASE())
        AND kcu.TABLE_NAME = ${table}
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `);
    return freezeArray(groupRows(rows, function (row) { return row.constraintName; }, function (group) {
      var first = group[0];
      return {
        database: first.schemaName,
        schema: first.schemaName,
        table: first.tableName,
        name: first.constraintName,
        columns: freezeArray(group.map(function (row) { return row.columnName; })),
        referencedDatabase: first.referencedSchema,
        referencedSchema: first.referencedSchema,
        referencedTable: first.referencedTable,
        referencedColumns: freezeArray(group.map(function (row) { return row.referencedColumn; })),
        onUpdate: first.updateRule || null,
        onDelete: first.deleteRule || null,
        match: first.matchOption || null,
        native: freezeArray(group)
      };
    }));
  }

  if (this.dialect === 'postgresql') {
    rows = await this.client.all(sql`
      SELECT current_database() AS databaseName,
             n.nspname AS schemaName,
             t.relname AS tableName,
             c.conname AS constraintName,
             a.attname AS columnName,
             rn.nspname AS referencedSchema,
             rt.relname AS referencedTable,
             ra.attname AS referencedColumn,
             cols.ordinality AS ordinalPosition,
             CASE c.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE c.confupdtype::text END AS updateRule,
             CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE c.confdeltype::text END AS deleteRule,
             CASE c.confmatchtype WHEN 'f' THEN 'FULL' WHEN 'p' THEN 'PARTIAL' WHEN 's' THEN 'SIMPLE' ELSE c.confmatchtype::text END AS matchOption
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_catalog.pg_class rt ON rt.oid = c.confrelid
      JOIN pg_catalog.pg_namespace rn ON rn.oid = rt.relnamespace
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality) ON TRUE
      JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS refs(attnum, ordinality) ON refs.ordinality = cols.ordinality
      JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = cols.attnum
      JOIN pg_catalog.pg_attribute ra ON ra.attrelid = rt.oid AND ra.attnum = refs.attnum
      WHERE c.contype = 'f'
        AND n.nspname = COALESCE(${options.schema || null}, current_schema())
        AND t.relname = ${table}
      ORDER BY c.conname, cols.ordinality
    `);
    return freezeArray(groupRows(rows, function (row) { return row.constraintName; }, function (group) {
      var first = group[0];
      return {
        database: first.databaseName,
        schema: first.schemaName,
        table: first.tableName,
        name: first.constraintName,
        columns: freezeArray(group.map(function (row) { return row.columnName; })),
        referencedDatabase: first.databaseName,
        referencedSchema: first.referencedSchema,
        referencedTable: first.referencedTable,
        referencedColumns: freezeArray(group.map(function (row) { return row.referencedColumn; })),
        onUpdate: first.updateRule || null,
        onDelete: first.deleteRule || null,
        match: first.matchOption || null,
        native: freezeArray(group)
      };
    }));
  }

  if (this.dialect === 'sqlite') {
    var database = options.database || options.schema || 'main';
    var connection = await this._sqlite();
    rows = connection.query('PRAGMA ' + sqliteIdentifier(database) + '.foreign_key_list(' + sqliteLiteral(table) + ')').rows;
    return freezeArray(groupRows(rows, function (row) { return String(row.id); }, function (group) {
      var first = group[0];
      return {
        database: database,
        schema: database,
        table: table,
        name: 'fk_' + table + '_' + first.id,
        columns: freezeArray(group.map(function (row) { return row.from; })),
        referencedDatabase: database,
        referencedSchema: database,
        referencedTable: first.table,
        referencedColumns: freezeArray(group.map(function (row) { return row.to; })),
        onUpdate: first.on_update || null,
        onDelete: first.on_delete || null,
        match: first.match || null,
        native: freezeArray(group)
      };
    }));
  }

  return freezeArray([]);
};

Metadata.prototype.constraints = async function constraints(table, options) {
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('NuBloxSQL metadata.constraints() requires a table name');
  options = options || {};
  var rows;

  if (this.dialect === 'mysql') {
    rows = await this.client.all(sql`
      SELECT tc.CONSTRAINT_SCHEMA AS schemaName,
             tc.TABLE_NAME AS tableName,
             tc.CONSTRAINT_NAME AS constraintName,
             tc.CONSTRAINT_TYPE AS constraintType,
             kcu.COLUMN_NAME AS columnName,
             kcu.ORDINAL_POSITION AS ordinalPosition,
             cc.CHECK_CLAUSE AS checkClause
      FROM information_schema.TABLE_CONSTRAINTS tc
      LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
       AND kcu.TABLE_NAME = tc.TABLE_NAME
       AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
       AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = COALESCE(${options.schema || options.database || null}, DATABASE())
        AND tc.TABLE_NAME = ${table}
      ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `);
    return freezeArray(groupRows(rows, function (row) { return row.constraintName; }, function (group) {
      var first = group[0];
      return {
        database: first.schemaName,
        schema: first.schemaName,
        table: first.tableName,
        name: first.constraintName,
        type: constraintType(first.constraintType),
        columns: freezeArray(group.filter(function (row) { return row.columnName !== null; }).map(function (row) { return row.columnName; })),
        definition: first.checkClause || null,
        native: freezeArray(group)
      };
    }));
  }

  if (this.dialect === 'postgresql') {
    rows = await this.client.all(sql`
      SELECT current_database() AS databaseName,
             n.nspname AS schemaName,
             t.relname AS tableName,
             c.conname AS constraintName,
             CASE c.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE' WHEN 'f' THEN 'FOREIGN KEY' WHEN 'c' THEN 'CHECK' WHEN 'x' THEN 'EXCLUDE' ELSE c.contype::text END AS constraintType,
             pg_catalog.pg_get_constraintdef(c.oid, TRUE) AS definition,
             a.attname AS columnName,
             cols.ordinality AS ordinalPosition
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality) ON TRUE
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = cols.attnum
      WHERE n.nspname = COALESCE(${options.schema || null}, current_schema())
        AND t.relname = ${table}
      ORDER BY c.conname, cols.ordinality
    `);
    return freezeArray(groupRows(rows, function (row) { return row.constraintName; }, function (group) {
      var first = group[0];
      return {
        database: first.databaseName,
        schema: first.schemaName,
        table: first.tableName,
        name: first.constraintName,
        type: constraintType(first.constraintType),
        columns: freezeArray(group.filter(function (row) { return row.columnName !== null; }).map(function (row) { return row.columnName; })),
        definition: first.definition || null,
        native: freezeArray(group)
      };
    }));
  }

  if (this.dialect === 'sqlite') {
    var columns = await this.columns(table, options);
    var indexes = await this.indexes(table, options);
    var foreignKeys = await this.foreignKeys(table, options);
    var output = [];
    var primary = columns.filter(function (column) { return column.primaryKey; }).sort(function (a, b) { return (a.primaryKeyOrdinal || 0) - (b.primaryKeyOrdinal || 0); });
    if (primary.length) {
      output.push({ database: primary[0].database, schema: primary[0].schema, table: table, name: 'PRIMARY', type: 'primary-key', columns: freezeArray(primary.map(function (column) { return column.name; })), definition: null, native: null });
    }
    indexes.forEach(function (index) {
      if (index.unique && !index.primary) output.push({ database: index.database, schema: index.schema, table: table, name: index.name, type: 'unique', columns: index.columns, definition: index.definition, native: index.native });
    });
    foreignKeys.forEach(function (foreignKey) {
      output.push({ database: foreignKey.database, schema: foreignKey.schema, table: table, name: foreignKey.name, type: 'foreign-key', columns: foreignKey.columns, definition: null, native: foreignKey.native });
    });
    return freezeArray(output);
  }

  return freezeArray([]);
};

Metadata.prototype.table = async function table(name, options) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('NuBloxSQL metadata.table() requires a table name');
  options = options || {};
  var tables = await this.tables(options);
  var summary = tables.find(function (entry) { return entry.name === name; });
  if (!summary) return null;
  var details = await Promise.all([
    this.columns(name, options),
    this.indexes(name, options),
    this.foreignKeys(name, options),
    this.constraints(name, options)
  ]);
  return Object.freeze(Object.assign({}, summary, {
    columns: details[0],
    indexes: details[1],
    foreignKeys: details[2],
    constraints: details[3]
  }));
};

exports.Metadata = Metadata;
