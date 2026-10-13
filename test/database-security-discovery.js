'use strict';

const assert = require('node:assert/strict');
const sql = require('..');

function fake(dialect, handler) {
  const calls = [];
  return {
    dialect, calls,
    async all(statement, operation) {
      calls.push({ statement, operation });
      assert.doesNotMatch(statement, /\b(?:CREATE|ALTER|DROP|GRANT|REVOKE)\s+(?:USER|ROLE|LOGIN)\b/i);
      return handler(statement, operation);
    }
  };
}

async function postgresql() {
  const db = fake('pg', statement => {
    assert.doesNotMatch(statement, /rolpassword|pg_authid|password/i);
    if (statement.includes('pg_catalog.pg_roles ORDER BY') ||
        statement.includes('FROM pg_catalog.pg_roles ORDER BY')) {
      return [
        { name:'admin', can_login:true, is_superuser:true, can_create_database:true,
          can_create_role:true, inherits_roles:true, can_replicate:false,
          bypasses_row_security:true },
        { name:'readonly', can_login:false, is_superuser:false, can_create_database:false,
          can_create_role:false, inherits_roles:true, can_replicate:false,
          bypasses_row_security:false }
      ];
    }
    assert.match(statement,/pg_catalog\.pg_auth_members/);
    return [{ member_name:'admin',role_name:'readonly',grantor_name:'postgres',admin_option:false }];
  });
  const report = await sql.discoverDatabaseSecurity(db, { maxRows: 3, operation:{ timeoutMs:2500 } });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.dialect, 'postgresql');
  assert.equal(report.scope, 'cluster');
  assert.equal(report.visibility,'permission-scoped');
  assert.equal(report.complete,false);
  assert.equal(report.principals.length,2);
  assert.equal(report.principals[0].canLogin,true);
  assert.equal(report.principals[0].attributes.superuser,true);
  assert.equal(report.principals[1].canLogin,false);
  assert.equal(report.memberships[0].role,'readonly');
  assert.equal(report.memberships[0].member,'admin');
  assert.equal(report.grants.length,0);
  assert.ok(Object.isFrozen(report.principals[0].attributes));
  assert.ok(Object.isFrozen(report.summary.truncated));
  assert.equal(db.calls.length,2);
  for(const call of db.calls) {
    assert.match(call.statement,/LIMIT 4/);
    assert.equal(call.operation.timeoutMs,2500);
    assert.doesNotMatch(call.statement,/rolpassword|pg_authid/i);
  }
  assert.ok(report.principals.every(principal =>
    !Object.keys(principal.attributes).some(key => /password|secret|credential|token/i.test(key))));
  assert.ok(!Object.prototype.hasOwnProperty.call(report, 'native'));
}

async function mysql() {
  const db = fake('mysql', statement => {
    if(statement.startsWith('SELECT CURRENT_USER()')) return [{account_name:'app@localhost'}];
    assert.equal(statement,'SHOW GRANTS FOR CURRENT_USER()');
    return [
      { 'Grants for app@localhost': 'GRANT SELECT ON `app`.* TO `app`@`localhost`' },
      { 'Grants for app@localhost': 'REVOKE DELETE ON `app`.* FROM `app`@`localhost`' }
    ];
  });
  const report = await sql.discoverDatabaseSecurity(db);
  assert.equal(report.scope,'current-account');
  assert.equal(report.visibility,'current-account-only');
  assert.equal(report.principals[0].name,'app@localhost');
  assert.equal(report.principals[0].kind,'account');
  assert.equal(report.grants.length,2);
  assert.equal(report.grants[0].kind,'native-statement');
  assert.match(report.grants[0].statement,/GRANT SELECT/);
  assert.equal(report.memberships.length,0);
  assert.equal(report.complete,false);
  const cap = await sql.discoverDatabaseSecurity(db, {maxRows:1});
  assert.equal(cap.grants.length,1);
  assert.equal(cap.summary.truncated.grants,true);
  assert.equal(cap.complete,false);
  await assert.rejects(sql.discoverDatabaseSecurity(fake('mysql', statement => statement.startsWith('SELECT')
    ? [{account_name:'app@localhost'}] : [{q:'IDENTIFIED BY SECRET'}])),/Unexpected MySQL grant/);
  await assert.rejects(sql.discoverDatabaseSecurity(fake('mysql',statement => statement.startsWith('SELECT')
    ? [] : [])),/exactly one/);
}

