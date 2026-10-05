'use strict';

var crypto = require('crypto');

var SCHEMA_VERSION = 1;
var EXECUTION = Object.freeze(['automatic','manual','satisfied']);
var SCOPES = Object.freeze(['server','database']);

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}

function normalizeDialect(value){
  if(typeof value!=='string'||!value.trim())throw new TypeError('NuBloxSQL database bootstrap requires a target dialect');
  value=value.trim().toLowerCase();
  if(value==='postgres'||value==='pg')value='postgresql';
  if(value==='mssql'||value==='sql-server')value='sqlserver';
  if(['postgresql','mysql','sqlite','sqlserver'].indexOf(value)===-1){
    throw new RangeError('NuBloxSQL database bootstrap does not support dialect "'+value+'"');
  }
  return value;
}

function identifier(value,label){
  if(typeof value!=='string'||!value.length)throw new TypeError('NuBloxSQL database bootstrap '+label+' must be a non-empty string');
  if(value.indexOf('\0')!==-1)throw new TypeError('NuBloxSQL database bootstrap '+label+' cannot contain NUL bytes');
  return value;
}

function quoteIdentifier(dialect,value){
  value=identifier(value,'identifier');
  if(dialect==='mysql'){
    var tick=String.fromCharCode(96);
    return tick+value.split(tick).join(tick+tick)+tick;
  }
  if(dialect==='sqlserver')return '['+value.replace(/\]/g,']]')+']';
  return '"'+value.replace(/"/g,'""')+'"';
}

