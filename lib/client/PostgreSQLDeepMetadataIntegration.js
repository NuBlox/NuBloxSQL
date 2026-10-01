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

function scope(options) {
  options = options || {};
  return {
    schema: options.schema || null,
    includeSystem: options.includeSystem === true
  };
}

function emptyUnlessPostgres(metadata) {
  return metadata && metadata.dialect === 'postgresql';
}

function relationKind(value) {
  return ({ r: 'table', p: 'partitioned-table', v: 'view', m: 'materialized-view', f: 'foreign-table', S: 'sequence' })[value] || value || 'unknown';
}

function persistence(value) {
  return ({ p: 'permanent', u: 'unlogged', t: 'temporary' })[value] || value || null;
}

function replicaIdentity(value) {
  return ({ d: 'default', n: 'nothing', f: 'full', i: 'index' })[value] || value || null;
}

function identityGeneration(value) {
  return ({ a: 'always', d: 'by-default' })[value] || null;
}

function generatedKind(value) {
  return value === 's' ? 'stored' : value === 'v' ? 'virtual' : null;
}

function routineKind(value) {
  return ({ f: 'function', p: 'procedure', a: 'aggregate', w: 'window' })[value] || value || 'unknown';
}

function typeKind(value) {
  return ({ b: 'base', c: 'composite', d: 'domain', e: 'enum', p: 'pseudo', r: 'range', m: 'multirange' })[value] || value || 'unknown';
}

function constraintKind(value) {
  return ({ p: 'primary-key', u: 'unique', f: 'foreign-key', c: 'check', x: 'exclusion', t: 'constraint-trigger' })[value] || value || 'unknown';
}

