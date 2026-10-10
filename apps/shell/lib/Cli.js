'use strict';

var Shell=require('./Shell').Shell;
var repl=require('./Repl');
var output=require('./Output');
var pkg=require('../package.json');
var fs=require('node:fs');

function take(argv,index,name){
  if(index+1>=argv.length)throw new TypeError('NuBlox Shell '+name+' requires a value');
  return argv[index+1];
}
function scalar(value){
  if(value==='true')return true;
  if(value==='false')return false;
  if(value==='null')return null;
  if(/^-?\d+(?:\.\d+)?$/.test(value))return Number(value);
  return value;
}
function parseOption(value){
  var index=value.indexOf('=');
  if(index<=0)throw new TypeError('NuBlox Shell --option requires key=value');
  return {key:value.slice(0,index),value:scalar(value.slice(index+1))};
}
function parseArgs(argv){
  argv=Array.isArray(argv)?argv:[];
  var options={format:'table',extra:{}};
  for(var i=0;i<argv.length;i+=1){
    var arg=argv[i];
    if(arg==='--help'||arg==='-h'){options.help=true;continue;}
    if(arg==='--version'||arg==='-v'){options.version=true;continue;}
    if(arg==='--demo'){options.demo=true;continue;}
    if(arg==='--doctor'){options.doctor=true;continue;}
    if(arg==='--file'){options.file=take(argv,i,'--file');i+=1;continue;}
    if(arg==='--output'){options.output=take(argv,i,'--output');i+=1;continue;}
    if(arg==='--no-pool'){options.pool=false;continue;}
    if(arg==='--pool'){options.pool=true;continue;}
    if(arg==='--url'){options.url=take(argv,i,'--url');i+=1;continue;}
    if(arg==='--dialect'){options.dialect=take(argv,i,'--dialect');i+=1;continue;}
    if(arg==='--host'){options.host=take(argv,i,'--host');i+=1;continue;}
    if(arg==='--port'){options.port=Number(take(argv,i,'--port'));if(!Number.isInteger(options.port)||options.port<=0)throw new TypeError('NuBlox Shell --port must be a positive integer');i+=1;continue;}
    if(arg==='--user'){options.user=take(argv,i,'--user');i+=1;continue;}
    if(arg==='--database'){options.database=take(argv,i,'--database');i+=1;continue;}
    if(arg==='--filename'){options.filename=take(argv,i,'--filename');i+=1;continue;}
    if(arg==='--format'){options.format=take(argv,i,'--format').toLowerCase();i+=1;continue;}
    if(arg==='--execute'||arg==='-e'){options.execute=take(argv,i,arg);i+=1;continue;}
    if(arg==='--command'||arg==='-c'){options.command=take(argv,i,arg);i+=1;continue;}
    if(arg==='--option'){
      var parsed=parseOption(take(argv,i,'--option'));
      options.extra[parsed.key]=parsed.value;
      i+=1;continue;
    }
    throw new RangeError('Unknown NuBlox Shell option "'+arg+'"');
  }
  if(output.FORMATS.indexOf(options.format)===-1)throw new RangeError('NuBlox Shell output format must be one of: '+output.FORMATS.join(', '));
  var modes=[options.execute!==undefined,options.command!==undefined,
    options.demo===true,options.doctor===true,options.file!==undefined];
  if(modes.filter(Boolean).length>1){
    throw new Error('NuBlox Shell accepts only one of --execute, --command, --file, --demo, or --doctor');
  }
  if(options.output!==undefined&&!modes.some(Boolean)){
    throw new Error('NuBlox Shell --output requires --execute, --command, --file, --demo, or --doctor');
  }
  if(options.file!==undefined&&(!options.file.trim()||options.file==='-')){
    throw new TypeError('NuBlox Shell --file must identify a readable SQL file');
  }
  if(options.output!==undefined&&(!options.output.trim()||options.output==='-')){
    throw new TypeError('NuBlox Shell --output must identify a new results file');
  }
  return options;
}
function help(){
  return [
    'NuBlox Shell v'+pkg.version,
    '',
    'Usage:',
    '  nublox --url <database-url>',
    '  nublox --dialect <dialect> [connection options]',
    '  nublox --url <database-url> --execute "SELECT ..."',
    '  nublox --url <database-url> --command "\\tables"',
    '  nublox --demo                          No configuration required',
    '  nublox --doctor                        Self-test using in-memory SQLite',
    '  nublox --url <database-url> --doctor   Validate a real connection',
    '  nublox --url <database-url> --file query.sql --output results.csv --format csv',
    '',
    'Connection:',
    '  --url <url>              NuBloxSQL-supported connection URL',
    '  --dialect <dialect>      mysql | postgresql | sqlite | sqlserver',
    '  --host <host>',
    '  --port <port>',
    '  --user <user>',
    '  --database <database>',
    '  --filename <file>        SQLite database filename',
    '  --option key=value       Additional dialect-native connection option',
    '  --pool / --no-pool',
    '',
    'Credentials:',
    '  NUBLOX_PASSWORD          Password when using discrete connection options',
    '  NUBLOX_DATABASE_URL      Preferred environment URL',
    '  DATABASE_URL             Fallback environment URL',
    '',
    'Execution:',
    '  -e, --execute <sql>      Execute native SQL and exit',
    '  -c, --command <command>  Execute one NuBlox Shell command and exit',
    '  --file <path>            Execute one native SQL statement from a UTF-8 file',
    '  --output <path>          Save one-shot output to a NEW file (never overwrite)',
    '  --demo                   Run an isolated SQLite in-memory example and exit',
    '  --doctor                 Verify query and discovery, then exit with status',
    '  --format <format>        table | json | jsonl | csv',
    '',
    'General:',
    '  -h, --help',
    '  -v, --version'
  ].join('\n');
}
function connectionFrom(options,env){
  env=env||{};
  var url=options.url||env.NUBLOX_DATABASE_URL||env.DATABASE_URL;
  if(url)return url;
  var dialect=options.dialect||env.NUBLOX_DIALECT;
  if(!dialect)return null;
  var config=Object.assign({},options.extra||{},{dialect:dialect});
  if(options.host!==undefined)config.host=options.host;
  else if(env.NUBLOX_HOST)config.host=env.NUBLOX_HOST;
  if(options.port!==undefined)config.port=options.port;
  else if(env.NUBLOX_PORT)config.port=Number(env.NUBLOX_PORT);
  if(options.user!==undefined)config.user=options.user;
  else if(env.NUBLOX_USER)config.user=env.NUBLOX_USER;
  if(options.database!==undefined)config.database=options.database;
  else if(env.NUBLOX_DATABASE)config.database=env.NUBLOX_DATABASE;
  if(options.filename!==undefined)config.filename=options.filename;
  else if(env.NUBLOX_FILENAME)config.filename=env.NUBLOX_FILENAME;
  if(env.NUBLOX_PASSWORD!==undefined)config.password=env.NUBLOX_PASSWORD;
  if(options.pool!==undefined)config.pool=options.pool;
  return config;
}
async function run(argv,io,env,sqlApi){
  io=io||{};
  env=env||{};
  var stdout=io.stdout||process.stdout;
  var stderr=io.stderr||process.stderr;
  var options;
  try{options=parseArgs(argv);}
  catch(error){stderr.write((error&&error.message?error.message:String(error))+'\n');return 2;}

  if(options.help){stdout.write(help()+'\n');return 0;}
  if(options.version){stdout.write(pkg.version+'\n');return 0;}

  var suppliedConnection=connectionFrom(options,env);
  var selfTest=options.doctor===true&&!suppliedConnection;
  var connection=options.demo||selfTest
    ? {dialect:'sqlite',filename:':memory:',pool:false}
    : suppliedConnection;
  if(!connection){
    stderr.write('NuBlox Shell requires --url, NUBLOX_DATABASE_URL, DATABASE_URL, or --dialect connection options. Try --demo or --doctor for a configuration-free test.\n');
    return 2;
  }

  var shell=new Shell({sqlApi:sqlApi,format:options.format});
  var outputFd=null;
  var outputWritten=false;

  function emit(value){
    var text=value===undefined||value===null?'':String(value);
    if(!text)return;
    if(outputFd===null){stdout.write(text+'\n');return;}
    fs.writeFileSync(outputFd,text+'\n',{encoding:'utf8'});
    fs.fsyncSync(outputFd);
    outputWritten=true;
  }

  try{
    // Reserve output exclusively BEFORE running SQL: a pre-existing file
    // cannot turn a completed mutation into a failed export.
    if(options.output!==undefined)outputFd=fs.openSync(options.output,'wx',0o600);

    var statement=null;
    if(options.file!==undefined){
      var info=fs.statSync(options.file);
      if(!info.isFile()||info.size>1024*1024)throw new Error('NuBlox Shell SQL input must be a regular UTF-8 file of at most 1 MiB');
      statement=fs.readFileSync(options.file,'utf8').replace(/^\uFEFF/,'').trim();
      if(!statement)throw new Error('NuBlox Shell SQL input is empty');
    }

    shell.connect(connection);
    if(options.demo){
      await shell.executeLine('CREATE TABLE nublox_demo (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      await shell.executeLine("INSERT INTO nublox_demo (id, name) VALUES (1, 'NuBloxSQL'), (2, 'SQLite')");
      var demoRows=await shell.executeLine('SELECT id, name FROM nublox_demo ORDER BY id');
      var demoServer=await shell.client.discoverServer();
      var demoTables=await shell.client.metadata.tables({});
      var demo={
        status:'ok',mode:'demo',dialect:'sqlite',database:':memory:',
        serverVersion:demoServer.identity.version,
        tables:demoTables.map(function(item){return item.name;}),
        rows:demoRows.value
      };
      emit(output.render(demo,options.format));
      return 0;
    }
    if(options.doctor){
      var check=await shell.client.one('SELECT 1 AS nublox_check');
      if(!check||Number(check.nublox_check)!==1)throw new Error('NuBloxSQL doctor query returned an unexpected result');
      var report=await shell.client.discoverServer();
      if(!report||!report.identity||!report.identity.version||!report.summary){
        throw new Error('NuBloxSQL doctor could not obtain valid server discovery evidence');
      }
      emit(output.render({
        status:'ok',mode:selfTest?'self-test':'connection',
        dialect:shell.client.dialect,
        serverVersion:report.identity.version,
        databasesVisible:report.summary.databases,
        check:1
      },options.format));
      return 0;
    }
    if(options.execute!==undefined||options.file!==undefined){
      var sqlResult=await shell.executeLine(statement===null?options.execute:statement);
      var sqlText=shell.render(sqlResult);
      emit(sqlText);
      return 0;
    }
    if(options.command){
      var command=options.command.charAt(0)==='\\'?options.command:'\\'+options.command;
      var commandResult=await shell.executeLine(command);
      var commandText=shell.render(commandResult);
      emit(commandText);
      return commandResult.kind==='quit'?0:0;
    }
    return await repl.run(shell,io);
  }catch(error){
    stderr.write((error&&error.message?error.message:String(error))+'\n');
    return 1;
  }finally{
    try{await shell.close();}catch(closeError){stderr.write((closeError&&closeError.message?closeError.message:String(closeError))+'\n');}
    if(outputFd!==null){
      try{fs.closeSync(outputFd);}catch(ignore){}
      if(!outputWritten){try{fs.unlinkSync(options.output);}catch(ignore){}}
    }
  }
}

exports.help=help;
exports.parseArgs=parseArgs;
exports.connectionFrom=connectionFrom;
exports.run=run;