function quoteLiteral(dialect,value){
  var literal="'"+String(value).replace(/'/g,"''")+"'";
  return dialect==='sqlserver'?'N'+literal:literal;
}

function optionString(value,label){
  if(value===undefined||value===null)return null;
  return identifier(value,label);
}

function optionToken(value,label){
  value=optionString(value,label);
  if(value===null)return null;
  if(!/^[A-Za-z0-9_.$-]+$/.test(value)){
    throw new TypeError('NuBloxSQL database bootstrap '+label+' contains unsupported characters');
  }
  return value;
}

function databaseSpec(value){
  if(value===undefined||value===null)return null;
  if(typeof value==='string')return freeze({name:identifier(value,'database name'),create:true,ifNotExists:true,options:freeze({})});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('NuBloxSQL database bootstrap database must be a string or options object');
  var options=value.options===undefined||value.options===null?{}:value.options;
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('NuBloxSQL database bootstrap database options must be an object');
  return freeze({
    name:identifier(value.name,'database name'),
    create:value.create!==false,
    ifNotExists:value.ifNotExists!==false,
    options:freeze({
      owner:optionString(options.owner,'database owner'),
      template:optionString(options.template,'database template'),
      encoding:optionString(options.encoding,'database encoding'),
      collation:optionString(options.collation,'database collation'),
      ctype:optionString(options.ctype,'database character classification locale'),
      tablespace:optionString(options.tablespace,'database tablespace'),
      characterSet:optionToken(options.characterSet,'database character set')
    })
  });
}

function configuredDatabaseOptions(database){
  if(!database||!database.options)return [];
  return Object.keys(database.options).filter(function(key){return database.options[key]!==null;});
}

function assertDatabaseOptionsSupported(dialect,database){
  var configured=configuredDatabaseOptions(database);
  if(!configured.length)return;
  var allowed={
    postgresql:['owner','template','encoding','collation','ctype','tablespace'],
    mysql:['characterSet','collation'],
    sqlserver:['collation'],
    sqlite:[]
  }[dialect];
  var unsupported=configured.filter(function(name){return allowed.indexOf(name)===-1;});
  if(unsupported.length){
    throw new RangeError('NuBloxSQL database bootstrap '+dialect+' does not support database option(s): '+unsupported.join(', '));
  }
}

function renderPostgresqlDatabaseOptions(database){
  var options=database.options||{};
  var parts=[];
  if(options.owner!==null)parts.push('OWNER = '+quoteIdentifier('postgresql',options.owner));
  if(options.template!==null)parts.push('TEMPLATE = '+quoteIdentifier('postgresql',options.template));
  if(options.encoding!==null)parts.push('ENCODING = '+quoteLiteral('postgresql',options.encoding));
  if(options.collation!==null)parts.push('LC_COLLATE = '+quoteLiteral('postgresql',options.collation));
  if(options.ctype!==null)parts.push('LC_CTYPE = '+quoteLiteral('postgresql',options.ctype));
  if(options.tablespace!==null)parts.push('TABLESPACE = '+quoteIdentifier('postgresql',options.tablespace));
  return parts.length?' WITH '+parts.join(' '):'';
}

function renderMysqlDatabaseOptions(database){
  var options=database.options||{};
  var parts=[];
  if(options.characterSet!==null)parts.push('CHARACTER SET '+options.characterSet);
  if(options.collation!==null)parts.push('COLLATE '+optionToken(options.collation,'database collation'));
  return parts.length?' '+parts.join(' '):'';
}

function renderSqlServerDatabaseOptions(database){
  var options=database.options||{};
  if(options.collation===null)return '';
  return ' COLLATE '+optionToken(options.collation,'database collation');
}

function schemaSpecs(values){
  if(values===undefined||values===null)return freeze([]);
  if(!Array.isArray(values))throw new TypeError('NuBloxSQL database bootstrap schemas must be an array');
  var seen=Object.create(null);
  return freeze(values.map(function(value,index){
    var item=typeof value==='string'?{name:value}:value;
    if(!item||typeof item!=='object'||Array.isArray(item))throw new TypeError('NuBloxSQL database bootstrap schema '+index+' must be a string or options object');
    var name=identifier(item.name,'schema name');
    var key=name;
    if(seen[key])throw new Error('NuBloxSQL database bootstrap contains duplicate schema "'+name+'"');
    seen[key]=true;
    return freeze({name:name,ifNotExists:item.ifNotExists!==false});
  }));
}

function existenceSql(dialect,kind,name){
  var literal=quoteLiteral(dialect,name);
  if(kind==='database'){
    if(dialect==='postgresql')return 'SELECT 1 AS "exists" FROM pg_database WHERE datname = '+literal;
    if(dialect==='mysql')return 'SELECT 1 AS exists_flag FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '+literal;
    if(dialect==='sqlserver')return 'SELECT 1 AS [exists] FROM sys.databases WHERE name = '+literal;
    return null;
  }
  if(kind==='schema'){
    if(dialect==='postgresql')return 'SELECT 1 AS "exists" FROM information_schema.schemata WHERE schema_name = '+literal;
    if(dialect==='mysql')return 'SELECT 1 AS exists_flag FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '+literal;
    if(dialect==='sqlserver')return 'SELECT 1 AS [exists] FROM sys.schemas WHERE name = '+literal;
    return null;
  }
  return null;
}

function automaticStep(id,phase,kind,scope,sql,precondition,verification,requirements,notes){
  return freeze({
    id:id,phase:phase,kind:kind,action:'create',scope:scope,execution:'automatic',
    sql:sql,precondition:precondition,verification:verification,
    requirements:freeze(requirements||{}),notes:notes||null
  });
}

function manualStep(id,phase,kind,scope,notes){
  return freeze({
    id:id,phase:phase,kind:kind,action:'create',scope:scope,execution:'manual',
    sql:null,precondition:null,verification:null,requirements:freeze({}),notes:notes
  });
}

function satisfiedStep(id,phase,kind,scope,notes){
  return freeze({
    id:id,phase:phase,kind:kind,action:'create',scope:scope,execution:'satisfied',
    sql:null,precondition:null,verification:null,requirements:freeze({}),notes:notes
  });
}

function databaseStep(dialect,database){
  if(!database||database.create===false)return null;
  assertDatabaseOptionsSupported(dialect,database);
  var name=database.name;
  var exists=existenceSql(dialect,'database',name);
  var pre=database.ifNotExists&&exists?freeze({mode:'absent',sql:exists}):null;
  var verify=exists?freeze({mode:'present',sql:exists}):null;

  if(dialect==='sqlite'){
    return satisfiedStep(
      'database:create:'+name,1,'database','database',
      'SQLite database creation is a connection/file-open lifecycle operation; the connected database is already established by the SQLite runtime.'
    );
  }
  if(dialect==='postgresql'){
    return automaticStep(
      'database:create:'+name,1,'database','server',
      'CREATE DATABASE '+quoteIdentifier(dialect,name)+renderPostgresqlDatabaseOptions(database),
      pre,verify,
      {autocommit:true,transactionForbidden:true,onlyStatementBatch:false,reconnectAfter:true,adminPrivileges:true},
      'PostgreSQL CREATE DATABASE must run outside a transaction. A target database connection is required for later database-scoped bootstrap steps.'
    );
  }
  if(dialect==='mysql'){
    return automaticStep(
      'database:create:'+name,1,'database','server',
      'CREATE DATABASE '+(database.ifNotExists?'IF NOT EXISTS ':'')+quoteIdentifier(dialect,name)+renderMysqlDatabaseOptions(database),
      pre,verify,
      {autocommit:true,transactionForbidden:false,onlyStatementBatch:false,reconnectAfter:false,adminPrivileges:true},
      'MySQL CREATE SCHEMA is a synonym for CREATE DATABASE; this step creates the database namespace on the server.'
    );
  }
  return automaticStep(
    'database:create:'+name,1,'database','server',
    'CREATE DATABASE '+quoteIdentifier(dialect,name)+renderSqlServerDatabaseOptions(database),
    pre,verify,
    {autocommit:true,transactionForbidden:true,onlyStatementBatch:true,reconnectAfter:true,adminPrivileges:true},
    'SQL Server CREATE DATABASE must run in autocommit mode and as the only statement in its batch. A target database connection is required for later database-scoped bootstrap steps.'
  );
}

function schemaStep(dialect,database,schema){
  var name=schema.name;
  var id='schema:create:'+name;

  if(dialect==='sqlite'){
    return manualStep(
      id,2,'schema','database',
      'SQLite has no independent schema namespace. ATTACH creates a connection-scoped database namespace and requires an explicit filename, so bootstrap does not invent an equivalent.'
    );
  }

  if(dialect==='mysql'){
    if(database&&database.create!==false&&database.name===name){
      return satisfiedStep(
        id,2,'schema','server',
        'MySQL schema and database are synonyms; the database bootstrap step establishes this namespace.'
      );
    }
    var myExists=existenceSql(dialect,'schema',name);
    return automaticStep(
      id,2,'schema','server',
      'CREATE SCHEMA '+(schema.ifNotExists?'IF NOT EXISTS ':'')+quoteIdentifier(dialect,name),
      schema.ifNotExists?freeze({mode:'absent',sql:myExists}):null,
      freeze({mode:'present',sql:myExists}),
      {autocommit:true,transactionForbidden:false,onlyStatementBatch:false,reconnectAfter:false,adminPrivileges:true,databaseEquivalent:true},
      'In MySQL, CREATE SCHEMA is a synonym for CREATE DATABASE. This creates a server-level database namespace rather than a nested schema.'
    );
  }

  var exists=existenceSql(dialect,'schema',name);
  if(dialect==='postgresql'){
    return automaticStep(
      id,2,'schema','database',
      'CREATE SCHEMA '+(schema.ifNotExists?'IF NOT EXISTS ':'')+quoteIdentifier(dialect,name),
      schema.ifNotExists?freeze({mode:'absent',sql:exists}):null,
      freeze({mode:'present',sql:exists}),
      {autocommit:false,transactionForbidden:false,onlyStatementBatch:false,reconnectAfter:false,adminPrivileges:false},
      null
    );
  }

  return automaticStep(
    id,2,'schema','database',
    'CREATE SCHEMA '+quoteIdentifier(dialect,name),
    schema.ifNotExists?freeze({mode:'absent',sql:exists}):null,
    freeze({mode:'present',sql:exists}),
    {autocommit:true,transactionForbidden:false,onlyStatementBatch:false,reconnectAfter:false,adminPrivileges:false},
    'SQL Server schema creation is database-scoped.'
  );
}

function hashPlan(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function plan(specification,options){
  specification=specification||{};
  options=options||{};
  if(!specification||typeof specification!=='object'||Array.isArray(specification))throw new TypeError('NuBloxSQL database bootstrap specification must be an object');
  var dialect=normalizeDialect(options.targetDialect||specification.dialect);
  var database=databaseSpec(specification.database);
  var schemas=schemaSpecs(specification.schemas);
  if(!database&&!schemas.length)throw new TypeError('NuBloxSQL database bootstrap requires a database and/or at least one schema');

  var steps=[];
  var dbStep=databaseStep(dialect,database);
  if(dbStep)steps.push(dbStep);
  schemas.forEach(function(schema){steps.push(schemaStep(dialect,database,schema));});

  var automatic=steps.filter(function(step){return step.execution==='automatic';}).length;
  var manual=steps.filter(function(step){return step.execution==='manual';}).length;
  var satisfied=steps.filter(function(step){return step.execution==='satisfied';}).length;
  var server=steps.filter(function(step){return step.scope==='server';}).length;
  var databaseScoped=steps.filter(function(step){return step.scope==='database';}).length;
  var createsDatabase=!!(dbStep&&dbStep.execution==='automatic');
  var needsDatabaseClient=createsDatabase&&steps.some(function(step){return step.scope==='database'&&step.execution==='automatic';});

  var core={
    schemaVersion:SCHEMA_VERSION,
    targetDialect:dialect,
    targetDatabase:database?database.name:null,
    executable:manual===0,
    requires:freeze({
      serverClient:server>0,
      databaseClientAfterCreate:needsDatabaseClient,
      autocommitBoundary:steps.some(function(step){return step.requirements&&step.requirements.transactionForbidden===true;})
    }),
    summary:freeze({
      steps:steps.length,automatic:automatic,manual:manual,satisfied:satisfied,
      server:server,database:databaseScoped
    }),
    steps:freeze(steps)
  };
  return freeze(Object.assign({planHash:hashPlan(core)},core));
}

function validate(planValue){
  if(!planValue||planValue.schemaVersion!==SCHEMA_VERSION||!Array.isArray(planValue.steps)){
    throw new TypeError('NuBloxSQL database bootstrap plan v'+SCHEMA_VERSION+' required');
  }
  normalizeDialect(planValue.targetDialect);
  return planValue;
}
function automaticSteps(planValue){
  validate(planValue);
  return freeze(planValue.steps.filter(function(step){return step.execution==='automatic';}));
}
function manualSteps(planValue){
  validate(planValue);
  return freeze(planValue.steps.filter(function(step){return step.execution==='manual';}));
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.EXECUTION=EXECUTION;
exports.SCOPES=SCOPES;
exports.plan=plan;
exports.validate=validate;
exports.automaticSteps=automaticSteps;
exports.manualSteps=manualSteps;