async function sqlserver() {
  const db = fake('mssql', statement => {
    if (statement.includes('sys.database_role_members')) {
      return [{member_name:'app',role_name:'db_datareader'}];
    }
    if (statement.includes('sys.database_permissions')) {
      return [
        {principal_name:'app',state_desc:'GRANT',permission_name:'SELECT',
          class_desc:'OBJECT_OR_COLUMN',major_id:123,minor_id:0},
        {principal_name:'app',state_desc:'DENY',permission_name:'UPDATE',
          class_desc:'SCHEMA',major_id:2,minor_id:0}
      ];
    }
    assert.match(statement,/sys\.database_principals/);
    return [
      {principal_id:5,name:'app',type_desc:'SQL_USER',authentication_type_desc:'INSTANCE',
        default_schema_name:'dbo',is_fixed_role:false},
      {principal_id:16384,name:'db_datareader',type_desc:'DATABASE_ROLE',
        authentication_type_desc:'NONE',default_schema_name:null,is_fixed_role:true}
    ];
  });
  const result=await sql.discoverDatabaseSecurity(db,{maxRows:2});
  assert.equal(result.scope,'current-database');
  assert.equal(result.visibility,'permission-scoped');
  assert.equal(result.principals[0].attributes.authenticationType,'INSTANCE');
  assert.equal(result.principals[1].kind,'role');
  assert.equal(result.principals[1].attributes.fixedRole,true);
  assert.equal(result.memberships[0].member,'app');
  assert.equal(result.grants[0].state,'GRANT');
  assert.equal(result.grants[1].state,'DENY');
  assert.equal(result.grants[0].majorId,123);
  assert.equal(result.complete,false);
  assert.match(result.limitation,/fixed-role permissions/);
  assert.equal(db.calls.length,3);
  db.calls.forEach(call => {
    assert.match(call.statement,/SELECT TOP \(3\)/);
    assert.doesNotMatch(call.statement,/password|hashed|sid/i);
  });
  await assert.rejects(sql.discoverDatabaseSecurity(fake('sqlserver', statement =>
    statement.includes('sys.database_permissions') ?
      [{principal_name:'app',state_desc:'ELEVATE',permission_name:'SELECT',class_desc:'DATABASE',major_id:0,minor_id:0}] :
      statement.includes('sys.database_role_members') ? [] :
      [{principal_id:1,name:'app',type_desc:'SQL_USER'}]
  )),/Unexpected SQL Server permission state/);
}

async function sqlite() {
  const db=fake('sqlite',()=>{throw new Error('SQLite security discovery must not run a SQL query');});
  const result=await sql.discoverDatabaseSecurity(db);
  assert.equal(result.scope,'embedded-runtime');
  assert.equal(result.visibility,'not-applicable');
  assert.equal(result.complete,false);
  assert.equal(result.summary.principals,0);
  assert.equal(db.calls.length,0);
  assert.match(result.limitation,/file-system permissions/i);
  const client=sql.createClient({dialect:'sqlite',filename:':memory:'});
  try {
    const observed=await client.discoverSecurity();
    assert.equal(observed.visibility,'not-applicable');
    assert.deepEqual(observed.principals,[]);
  } finally { await client.close(); }
}

async function boundedFailure() {
  for(const maxRows of [0,1001,-1,1.5,NaN,'50']) {
    await assert.rejects(sql.discoverDatabaseSecurity(fake('sqlite',()=>[]),{maxRows}),/maxRows/);
  }
  await assert.rejects(sql.discoverDatabaseSecurity(fake('sqlite',()=>[]),{operation:null}),/operation/);
  await assert.rejects(sql.discoverDatabaseSecurity({dialect:'oracle',all:async()=>[]}),/Unsupported/);
  await assert.rejects(sql.discoverDatabaseSecurity({dialect:'sqlite'}),/client/);
  let stage=0;
  const failure=fake('postgresql',()=> {
    stage++;
    if(stage===1) return [];
    throw new Error('permission denied for pg_auth_members');
  });
  await assert.rejects(sql.discoverDatabaseSecurity(failure),/permission denied/);
  const truncated=fake('postgresql', statement =>
    statement.includes('pg_auth_members') ? [] :
    Array.from({length:3},(_,index)=>({name:'role'+index,can_login:true}))
  );
  const partial=await sql.discoverDatabaseSecurity(truncated,{maxRows:2});
  assert.equal(partial.principals.length,2);
  assert.equal(partial.summary.truncated.principals,true);
  assert.equal(partial.complete,false);
  assert.throws(()=>{partial.principals[0].name='changed';},/read only|Cannot assign/i);
  assert.equal(sql.DATABASE_SECURITY_DISCOVERY_SCHEMA_VERSION,1);
}

(async()=>{
  await postgresql();
  await mysql();
  await sqlserver();
  await sqlite();
  await boundedFailure();
  console.log('NuBloxSQL read-only database security inventory contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
