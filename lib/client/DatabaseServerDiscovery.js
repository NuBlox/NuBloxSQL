'use strict';

var bootstrapPlanner = require('./DatabaseBootstrapPlanner');

var SCHEMA_VERSION = 1;
var PREREQUISITE_SCHEMA_VERSION = 1;
var PREREQUISITE_STATUSES = Object.freeze(['ready','attention','blocked']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}

function normalizeDialect(value){
  value=String(value||'').toLowerCase();
  if(value==='postgres'||value==='pg')value='postgresql';
  if(value==='mssql'||value==='sql-server')value='sqlserver';
  return value;
}

function assertClient(client){
  if(!client||typeof client!=='object'||typeof client.all!=='function'){
    throw new TypeError('NuBloxSQL server discovery requires a NuBloxSQL-like client');
  }
  var dialect=normalizeDialect(client.dialect);
  if(['postgresql','mysql','sqlite','sqlserver'].indexOf(dialect)===-1){
    throw new RangeError('NuBloxSQL server discovery does not support dialect "'+dialect+'"');
  }
  return dialect;
}

function first(rows){
  return Array.isArray(rows)&&rows.length?rows[0]:{};
}

function stringOrNull(value){
  return value===undefined||value===null?null:String(value);
}

function boolOrNull(value){
  if(value===undefined||value===null)return null;
  if(value===true||value===1||value==='1')return true;
  if(value===false||value===0||value==='0')return false;
  return Boolean(value);
}

function identitySql(dialect){
  if(dialect==='postgresql'){
    return "SELECT current_setting('server_version') AS version, current_database() AS current_database, current_user AS current_user";
  }
  if(dialect==='mysql'){
    return 'SELECT VERSION() AS version, DATABASE() AS current_database, CURRENT_USER() AS current_user';
  }
  if(dialect==='sqlite'){
    return 'SELECT sqlite_version() AS version';
  }
  return "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition, CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS server_name, DB_NAME() AS current_database, SUSER_SNAME() AS current_user";
}

function databasesSql(dialect){
  if(dialect==='postgresql'){
    return 'SELECT datname AS name, datallowconn AS accessible, datistemplate AS is_template FROM pg_database ORDER BY datname';
  }
  if(dialect==='mysql'){
    return 'SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS character_set, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME';
  }
  if(dialect==='sqlite'){
    return 'PRAGMA database_list';
  }
  return 'SELECT name, state_desc, user_access_desc, is_read_only FROM sys.databases ORDER BY name';
}

function normalizeDatabase(dialect,row){
  if(dialect==='postgresql'){
    return freeze({
      name:stringOrNull(row.name),
      accessible:boolOrNull(row.accessible),
      kind:boolOrNull(row.is_template)===true?'template':'database',
      native:freeze(Object.assign({},row))
    });
  }
  if(dialect==='mysql'){
    return freeze({
      name:stringOrNull(row.name),
      accessible:null,
      kind:'database',
      native:freeze(Object.assign({},row))
    });
  }
  if(dialect==='sqlite'){
    return freeze({
      name:stringOrNull(row.name),
      accessible:true,
      kind:'attached-database',
      native:freeze(Object.assign({},row))
    });
  }
  return freeze({
    name:stringOrNull(row.name),
    accessible:String(row.state_desc||'').toUpperCase()==='ONLINE',
    kind:'database',
    native:freeze(Object.assign({},row))
  });
}

async function discover(client,options){
  options=options||{};
  var dialect=assertClient(client);
  var operation=options.operation||{};
  var identityRows=await client.all(identitySql(dialect),operation);
  var databaseRows=await client.all(databasesSql(dialect),operation);
  var row=first(identityRows);
  var databases=(databaseRows||[]).map(function(item){return normalizeDatabase(dialect,item);});
  var sqliteMain=dialect==='sqlite'?databases.find(function(item){return item.name==='main';}):null;

  return freeze({
    schemaVersion:SCHEMA_VERSION,
    dialect:dialect,
    identity:freeze({
      product:dialect==='postgresql'?'PostgreSQL':dialect==='mysql'?'MySQL':dialect==='sqlite'?'SQLite':'SQL Server',
      version:stringOrNull(row.version),
      edition:stringOrNull(row.edition),
      serverName:stringOrNull(row.server_name),
      currentDatabase:dialect==='sqlite'?(sqliteMain?sqliteMain.name:'main'):stringOrNull(row.current_database),
      currentUser:stringOrNull(row.current_user)
    }),
    databases:freeze(databases),
    summary:freeze({
      databases:databases.length,
      accessible:databases.filter(function(item){return item.accessible===true;}).length,
      inaccessible:databases.filter(function(item){return item.accessible===false;}).length,
      unknownAccessibility:databases.filter(function(item){return item.accessible===null;}).length
    }),
    native:freeze({
      identity:freeze(Object.assign({},row)),
      databases:freeze((databaseRows||[]).map(function(item){return freeze(Object.assign({},item));}))
    })
  });
}

