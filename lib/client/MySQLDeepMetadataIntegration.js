'use strict';

var sql = require('./Sql').sql;

function freezeObject(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  return Object.freeze(value);
}

function freezeArray(values) {
  return Object.freeze((values || []).map(function (value) {
    return value && typeof value === 'object' ? freezeObject(value) : value;
  }));
}

function mysql(metadata) { return metadata && metadata.dialect === 'mysql'; }
function scope(options) {
  options = options || {};
  return { schema: options.schema || options.database || null, includeSystem: options.includeSystem === true };
}
function yn(value) { return String(value || '').toUpperCase() === 'YES'; }
function num(value) { return value === null || value === undefined ? null : Number(value); }

async function tableDetails(name, options) {
  if (!mysql(this)) return null;
  if (typeof name !== 'string' || !name.length) throw new TypeError('NuBloxSQL metadata.tableDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
           ENGINE AS engine, VERSION AS engine_version, ROW_FORMAT AS row_format, TABLE_ROWS AS estimated_rows,
           AVG_ROW_LENGTH AS average_row_length, DATA_LENGTH AS data_length, MAX_DATA_LENGTH AS max_data_length,
           INDEX_LENGTH AS index_length, DATA_FREE AS data_free, AUTO_INCREMENT AS auto_increment,
           TABLE_COLLATION AS collation_name, CHECKSUM AS checksum_value, CREATE_OPTIONS AS create_options,
           TABLE_COMMENT AS comment
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE()) AND TABLE_NAME = ${name}
    LIMIT 1
  `);
  if (!rows.length) return null;
  var row = rows[0];
  return freezeObject({
    database: row.schema_name, schema: row.schema_name, name: row.table_name,
    kind: String(row.table_type || '').toUpperCase().indexOf('VIEW') >= 0 ? 'view' : 'table',
    engine: row.engine || null, engineVersion: num(row.engine_version), rowFormat: row.row_format || null,
    estimatedRows: num(row.estimated_rows), averageRowLength: num(row.average_row_length), dataLength: num(row.data_length),
    maxDataLength: num(row.max_data_length), indexLength: num(row.index_length), dataFree: num(row.data_free),
    autoIncrement: row.auto_increment, collation: row.collation_name || null, checksum: row.checksum_value,
    createOptions: row.create_options || null, comment: row.comment || null, native: freezeObject(row)
  });
}

async function columnDetails(table, options) {
  if (!mysql(this)) return freezeArray([]);
  if (typeof table !== 'string' || !table.length) throw new TypeError('NuBloxSQL metadata.columnDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
           ORDINAL_POSITION AS ordinal_position, COLUMN_DEFAULT AS column_default, IS_NULLABLE AS is_nullable,
           DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name,
           COLLATION_NAME AS collation_name, CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
           CHARACTER_OCTET_LENGTH AS character_octet_length, NUMERIC_PRECISION AS numeric_precision,
           NUMERIC_SCALE AS numeric_scale, DATETIME_PRECISION AS datetime_precision, COLUMN_KEY AS column_key,
           EXTRA AS extra, PRIVILEGES AS privileges, COLUMN_COMMENT AS comment,
           GENERATION_EXPRESSION AS generation_expression
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE()) AND TABLE_NAME = ${table}
    ORDER BY ORDINAL_POSITION
  `);
  return freezeArray(rows.map(function (row) {
    var extra = String(row.extra || '').toLowerCase();
    return {
      database: row.schema_name, schema: row.schema_name, table: row.table_name, name: row.column_name,
      ordinal: Number(row.ordinal_position), dataType: row.data_type, nativeType: row.column_type || row.data_type,
      nullable: yn(row.is_nullable), default: row.column_default, primaryKey: row.column_key === 'PRI',
      uniqueKey: row.column_key === 'UNI', indexed: !!row.column_key, identity: extra.indexOf('auto_increment') >= 0,
      generated: extra.indexOf('generated') >= 0 || !!row.generation_expression,
      generatedKind: extra.indexOf('virtual generated') >= 0 ? 'virtual' : (extra.indexOf('stored generated') >= 0 ? 'stored' : null),
      generationExpression: row.generation_expression || null, characterSet: row.character_set_name || null,
      collation: row.collation_name || null, characterMaximumLength: num(row.character_maximum_length),
      characterOctetLength: num(row.character_octet_length), numericPrecision: num(row.numeric_precision),
      numericScale: num(row.numeric_scale), datetimePrecision: num(row.datetime_precision),
      privileges: row.privileges ? freezeArray(String(row.privileges).split(',').filter(Boolean)) : freezeArray([]),
      comment: row.comment || null, native: freezeObject(row)
    };
  }));
}