async function tableDetails(name, options) {
  if (!emptyUnlessPostgres(this)) return null;
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('NuBloxSQL metadata.tableDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           n.nspname AS schema_name,
           c.relname AS table_name,
           c.relkind AS relation_kind,
           c.relpersistence AS persistence,
           r.rolname AS owner_name,
           ts.spcname AS tablespace_name,
           c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security,
           c.relispartition AS is_partition,
           pg_catalog.pg_get_partkeydef(c.oid) AS partition_key,
           pg_catalog.pg_get_expr(c.relpartbound, c.oid, TRUE) AS partition_bound,
           c.relreplident AS replica_identity,
           c.reltuples AS estimated_rows,
           c.relpages AS pages,
           pg_catalog.obj_description(c.oid, 'pg_class') AS comment
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid = c.reltablespace
    WHERE c.relname = ${name}
      AND (${s.schema} IS NULL OR n.nspname = ${s.schema})
      AND c.relkind IN ('r','p','v','m','f')
      AND ((${s.includeSystem} = TRUE) OR (
        n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp_%'
      ))
    ORDER BY n.nspname
  `);
  if (!rows.length) return null;
  var row = rows[0];
  return freezeObject({
    database: row.database_name || null,
    schema: row.schema_name,
    name: row.table_name,
    kind: relationKind(row.relation_kind),
    persistence: persistence(row.persistence),
    owner: row.owner_name || null,
    tablespace: row.tablespace_name || null,
    rowSecurity: row.row_security === true,
    forceRowSecurity: row.force_row_security === true,
    partition: row.is_partition === true,
    partitionKey: row.partition_key || null,
    partitionBound: row.partition_bound || null,
    replicaIdentity: replicaIdentity(row.replica_identity),
    estimatedRows: row.estimated_rows === null ? null : Number(row.estimated_rows),
    pages: row.pages === null ? null : Number(row.pages),
    comment: row.comment || null,
    native: freezeObject(row)
  });
}

async function columnDetails(table, options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('NuBloxSQL metadata.columnDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           n.nspname AS schema_name,
           c.relname AS table_name,
           a.attname AS column_name,
           a.attnum AS ordinal_position,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
           tn.nspname AS type_schema,
           t.typname AS type_name,
           a.attnotnull AS not_null,
           a.attidentity AS identity_kind,
           a.attgenerated AS generated_kind,
           pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, TRUE) AS expression,
           pg_catalog.pg_get_serial_sequence(pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname), a.attname) AS sequence_name,
           coll.collname AS collation_name,
           a.attstorage AS storage_kind,
           a.attcompression AS compression,
           a.attstattarget AS statistics_target,
           pg_catalog.col_description(c.oid, a.attnum) AS comment
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
    WHERE c.relname = ${table}
      AND (${s.schema} IS NULL OR n.nspname = ${s.schema})
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND ((${s.includeSystem} = TRUE) OR (
        n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp_%'
      ))
    ORDER BY a.attnum
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.database_name || null,
      schema: row.schema_name,
      table: row.table_name,
      name: row.column_name,
      ordinal: Number(row.ordinal_position),
      formattedType: row.formatted_type,
      typeSchema: row.type_schema,
      nativeType: row.type_name,
      nullable: row.not_null !== true,
      identity: identityGeneration(row.identity_kind),
      generated: generatedKind(row.generated_kind),
      expression: row.expression || null,
      sequence: row.sequence_name || null,
      collation: row.collation_name || null,
      storage: row.storage_kind || null,
      compression: row.compression || null,
      statisticsTarget: row.statistics_target === null ? null : Number(row.statistics_target),
      comment: row.comment || null,
      native: freezeObject(row)
    };
  }));
}

async function indexDetails(table, options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('NuBloxSQL metadata.indexDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           n.nspname AS schema_name,
           c.relname AS table_name,
           irel.relname AS index_name,
           am.amname AS method,
           i.indisunique AS is_unique,
           i.indisprimary AS is_primary,
           i.indisexclusion AS is_exclusion,
           i.indimmediate AS is_immediate,
           i.indisclustered AS is_clustered,
           i.indisvalid AS is_valid,
           i.indisready AS is_ready,
           i.indislive AS is_live,
           i.indisreplident AS is_replica_identity,
           i.indnullsnotdistinct AS nulls_not_distinct,
           i.indnkeyatts AS key_attribute_count,
           i.indnatts AS total_attribute_count,
           pg_catalog.pg_get_expr(i.indpred, i.indrelid, TRUE) AS predicate,
           pg_catalog.pg_get_expr(i.indexprs, i.indrelid, TRUE) AS expressions,
           pg_catalog.pg_get_indexdef(irel.oid) AS definition,
           ts.spcname AS tablespace_name,
           pg_catalog.obj_description(irel.oid, 'pg_class') AS comment
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_class irel ON irel.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = irel.relam
    LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid = irel.reltablespace
    WHERE c.relname = ${table}
      AND (${s.schema} IS NULL OR n.nspname = ${s.schema})
    ORDER BY irel.relname
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.database_name || null,
      schema: row.schema_name,
      table: row.table_name,
      name: row.index_name,
      method: row.method || null,
      unique: row.is_unique === true,
      primary: row.is_primary === true,
      exclusion: row.is_exclusion === true,
      immediate: row.is_immediate === true,
      clustered: row.is_clustered === true,
      valid: row.is_valid === true,
      ready: row.is_ready === true,
      live: row.is_live === true,
      replicaIdentity: row.is_replica_identity === true,
      nullsNotDistinct: row.nulls_not_distinct === true,
      keyAttributeCount: Number(row.key_attribute_count),
      totalAttributeCount: Number(row.total_attribute_count),
      predicate: row.predicate || null,
      expressions: row.expressions || null,
      definition: row.definition || null,
      tablespace: row.tablespace_name || null,
      comment: row.comment || null,
      native: freezeObject(row)
    };
  }));
}

async function constraintDetails(table, options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('NuBloxSQL metadata.constraintDetails() requires a table name');
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           n.nspname AS schema_name,
           c.relname AS table_name,
           con.conname AS constraint_name,
           con.contype AS constraint_type,
           con.condeferrable AS deferrable,
           con.condeferred AS initially_deferred,
           con.convalidated AS validated,
           con.connoinherit AS no_inherit,
           con.conparentid AS parent_constraint_oid,
           pg_catalog.pg_get_constraintdef(con.oid, TRUE) AS definition,
           rn.nspname AS referenced_schema,
           rc.relname AS referenced_table
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
    LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE c.relname = ${table}
      AND (${s.schema} IS NULL OR n.nspname = ${s.schema})
    ORDER BY con.conname
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.database_name || null,
      schema: row.schema_name,
      table: row.table_name,
      name: row.constraint_name,
      type: constraintKind(row.constraint_type),
      deferrable: row.deferrable === true,
      initiallyDeferred: row.initially_deferred === true,
      validated: row.validated === true,
      noInherit: row.no_inherit === true,
      inherited: Number(row.parent_constraint_oid || 0) !== 0,
      definition: row.definition || null,
      referencedSchema: row.referenced_schema || null,
      referencedTable: row.referenced_table || null,
      native: freezeObject(row)
    };
  }));
}

async function partitions(options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           pn.nspname AS parent_schema,
           parent.relname AS parent_name,
           cn.nspname AS child_schema,
           child.relname AS child_name,
           pg_catalog.pg_get_partkeydef(parent.oid) AS partition_key,
           pg_catalog.pg_get_expr(child.relpartbound, child.oid, TRUE) AS partition_bound,
           child.relpersistence AS persistence,
           child.reltuples AS estimated_rows,
           child.relpages AS pages
    FROM pg_catalog.pg_inherits inh
    JOIN pg_catalog.pg_class parent ON parent.oid = inh.inhparent
    JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
    JOIN pg_catalog.pg_class child ON child.oid = inh.inhrelid
    JOIN pg_catalog.pg_namespace cn ON cn.oid = child.relnamespace
    WHERE parent.relkind = 'p'
      AND (${s.schema} IS NULL OR pn.nspname = ${s.schema} OR cn.nspname = ${s.schema})
      AND ((${s.includeSystem} = TRUE) OR (
        pn.nspname NOT IN ('pg_catalog', 'information_schema')
        AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
      ))
    ORDER BY pn.nspname, parent.relname, cn.nspname, child.relname
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.database_name || null,
      parentSchema: row.parent_schema,
      parent: row.parent_name,
      schema: row.child_schema,
      name: row.child_name,
      key: row.partition_key || null,
      bound: row.partition_bound || null,
      persistence: persistence(row.persistence),
      estimatedRows: row.estimated_rows === null ? null : Number(row.estimated_rows),
      pages: row.pages === null ? null : Number(row.pages),
      native: freezeObject(row)
    };
  }));
}

async function policies(options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           n.nspname AS schema_name,
           c.relname AS table_name,
           p.polname AS policy_name,
           p.polcmd AS command,
           p.polpermissive AS permissive,
           ARRAY(SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.oid = ANY(p.polroles) ORDER BY r.rolname) AS roles,
           pg_catalog.pg_get_expr(p.polqual, p.polrelid, TRUE) AS using_expression,
           pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, TRUE) AS check_expression
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE (${s.schema} IS NULL OR n.nspname = ${s.schema})
      AND ((${s.includeSystem} = TRUE) OR n.nspname NOT IN ('pg_catalog', 'information_schema'))
    ORDER BY n.nspname, c.relname, p.polname
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.database_name || null,
      schema: row.schema_name,
      table: row.table_name,
      name: row.policy_name,
      command: ({ r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' })[row.command] || row.command,
      permissive: row.permissive === true,
      roles: freezeArray(Array.isArray(row.roles) ? row.roles : []),
      using: row.using_expression || null,
      check: row.check_expression || null,
      native: freezeObject(row)
    };
  }));
}

async function routines(options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           n.nspname AS schema_name,
           p.proname AS routine_name,
           p.prokind AS routine_kind,
           l.lanname AS language,
           r.rolname AS owner_name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
           pg_catalog.pg_get_function_result(p.oid) AS result_type,
           p.provolatile AS volatility,
           p.proisstrict AS strict,
           p.prosecdef AS security_definer,
           p.proleakproof AS leakproof,
           p.proparallel AS parallel_safety,
           p.procost AS cost,
           p.prorows AS estimated_rows,
           p.proconfig AS configuration,
           CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END AS definition,
           pg_catalog.obj_description(p.oid, 'pg_proc') AS comment
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    WHERE (${s.schema} IS NULL OR n.nspname = ${s.schema})
      AND ((${s.includeSystem} = TRUE) OR (
        n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
      ))
    ORDER BY n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.database_name || null,
      schema: row.schema_name,
      name: row.routine_name,
      kind: routineKind(row.routine_kind),
      language: row.language,
      owner: row.owner_name || null,
      identityArguments: row.identity_arguments || '',
      arguments: row.arguments || '',
      resultType: row.result_type || null,
      volatility: ({ i: 'immutable', s: 'stable', v: 'volatile' })[row.volatility] || row.volatility,
      strict: row.strict === true,
      securityDefiner: row.security_definer === true,
      leakproof: row.leakproof === true,
      parallelSafety: ({ s: 'safe', r: 'restricted', u: 'unsafe' })[row.parallel_safety] || row.parallel_safety,
      cost: row.cost === null ? null : Number(row.cost),
      estimatedRows: row.estimated_rows === null ? null : Number(row.estimated_rows),
      configuration: freezeArray(Array.isArray(row.configuration) ? row.configuration : []),
      definition: row.definition || null,
      comment: row.comment || null,
      native: freezeObject(row)
    };
  }));
}

async function types(options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT t.oid AS type_oid,
           current_database() AS database_name,
           n.nspname AS schema_name,
           t.typname AS type_name,
           t.typtype AS type_kind,
           t.typcategory AS category,
           t.typispreferred AS preferred,
           t.typnotnull AS not_null,
           t.typdefault AS default_value,
           t.typdelim AS delimiter,
           bt.typname AS base_type,
           et.typname AS element_type,
           col.collname AS collation_name,
           rt.typname AS range_subtype,
           mt.typname AS multirange_type,
           pg_catalog.obj_description(t.oid, 'pg_type') AS comment
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_type bt ON bt.oid = t.typbasetype AND t.typbasetype <> 0
    LEFT JOIN pg_catalog.pg_type et ON et.oid = t.typelem AND t.typelem <> 0
    LEFT JOIN pg_catalog.pg_collation col ON col.oid = t.typcollation AND t.typcollation <> 0
    LEFT JOIN pg_catalog.pg_range rg ON rg.rngtypid = t.oid
    LEFT JOIN pg_catalog.pg_type rt ON rt.oid = rg.rngsubtype
    LEFT JOIN pg_catalog.pg_type mt ON mt.oid = rg.rngmultitypid
    WHERE (${s.schema} IS NULL OR n.nspname = ${s.schema})
      AND t.typtype IN ('c','d','e','r','m')
      AND ((${s.includeSystem} = TRUE) OR n.nspname NOT IN ('pg_catalog', 'information_schema'))
    ORDER BY n.nspname, t.typname
  `);
  if (!rows.length) return freezeArray([]);
  var enumRows = await this.client.all(sql`
    SELECT e.enumtypid AS type_oid, e.enumlabel AS enum_label, e.enumsortorder AS sort_order
    FROM pg_catalog.pg_enum e
    ORDER BY e.enumtypid, e.enumsortorder
  `);
  var domainRows = await this.client.all(sql`
    SELECT con.contypid AS type_oid, con.conname AS constraint_name,
           pg_catalog.pg_get_constraintdef(con.oid, TRUE) AS definition,
           con.convalidated AS validated
    FROM pg_catalog.pg_constraint con
    WHERE con.contypid <> 0
    ORDER BY con.contypid, con.conname
  `);
  var enums = Object.create(null);
  enumRows.forEach(function (row) {
    var key = String(row.type_oid);
    if (!enums[key]) enums[key] = [];
    enums[key].push(freezeObject({ label: row.enum_label, order: Number(row.sort_order) }));
  });
  var domains = Object.create(null);
  domainRows.forEach(function (row) {
    var key = String(row.type_oid);
    if (!domains[key]) domains[key] = [];
    domains[key].push(freezeObject({ name: row.constraint_name, definition: row.definition || null, validated: row.validated === true }));
  });
  return freezeArray(rows.map(function (row) {
    var key = String(row.type_oid);
    return {
      database: row.database_name || null,
      schema: row.schema_name,
      name: row.type_name,
      kind: typeKind(row.type_kind),
      category: row.category || null,
      preferred: row.preferred === true,
      nullable: row.not_null !== true,
      default: row.default_value || null,
      delimiter: row.delimiter || null,
      baseType: row.base_type || null,
      elementType: row.element_type || null,
      collation: row.collation_name || null,
      rangeSubtype: row.range_subtype || null,
      multirangeType: row.multirange_type || null,
      enumValues: freezeArray(enums[key] || []),
      domainConstraints: freezeArray(domains[key] || []),
      comment: row.comment || null,
      native: freezeObject(row)
    };
  }));
}

