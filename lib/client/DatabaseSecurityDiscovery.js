'use strict';

// Read-only, engine-honest database security inspection.
// Deliberately excludes password hashes, tokens, authentication material,
// privilege mutation and claims of effective/full permissions.
const SCHEMA_VERSION = 1;
const DIALECTS = Object.freeze(['postgresql', 'mysql', 'sqlite', 'sqlserver']);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.keys(value).forEach(function (key) { freeze(value[key]); });
    Object.freeze(value);
  }
  return value;
}

function dialectOf(client) {
  if (!client || typeof client !== 'object' || typeof client.all !== 'function') {
    throw new TypeError('NuBloxSQL security discovery requires a NuBloxSQL-like client');
  }
  var dialect = String(client.dialect || '').toLowerCase();
  if (dialect === 'postgres' || dialect === 'pg') dialect = 'postgresql';
  if (dialect === 'mssql' || dialect === 'sql-server') dialect = 'sqlserver';
  if (DIALECTS.indexOf(dialect) === -1) throw new RangeError('Unsupported database security discovery dialect: ' + dialect);
  return dialect;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(label + ' must be a non-empty string');
  }
  return value;
}

function nullable(value) {
  return value === null || value === undefined ? null : String(value);
}

function flag(value) {
  if (value === null || value === undefined) return null;
  if (value === true || value === 1 || value === '1' || value === 't' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'f' || value === 'false') return false;
  return null;
}

function integer(value, label) {
  if (value === null || value === undefined) return null;
  var v = Number(value);
  if (!Number.isSafeInteger(v)) throw new TypeError(label + ' must be an integer');
  return v;
}

function requiredRows(value) {
  if (!Array.isArray(value)) throw new TypeError('Security discovery expected database rows');
  return value;
}

function bounded(rows, maxRows) {
  rows = requiredRows(rows);
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}

function pgSql(limit) {
  return {
    principals: 'SELECT rolname AS name, rolcanlogin AS can_login, rolsuper AS is_superuser, rolcreatedb AS can_create_database, rolcreaterole AS can_create_role, rolinherit AS inherits_roles, rolreplication AS can_replicate, rolbypassrls AS bypasses_row_security FROM pg_catalog.pg_roles ORDER BY rolname LIMIT ' + limit,
    memberships: 'SELECT member.rolname AS member_name, role.rolname AS role_name, grantor.rolname AS grantor_name, m.admin_option AS admin_option FROM pg_catalog.pg_auth_members AS m JOIN pg_catalog.pg_roles AS role ON role.oid = m.roleid JOIN pg_catalog.pg_roles AS member ON member.oid = m.member JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = m.grantor ORDER BY member.rolname, role.rolname LIMIT ' + limit
  };
}

function sqlServerSql(limit) {
  var prefix = 'SELECT TOP (' + limit + ') ';
  return {
    principals: prefix + 'principal_id, name, type_desc, authentication_type_desc, default_schema_name, is_fixed_role FROM sys.database_principals ORDER BY principal_id',
    memberships: prefix + 'member.name AS member_name, role.name AS role_name FROM sys.database_role_members AS membership JOIN sys.database_principals AS member ON member.principal_id = membership.member_principal_id JOIN sys.database_principals AS role ON role.principal_id = membership.role_principal_id ORDER BY role.name, member.name',
    grants: prefix + 'principal.name AS principal_name, permission.state_desc AS state_desc, permission.permission_name AS permission_name, permission.class_desc AS class_desc, permission.major_id AS major_id, permission.minor_id AS minor_id FROM sys.database_permissions AS permission JOIN sys.database_principals AS principal ON principal.principal_id = permission.grantee_principal_id ORDER BY principal.name, permission.class_desc, permission.major_id, permission.minor_id'
  };
}

