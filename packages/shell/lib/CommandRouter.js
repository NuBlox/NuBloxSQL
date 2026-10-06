'use strict';

var output=require('./Output');

var HELP=[
  'NuBlox Shell commands',
  '',
  '\\help                     Show this help',
  '\\connection               Show current connection summary',
  '\\server                   Discover current database server/runtime',
  '\\databases                List visible databases/catalogs',
  '\\schemas [database]       List schemas',
  '\\tables [schema]          List tables/views',
  '\\describe <table>         Describe a table and its related metadata',
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
    return {kind:'data',value:await client.metadata.tables(schema?{schema:schema}:{})};
  }
  if(name==='describe'||name==='desc'){
    var table=tokens.shift();
    if(!table)throw new TypeError('Usage: \\describe <table>');
    var scope={};
    var tableMeta=await client.metadata.table(table,scope);
    if(!tableMeta)return {kind:'data',value:{table:null,columns:[],indexes:[],foreignKeys:[],constraints:[]}};
    var values=await Promise.all([
      client.metadata.columns(table,scope),
      client.metadata.indexes(table,scope),
      client.metadata.foreignKeys(table,scope),
      client.metadata.constraints(table,scope)
    ]);
    return {kind:'data',value:{
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