async function sequences(options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  var s = scope(options);
  var rows = await this.client.all(sql`
    SELECT current_database() AS database_name,
           schemaname AS schema_name,
           sequencename AS sequence_name,
           sequenceowner AS owner_name,
           data_type,
           start_value,
           min_value,
           max_value,
           increment_by,
           cycle,
           cache_size,
           last_value
    FROM pg_catalog.pg_sequences
    WHERE (${s.schema} IS NULL OR schemaname = ${s.schema})
      AND ((${s.includeSystem} = TRUE) OR schemaname NOT IN ('pg_catalog', 'information_schema'))
    ORDER BY schemaname, sequencename
  `);
  return freezeArray(rows.map(function (row) {
    return {
      database: row.database_name || null,
      schema: row.schema_name,
      name: row.sequence_name,
      owner: row.owner_name || null,
      dataType: row.data_type || null,
      start: row.start_value,
      min: row.min_value,
      max: row.max_value,
      increment: row.increment_by,
      cycle: row.cycle === true,
      cache: row.cache_size,
      lastValue: row.last_value,
      native: freezeObject(row)
    };
  }));
}

async function privileges(options) {
  if (!emptyUnlessPostgres(this)) return freezeArray([]);
  var s = scope(options);
  var tableRows = await this.client.all(sql`
    SELECT 'table' AS object_kind,
           table_catalog AS database_name,
           table_schema AS schema_name,
           table_name AS object_name,
           grantor, grantee, privilege_type, is_grantable
    FROM information_schema.table_privileges
    WHERE (${s.schema} IS NULL OR table_schema = ${s.schema})
      AND ((${s.includeSystem} = TRUE) OR table_schema NOT IN ('pg_catalog', 'information_schema'))
  `);
  var routineRows = await this.client.all(sql`
    SELECT 'routine' AS object_kind,
           routine_catalog AS database_name,
           routine_schema AS schema_name,
           routine_name AS object_name,
           grantor, grantee, privilege_type, is_grantable
    FROM information_schema.routine_privileges
    WHERE (${s.schema} IS NULL OR routine_schema = ${s.schema})
      AND ((${s.includeSystem} = TRUE) OR routine_schema NOT IN ('pg_catalog', 'information_schema'))
  `);
  var usageRows = await this.client.all(sql`
    SELECT lower(object_type) AS object_kind,
           object_catalog AS database_name,
           object_schema AS schema_name,
           object_name,
           grantor, grantee, privilege_type, is_grantable
    FROM information_schema.usage_privileges
    WHERE (${s.schema} IS NULL OR object_schema = ${s.schema})
      AND ((${s.includeSystem} = TRUE) OR object_schema NOT IN ('pg_catalog', 'information_schema'))
  `);
  return freezeArray(tableRows.concat(routineRows, usageRows).map(function (row) {
    return {
      database: row.database_name || null,
      schema: row.schema_name || null,
      objectKind: row.object_kind,
      object: row.object_name,
      grantor: row.grantor || null,
      grantee: row.grantee,
      privilege: row.privilege_type,
      grantable: String(row.is_grantable || '').toUpperCase() === 'YES',
      native: freezeObject(row)
    };
  }));
}