async function discover(client, options) {
  options = options || {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Security discovery options must be an object');
  }
  var dialect = dialectOf(client);
  var maxRows = options.maxRows === undefined ? 1000 : options.maxRows;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1000) {
    throw new RangeError('Security discovery maxRows must be 1..1000');
  }
  var operation = options.operation === undefined ? {} : options.operation;
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new TypeError('Security discovery operation must be an options object');
  }
  var principals = [], memberships = [], grants = [];
  var truncated = { principals: false, memberships: false, grants: false };
  var visibility, scope, limitation;

  if (dialect === 'sqlite') {
    visibility = 'not-applicable';
    scope = 'embedded-runtime';
    limitation = 'SQLite does not provide server-managed SQL user, role or GRANT catalogues. File-system permissions and application-level authorization are external to this report.';
  } else if (dialect === 'postgresql') {
    scope = 'cluster';
    visibility = 'permission-scoped';
    limitation = 'Exposes visible role attributes and memberships, not effective object privileges, role inheritance closure, password hashes or authentication policy.';
    var pg = pgSql(maxRows + 1);
    var pgPrincipals = bounded(await client.all(pg.principals, operation), maxRows);
    var pgMemberships = bounded(await client.all(pg.memberships, operation), maxRows);
    truncated.principals = pgPrincipals.truncated;
    truncated.memberships = pgMemberships.truncated;
    principals = pgPrincipals.rows.map(function (row) {
      return freeze({
        name: nonEmpty(row.name, 'PostgreSQL role name'),
        kind: 'role',
        canLogin: flag(row.can_login),
        attributes: freeze({
          superuser: flag(row.is_superuser),
          createDatabase: flag(row.can_create_database),
          createRole: flag(row.can_create_role),
          inherit: flag(row.inherits_roles),
          replication: flag(row.can_replicate),
          bypassRowSecurity: flag(row.bypasses_row_security)
        })
      });
    });
    memberships = pgMemberships.rows.map(function (row) {
      return freeze({
        member: nonEmpty(row.member_name, 'PostgreSQL member name'),
        role: nonEmpty(row.role_name, 'PostgreSQL role name'),
        grantor: nullable(row.grantor_name),
        adminOption: flag(row.admin_option)
      });
    });
  } else if (dialect === 'mysql') {
    scope = 'current-account';
    visibility = 'current-account-only';
    limitation = 'SHOW GRANTS represents only the connected account and is not a complete server privilege inventory or fully resolved effective-role privilege calculation.';
    var identity = requiredRows(await client.all('SELECT CURRENT_USER() AS account_name', operation));
    if (identity.length !== 1) throw new Error('MySQL security discovery requires exactly one current-account row');
    principals = [freeze({
      name: nonEmpty(identity[0].account_name, 'MySQL current account'),
      kind: 'account', canLogin: true, attributes: freeze({})
    })];
    var nativeGrants = bounded(await client.all('SHOW GRANTS FOR CURRENT_USER()', operation), maxRows);
    truncated.grants = nativeGrants.truncated;
    grants = nativeGrants.rows.map(function (row) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new TypeError('MySQL SHOW GRANTS must return rows');
      }
      var keys = Object.keys(row);
      if (keys.length !== 1) throw new TypeError('MySQL SHOW GRANTS row must have one column');
      var statement = nonEmpty(row[keys[0]], 'MySQL grant statement');
      if (!/^(?:GRANT|REVOKE)\s/i.test(statement)) {
        throw new Error('Unexpected MySQL grant statement shape');
      }
      return freeze({ kind: 'native-statement', principal: principals[0].name, statement: statement });
    });
  } else {
    scope = 'current-database';
    visibility = 'permission-scoped';
    limitation = 'SQL Server metadata is visibility-limited. This database-only view excludes server logins, inherited and fixed-role permissions, and a full effective-permissions calculation.';
    var sql = sqlServerSql(maxRows + 1);
    var sqlPrincipals = bounded(await client.all(sql.principals, operation), maxRows);
    var sqlMemberships = bounded(await client.all(sql.memberships, operation), maxRows);
    var sqlGrants = bounded(await client.all(sql.grants, operation), maxRows);
    truncated.principals = sqlPrincipals.truncated;
    truncated.memberships = sqlMemberships.truncated;
    truncated.grants = sqlGrants.truncated;
    principals = sqlPrincipals.rows.map(function (row) {
      return freeze({
        name: nonEmpty(row.name, 'SQL Server database principal name'),
        kind: row.type_desc === 'DATABASE_ROLE' ? 'role' : 'database-principal',
        canLogin: null,
        attributes: freeze({
          principalId: integer(row.principal_id, 'SQL Server principalId'),
          type: nullable(row.type_desc),
          authenticationType: nullable(row.authentication_type_desc),
          defaultSchema: nullable(row.default_schema_name),
          fixedRole: flag(row.is_fixed_role)
        })
      });
    });
    memberships = sqlMemberships.rows.map(function (row) {
      return freeze({
        member: nonEmpty(row.member_name, 'SQL Server member name'),
        role: nonEmpty(row.role_name, 'SQL Server role name'),
        grantor: null, adminOption: null
      });
    });
    grants = sqlGrants.rows.map(function (row) {
      var state = nonEmpty(row.state_desc, 'SQL Server grant state');
      if (['GRANT', 'GRANT_WITH_GRANT_OPTION', 'DENY', 'REVOKE'].indexOf(state) < 0) {
        throw new Error('Unexpected SQL Server permission state');
      }
      return freeze({
        kind: 'explicit-permission',
        principal: nonEmpty(row.principal_name, 'SQL Server grant principal'),
        state: state,
        permission: nonEmpty(row.permission_name, 'SQL Server permission name'),
        class: nonEmpty(row.class_desc, 'SQL Server permission class'),
        majorId: integer(row.major_id, 'SQL Server majorId'),
        minorId: integer(row.minor_id, 'SQL Server minorId')
      });
    });
  }

  return freeze({
    schemaVersion: SCHEMA_VERSION,
    dialect: dialect,
    scope: scope,
    visibility: visibility,
    complete: false,
    limitation: limitation,
    principals: principals,
    memberships: memberships,
    grants: grants,
    summary: freeze({
      principals: principals.length, memberships: memberships.length, grants: grants.length,
      truncated: freeze(truncated)
    })
  });
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.discover = discover;