function stepRequiresAdmin(plan){
  return plan.steps.some(function(step){
    return step.execution==='automatic'&&step.requirements&&step.requirements.adminPrivileges===true;
  });
}

async function assessBootstrapPrerequisites(client,planInput,options){
  options=options||{};
  var plan=bootstrapPlanner.validate(planInput);
  var dialect=assertClient(client);
  if(dialect!==plan.targetDialect){
    return freeze({
      schemaVersion:PREREQUISITE_SCHEMA_VERSION,
      planSchemaVersion:plan.schemaVersion,
      planHash:plan.planHash,
      targetDialect:plan.targetDialect,
      targetDatabase:plan.targetDatabase,
      status:'blocked',
      discovery:null,
      checks:freeze([
        freeze({id:'dialect-match',status:'blocked',message:'Connected client dialect "'+dialect+'" does not match bootstrap plan dialect "'+plan.targetDialect+'".'})
      ])
    });
  }

  var discovery=options.discovery||await discover(client,{operation:options.operation});
  if(discovery.dialect!==plan.targetDialect){
    throw new Error('NuBloxSQL bootstrap prerequisite discovery dialect does not match plan dialect');
  }

  var names=Object.create(null);
  discovery.databases.forEach(function(item){if(item.name!==null)names[item.name]=true;});
  var targetExists=plan.targetDatabase===null?null:!!names[plan.targetDatabase];
  var checks=[
    freeze({id:'dialect-match',status:'ready',message:'Connected client dialect matches the bootstrap plan.'}),
    freeze({id:'server-discovery',status:'ready',message:'Server identity and database/catalog enumeration succeeded.'})
  ];

  if(plan.targetDatabase!==null){
    checks.push(freeze({
      id:'target-database',
      status:targetExists?'attention':'ready',
      message:targetExists?'Target database/catalog already exists; creation steps can be skipped by precondition inspection.':'Target database/catalog is not present in the discovered server inventory.'
    }));
  }

  var hasManual=plan.steps.some(function(step){return step.execution==='manual';});
  if(hasManual){
    checks.push(freeze({id:'manual-steps',status:'attention',message:'Bootstrap plan contains manual steps that require an explicit manualHandler during execution.'}));
  }

  if(stepRequiresAdmin(plan)){
    checks.push(freeze({
      id:'administrative-privileges',
      status:'attention',
      message:'One or more automatic bootstrap steps require administrative privileges. NuBloxSQL does not claim those privileges are available until the engine confirms execution.'
    }));
  }

  if(plan.requires&&plan.requires.databaseClientAfterCreate){
    checks.push(freeze({
      id:'database-client-after-create',
      status:'attention',
      message:'Bootstrap requires an explicit target-database client or openDatabaseClient callback after database creation.'
    }));
  }

  var status=checks.some(function(item){return item.status==='blocked';})?'blocked':
    checks.some(function(item){return item.status==='attention';})?'attention':'ready';

  return freeze({
    schemaVersion:PREREQUISITE_SCHEMA_VERSION,
    planSchemaVersion:plan.schemaVersion,
    planHash:plan.planHash,
    targetDialect:plan.targetDialect,
    targetDatabase:plan.targetDatabase,
    status:status,
    discovery:discovery,
    checks:freeze(checks)
  });
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.PREREQUISITE_SCHEMA_VERSION=PREREQUISITE_SCHEMA_VERSION;
exports.PREREQUISITE_STATUSES=PREREQUISITE_STATUSES;
exports.discover=discover;
exports.assessBootstrapPrerequisites=assessBootstrapPrerequisites;