async function deepCatalog(options) {
  if (!emptyUnlessPostgres(this)) return freezeObject({ dialect: this.dialect, partitions: freezeArray([]), policies: freezeArray([]), routines: freezeArray([]), types: freezeArray([]), sequences: freezeArray([]), privileges: freezeArray([]) });
  var results = await Promise.all([
    this.partitions(options),
    this.policies(options),
    this.routines(options),
    this.types(options),
    this.sequences(options),
    this.privileges(options)
  ]);
  return freezeObject({
    dialect: 'postgresql',
    partitions: results[0],
    policies: results[1],
    routines: results[2],
    types: results[3],
    sequences: results[4],
    privileges: results[5]
  });
}

function install(metadataApi) {
  if (!metadataApi || !metadataApi.Metadata) return;
  var Metadata = metadataApi.Metadata;
  if (!Metadata.prototype.tableDetails) Metadata.prototype.tableDetails = tableDetails;
  if (!Metadata.prototype.columnDetails) Metadata.prototype.columnDetails = columnDetails;
  if (!Metadata.prototype.indexDetails) Metadata.prototype.indexDetails = indexDetails;
  if (!Metadata.prototype.constraintDetails) Metadata.prototype.constraintDetails = constraintDetails;
  if (!Metadata.prototype.partitions) Metadata.prototype.partitions = partitions;
  if (!Metadata.prototype.policies) Metadata.prototype.policies = policies;
  if (!Metadata.prototype.routines) Metadata.prototype.routines = routines;
  if (!Metadata.prototype.types) Metadata.prototype.types = types;
  if (!Metadata.prototype.sequences) Metadata.prototype.sequences = sequences;
  if (!Metadata.prototype.privileges) Metadata.prototype.privileges = privileges;
  if (!Metadata.prototype.deepCatalog) Metadata.prototype.deepCatalog = deepCatalog;
}

exports.install = install;
exports.tableDetails = tableDetails;
exports.columnDetails = columnDetails;
exports.indexDetails = indexDetails;
exports.constraintDetails = constraintDetails;
exports.partitions = partitions;
exports.policies = policies;
exports.routines = routines;
exports.types = types;
exports.sequences = sequences;
exports.privileges = privileges;
exports.deepCatalog = deepCatalog;
