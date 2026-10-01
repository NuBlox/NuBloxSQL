'use strict';

var sql = require('./Sql').sql;

function freezeObject(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  return Object.freeze(value);
}
function freezeArray(values) {
  return Object.freeze((values || []).map(function (value) { return value && typeof value === 'object' ? freezeObject(value) : value; }));
}
function mysql(metadata) { return metadata && metadata.dialect === 'mysql'; }
function yn(value) { return String(value || '').toUpperCase() === 'Y' || String(value || '').toUpperCase() === 'YES'; }

async function accounts() {
  if (!mysql(this)) return freezeArray([]);
  var rows = await this.client.all(sql`
    SELECT User AS user_name, Host AS host_name, plugin AS auth_plugin,
           account_locked AS account_locked, password_expired AS password_expired,
           password_last_changed AS password_last_changed, password_lifetime AS password_lifetime
    FROM mysql.user
    ORDER BY User, Host
  `);
  return freezeArray(rows.map(function (row) {
    return {
      user: row.user_name, host: row.host_name, authenticationPlugin: row.auth_plugin || null,
      accountLocked: yn(row.account_locked), passwordExpired: yn(row.password_expired),
      passwordLastChanged: row.password_last_changed || null,
      passwordLifetime: row.password_lifetime === null || row.password_lifetime === undefined ? null : Number(row.password_lifetime),
      native: freezeObject(row)
    };
  }));
}

async function roleEdges() {
  if (!mysql(this)) return freezeArray([]);
  var rows = await this.client.all(sql`
    SELECT FROM_USER AS role_user, FROM_HOST AS role_host,
           TO_USER AS grantee_user, TO_HOST AS grantee_host,
           WITH_ADMIN_OPTION AS with_admin_option
    FROM mysql.role_edges
    ORDER BY FROM_USER, FROM_HOST, TO_USER, TO_HOST
  `);
  return freezeArray(rows.map(function (row) {
    return {
      roleUser: row.role_user, roleHost: row.role_host, granteeUser: row.grantee_user, granteeHost: row.grantee_host,
      adminOption: yn(row.with_admin_option), native: freezeObject(row)
    };
  }));
}

function install(metadataApi) {
  if (!metadataApi || !metadataApi.Metadata) return;
  var p = metadataApi.Metadata.prototype;
  if (!p.accounts) p.accounts = accounts;
  if (!p.roleEdges) p.roleEdges = roleEdges;
}

exports.install = install;
exports.accounts = accounts;
exports.roleEdges = roleEdges;
