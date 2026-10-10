'use strict';

var output=require('./Output');

var HELP=[
  'NuBlox Shell commands',
  '',
  '\\help                     Show this help',
  '\\connection               Show current connection summary',
  '\\status                   Show connected/disconnected state',
  '\\disconnect               Close active database session',
  '\\reconnect                Reopen the last connection (same process)',
  '\\history on|off|clear     Opt-in in-memory SQL history (sensitive)',
  '\\history                  Display session SQL history (if enabled)',
  '\\reset                    Discard an unfinished multi-line SQL statement',
  '\\server                   Discover current database server/runtime',
  '\\databases                List visible databases/catalogs',
  '\\schemas [database]       List schemas',
  '\\tables [schema] [db]     List tables/views',
  '\\describe <table>         Describe table; schema.table and db.schema.table supported',
  '\\config [setting]         Discover configuration or one setting',
  '\\format <format>          table | json | jsonl | csv',
  '\\quit                     Exit NuBlox Shell',
  '',
  'Any other input is executed as native SQL through the public NuBloxSQL Client API.'
].join('\n');

function tokenize(text){
  var tokens=[], current='', quote=null, escaped=false;
  for(var i=0;i<text.length;i+=1){
    var ch=text.charAt(i);
    if(escaped){current+=ch;escaped=false;continue;}
    if(ch==='\\'&&quote){escaped=true;continue;}
    if(quote){
      if(ch===quote){quote=null;continue;}
      current+=ch;continue;
    }
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(/\s/.test(ch)){
      if(current){tokens.push(current);current='';}
      continue;
    }
    current+=ch;
  }
  if(quote)throw new Error('NuBlox Shell command contains an unterminated quote');
  if(current)tokens.push(current);
  return tokens;
}
function cleanConfig(config){
  var result={};
  Object.keys(config||{}).forEach(function(key){
    if(/password|secret|token|credential/i.test(key))result[key]='********';
    else result[key]=config[key];
  });
  return result;
}
function requireClient(shell){
  if(!shell.client)throw new Error('NuBlox Shell is not connected');
  return shell.client;
}
async function command(shell,line){
  var tokens=tokenize(line.replace(/^\\/,'').trim());
  var name=(tokens.shift()||'help').toLowerCase();
  var client;

  if(name==='help'||name==='?')return {kind:'text',value:HELP};
  if(name==='quit'||name==='q'||name==='exit')return {kind:'quit'};
  if(name==='format'){
    var format=(tokens.shift()||'').toLowerCase();
    if(output.FORMATS.indexOf(format)===-1)throw new RangeError('Unknown format "'+format+'"; use '+output.FORMATS.join(', '));
    shell.format=format;
    return {kind:'text',value:'Output format: '+format};
  }

  if(name==='status')return {kind:'data',value:shell.status()};
  if(name==='disconnect'){
    await shell.close();
    return {kind:'text',value:'Disconnected'};
  }
  if(name==='reconnect'){
    await shell.reconnect();
    return {kind:'text',value:'Connected to '+shell.client.dialect};
  }
  if(name==='history'){
    var action=(tokens.shift()||'show').toLowerCase();
    if(tokens.length)throw new TypeError('Usage: \\history [on|off|clear]');
    if(action==='on'){shell.setHistory(true);return {kind:'text',value:'In-memory SQL history enabled (may include sensitive literals; never saved)'};}
    if(action==='off'){shell.setHistory(false);return {kind:'text',value:'In-memory SQL history disabled and cleared'};}
    if(action==='clear'){shell.history.length=0;return {kind:'text',value:'In-memory SQL history cleared'};}
    if(action!=='show')throw new TypeError('Usage: \\history [on|off|clear]');
    if(!shell.historyEnabled)return {kind:'text',value:'History is disabled. Use \\history on to enable in-memory SQL capture.'};
    return {kind:'data',value:shell.history.slice()};
  }
  if(name==='reset')return {kind:'text',value:'SQL statement buffer is empty'};

  client=requireClient(shell);

  if(name==='connection'||name==='conn'){
    return {kind:'data',value:{
      dialect:client.dialect,
      config:cleanConfig(client.config||{})
    }};
  }
  if(name==='server'){
    return {kind:'data',value:await client.discoverServer()};
  }
  if(name==='databases'||name==='dbs'){
    return {kind:'data',value:await client.metadata.databases()};
  }
  if(name==='schemas'){
    var database=tokens.shift();
    return {kind:'data',value:await client.metadata.schemas(database?{database:database}:{})};
  }
  if(name==='tables'){
    var schema=tokens.shift();
    var db=tokens.shift();
    var tableScope={};
    if(schema)tableScope.schema=schema;
    if(db)tableScope.database=db;
    return {kind:'data',value:await client.metadata.tables(tableScope)};
  }
  if(name==='describe'||name==='desc'){
    var reference=tokens.shift();
    if(!reference)throw new TypeError('Usage: \\describe <table>');
    var parts=reference.split('.');
    var table=parts.pop();
    var scope={};
    if(parts.length===1)scope.schema=parts[0];
    else if(parts.length===2){scope.database=parts[0];scope.schema=parts[1];}
    else if(parts.length>2)throw new TypeError('NuBlox Shell table reference must be table, schema.table or database.schema.table');
    var tableMeta=await client.metadata.table(table,scope);
    if(!tableMeta)return {kind:'data',value:{table:null,columns:[],indexes:[],foreignKeys:[],constraints:[]}};
    var values=await Promise.all([
      client.metadata.columns(table,scope),
      client.metadata.indexes(table,scope),
      client.metadata.foreignKeys(table,scope),
      client.metadata.constraints(table,scope)
    ]);
    return {kind:'describe',value:{
      table:tableMeta,
      columns:values[0],
      indexes:values[1],
      foreignKeys:values[2],
      constraints:values[3]
    }};
  }
  if(name==='config'||name==='configuration'){
    var report=await client.discoverConfiguration();
    var setting=tokens.join(' ');
    if(!setting)return {kind:'data',value:report.settings};
    var found=shell.sqlApi.findDatabaseConfiguration(report,setting);
    return {kind:'data',value:found||[]};
  }

  throw new RangeError('Unknown NuBlox Shell command "\\'+name+'". Use \\help.');
}

exports.HELP=HELP;
exports.tokenize=tokenize;
exports.cleanConfig=cleanConfig;
exports.execute=command;