async function indexDetails(table, options) {
  if (!mysql(this)) return freezeArray([]);
  if (typeof table !== 'string' || !table.length) throw new TypeError('NuBloxSQL metadata.indexDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, INDEX_NAME AS index_name,
           NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS sequence_in_index, COLUMN_NAME AS column_name,
           COLLATION AS collation, CARDINALITY AS cardinality, SUB_PART AS sub_part, PACKED AS packed,
           NULLABLE AS nullable, INDEX_TYPE AS index_type, COMMENT AS comment, INDEX_COMMENT AS index_comment,
           IS_VISIBLE AS is_visible, EXPRESSION AS expression
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE()) AND TABLE_NAME = ${table}
    ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `);
  var order = [], groups = Object.create(null);
  rows.forEach(function (row) { if (!groups[row.index_name]) { groups[row.index_name] = []; order.push(row.index_name); } groups[row.index_name].push(row); });
  return freezeArray(order.map(function (name) {
    var group = groups[name], first = group[0];
    return {
      database: first.schema_name, schema: first.schema_name, table: first.table_name, name: name,
      unique: Number(first.non_unique) === 0, primary: name === 'PRIMARY', type: first.index_type || null,
      visible: yn(first.is_visible), comment: first.index_comment || first.comment || null,
      columns: freezeArray(group.map(function (row) { return freezeObject({
        ordinal: Number(row.sequence_in_index), name: row.column_name || null, expression: row.expression || null,
        collation: row.collation || null, cardinality: num(row.cardinality), prefixLength: num(row.sub_part),
        nullable: yn(row.nullable)
      }); })), native: freezeArray(group.map(freezeObject))
    };
  }));
}

async function constraintDetails(table, options) {
  if (!mysql(this)) return freezeArray([]);
  if (typeof table !== 'string' || !table.length) throw new TypeError('NuBloxSQL metadata.constraintDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT tc.CONSTRAINT_SCHEMA AS schema_name, tc.TABLE_NAME AS table_name, tc.CONSTRAINT_NAME AS constraint_name,
           tc.CONSTRAINT_TYPE AS constraint_type, rc.UNIQUE_CONSTRAINT_SCHEMA AS referenced_schema,
           rc.REFERENCED_TABLE_NAME AS referenced_table, rc.MATCH_OPTION AS match_option,
           rc.UPDATE_RULE AS update_rule, rc.DELETE_RULE AS delete_rule, cc.CHECK_CLAUSE AS check_clause,
           tc.ENFORCED AS enforced
    FROM information_schema.TABLE_CONSTRAINTS tc
    LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
    LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
    WHERE tc.TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE()) AND tc.TABLE_NAME = ${table}
    ORDER BY tc.CONSTRAINT_NAME
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.schema_name, schema: row.schema_name, table: row.table_name, name: row.constraint_name,
      type: String(row.constraint_type || '').toLowerCase().replace(/ /g, '-'), enforced: yn(row.enforced),
      referencedSchema: row.referenced_schema || null, referencedTable: row.referenced_table || null,
      match: row.match_option || null, updateRule: row.update_rule || null, deleteRule: row.delete_rule || null,
      check: row.check_clause || null, native: freezeObject(row)
    };
  }));
}

async function partitions(options) {
  if (!mysql(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, PARTITION_NAME AS partition_name,
           SUBPARTITION_NAME AS subpartition_name, PARTITION_ORDINAL_POSITION AS partition_ordinal,
           SUBPARTITION_ORDINAL_POSITION AS subpartition_ordinal, PARTITION_METHOD AS partition_method,
           SUBPARTITION_METHOD AS subpartition_method, PARTITION_EXPRESSION AS partition_expression,
           SUBPARTITION_EXPRESSION AS subpartition_expression, PARTITION_DESCRIPTION AS partition_description,
           TABLE_ROWS AS estimated_rows, DATA_LENGTH AS data_length, INDEX_LENGTH AS index_length,
           DATA_FREE AS data_free, TABLESPACE_NAME AS tablespace_name
    FROM information_schema.PARTITIONS
    WHERE TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE()) AND PARTITION_NAME IS NOT NULL
    ORDER BY TABLE_NAME, PARTITION_ORDINAL_POSITION, SUBPARTITION_ORDINAL_POSITION
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.schema_name, schema: row.schema_name, table: row.table_name, name: row.partition_name,
      subpartition: row.subpartition_name || null, ordinal: num(row.partition_ordinal), subpartitionOrdinal: num(row.subpartition_ordinal),
      method: row.partition_method || null, subpartitionMethod: row.subpartition_method || null,
      expression: row.partition_expression || null, subpartitionExpression: row.subpartition_expression || null,
      description: row.partition_description, estimatedRows: num(row.estimated_rows), dataLength: num(row.data_length),
      indexLength: num(row.index_length), dataFree: num(row.data_free), tablespace: row.tablespace_name || null,
      native: freezeObject(row)
    };
  }));
}

async function routines(options) {
  if (!mysql(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT ROUTINE_SCHEMA AS schema_name, ROUTINE_NAME AS routine_name, ROUTINE_TYPE AS routine_type,
           DATA_TYPE AS data_type, ROUTINE_BODY AS routine_body, ROUTINE_DEFINITION AS routine_definition,
           EXTERNAL_LANGUAGE AS external_language, IS_DETERMINISTIC AS is_deterministic,
           SQL_DATA_ACCESS AS sql_data_access, SECURITY_TYPE AS security_type, DEFINER AS definer,
           SQL_MODE AS sql_mode, ROUTINE_COMMENT AS comment, CHARACTER_SET_CLIENT AS character_set_client,
           COLLATION_CONNECTION AS collation_connection, DATABASE_COLLATION AS database_collation
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = COALESCE(${s.schema}, DATABASE())
    ORDER BY ROUTINE_NAME
  `);
  return freezeArray(rows.map(function (row) { return {
    database: row.schema_name, schema: row.schema_name, name: row.routine_name,
    kind: String(row.routine_type || '').toLowerCase(), dataType: row.data_type || null,
    body: row.routine_body || null, definition: row.routine_definition || null, language: row.external_language || null,
    deterministic: yn(row.is_deterministic), dataAccess: row.sql_data_access || null, security: row.security_type || null,
    definer: row.definer || null, sqlMode: row.sql_mode || null, comment: row.comment || null,
    characterSetClient: row.character_set_client || null, collationConnection: row.collation_connection || null,
    databaseCollation: row.database_collation || null, native: freezeObject(row)
  }; }));
}

async function triggers(options) {
  if (!mysql(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT TRIGGER_SCHEMA AS schema_name, TRIGGER_NAME AS trigger_name, EVENT_MANIPULATION AS event_manipulation,
           EVENT_OBJECT_TABLE AS table_name, ACTION_ORDER AS action_order, ACTION_CONDITION AS action_condition,
           ACTION_STATEMENT AS action_statement, ACTION_ORIENTATION AS action_orientation,
           ACTION_TIMING AS action_timing, DEFINER AS definer, SQL_MODE AS sql_mode,
           CHARACTER_SET_CLIENT AS character_set_client, COLLATION_CONNECTION AS collation_connection,
           DATABASE_COLLATION AS database_collation
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = COALESCE(${s.schema}, DATABASE())
    ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME
  `);
  return freezeArray(rows.map(function (row) { return {
    database: row.schema_name, schema: row.schema_name, name: row.trigger_name, table: row.table_name,
    event: row.event_manipulation, timing: row.action_timing, orientation: row.action_orientation,
    order: num(row.action_order), condition: row.action_condition || null, statement: row.action_statement || null,
    definer: row.definer || null, sqlMode: row.sql_mode || null, native: freezeObject(row)
  }; }));
}

async function events(options) {
  if (!mysql(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT EVENT_SCHEMA AS schema_name, EVENT_NAME AS event_name, DEFINER AS definer, TIME_ZONE AS time_zone,
           EVENT_BODY AS event_body, EVENT_DEFINITION AS event_definition, EVENT_TYPE AS event_type,
           EXECUTE_AT AS execute_at, INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field,
           SQL_MODE AS sql_mode, STARTS AS starts, ENDS AS ends, STATUS AS status,
           ON_COMPLETION AS on_completion, EVENT_COMMENT AS comment, ORIGINATOR AS originator
    FROM information_schema.EVENTS
    WHERE EVENT_SCHEMA = COALESCE(${s.schema}, DATABASE())
    ORDER BY EVENT_NAME
  `);
  return freezeArray(rows.map(function (row) { return {
    database: row.schema_name, schema: row.schema_name, name: row.event_name, definer: row.definer || null,
    timeZone: row.time_zone || null, body: row.event_body || null, definition: row.event_definition || null,
    type: row.event_type || null, executeAt: row.execute_at || null, intervalValue: row.interval_value || null,
    intervalField: row.interval_field || null, starts: row.starts || null, ends: row.ends || null,
    status: row.status || null, onCompletion: row.on_completion || null, comment: row.comment || null,
    originator: num(row.originator), native: freezeObject(row)
  }; }));
}

async function privileges(options) {
  if (!mysql(this)) return freezeArray([]);
  var s = scope(options);
  var schemaRows = await this.client.all(sql`
    SELECT 'schema' AS object_kind, TABLE_SCHEMA AS schema_name, NULL AS object_name,
           GRANTEE AS grantee, PRIVILEGE_TYPE AS privilege_type, IS_GRANTABLE AS is_grantable
    FROM information_schema.SCHEMA_PRIVILEGES
    WHERE TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE())
  `);
  var tableRows = await this.client.all(sql`
    SELECT 'table' AS object_kind, TABLE_SCHEMA AS schema_name, TABLE_NAME AS object_name,
           GRANTEE AS grantee, PRIVILEGE_TYPE AS privilege_type, IS_GRANTABLE AS is_grantable
    FROM information_schema.TABLE_PRIVILEGES
    WHERE TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE())
  `);
  var columnRows = await this.client.all(sql`
    SELECT 'column' AS object_kind, TABLE_SCHEMA AS schema_name,
           CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS object_name, GRANTEE AS grantee,
           PRIVILEGE_TYPE AS privilege_type, IS_GRANTABLE AS is_grantable
    FROM information_schema.COLUMN_PRIVILEGES
    WHERE TABLE_SCHEMA = COALESCE(${s.schema}, DATABASE())
  `);
  var userRows = await this.client.all(sql`
    SELECT 'global' AS object_kind, NULL AS schema_name, NULL AS object_name,
           GRANTEE AS grantee, PRIVILEGE_TYPE AS privilege_type, IS_GRANTABLE AS is_grantable
    FROM information_schema.USER_PRIVILEGES
  `);
  return freezeArray(schemaRows.concat(tableRows, columnRows, userRows).map(function (row) { return {
    database: row.schema_name || null, schema: row.schema_name || null, objectKind: row.object_kind,
    object: row.object_name || null, grantee: row.grantee, privilege: row.privilege_type,
    grantable: yn(row.is_grantable), native: freezeObject(row)
  }; }));
}

async function deepCatalog(options) {
  if (!mysql(this)) return freezeObject({ dialect: this.dialect, partitions: freezeArray([]), routines: freezeArray([]), triggers: freezeArray([]), events: freezeArray([]), privileges: freezeArray([]) });
  return freezeObject({
    dialect: 'mysql', partitions: await this.partitions(options), routines: await this.routines(options),
    triggers: await this.triggers(options), events: await this.events(options), privileges: await this.privileges(options)
  });
}

function wrap(p, name, implementation) {
  var previous = p[name];
  p[name] = function () {
    if (mysql(this)) return implementation.apply(this, arguments);
    if (typeof previous === 'function') return previous.apply(this, arguments);
    return name === 'tableDetails' ? Promise.resolve(null) : Promise.resolve(name === 'deepCatalog' ? freezeObject({ dialect: this.dialect }) : freezeArray([]));
  };
}

function install(metadataApi) {
  if (!metadataApi || !metadataApi.Metadata) return;
  var p = metadataApi.Metadata.prototype;
  wrap(p, 'tableDetails', tableDetails);
  wrap(p, 'columnDetails', columnDetails);
  wrap(p, 'indexDetails', indexDetails);
  wrap(p, 'constraintDetails', constraintDetails);
  wrap(p, 'partitions', partitions);
  wrap(p, 'routines', routines);
  wrap(p, 'privileges', privileges);
  wrap(p, 'deepCatalog', deepCatalog);
  if (!p.triggers) p.triggers = triggers;
  if (!p.events) p.events = events;
}

exports.install = install;
exports.tableDetails = tableDetails;
exports.columnDetails = columnDetails;
exports.indexDetails = indexDetails;
exports.constraintDetails = constraintDetails;
exports.partitions = partitions;
exports.routines = routines;
exports.triggers = triggers;
exports.events = events;
exports.privileges = privileges;
exports.deepCatalog = deepCatalog;
