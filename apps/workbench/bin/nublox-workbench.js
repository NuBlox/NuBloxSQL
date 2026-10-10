#!/usr/bin/env node
'use strict';
const sqlApi=require('../../../index');
const shellCli=require('../../shell/lib/Cli');
const {createWorkbench}=require('../lib/Server');

function usage(){
  return [
    'NuBloxSQL Graphical Workbench (local preview)',
    'Usage:',
    '  node apps/workbench/bin/nublox-workbench.js --demo',
    '  node apps/workbench/bin/nublox-workbench.js --dialect sqlite --filename ./database.sqlite',
    '  node apps/workbench/bin/nublox-workbench.js --url <database-url>',
    '  node apps/workbench/bin/nublox-workbench.js --port 4277 [connection options]',
    '',
    'The Workbench listens ONLY on 127.0.0.1. Other connection flags',
    'match NuBlox Shell. Credentials remain server-side in process memory.',
    'SQL entered in the browser executes with the selected DB permissions.',
    'Use --option mode=readonly with SQLite for inspection-only access.'
  ].join('\n');
}
async function run(argv=process.argv.slice(2),env=process.env,streams=process){
  let port=4277;
  const forwarded=[];
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--port'){
      if(i+1>=argv.length)throw new Error('--port requires a numeric value');
      port=Number(argv[++i]);
      if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('--port must be 0–65535');
    }else forwarded.push(argv[i]);
  }
  const options=shellCli.parseArgs(forwarded);
  if(options.help){streams.stdout.write(usage()+'\n');return null;}
  if(options.execute!==undefined||options.command!==undefined||options.stdin||options.doctor){
    throw new Error('Workbench requires connection options or --demo, not Shell execution options');
  }
  const connection=options.demo?null:shellCli.connectionFrom(options,env);
  if(!options.demo&&!connection)throw new Error('Workbench requires --demo or a database connection. Use --help.');
  const app=createWorkbench({sqlApi,connection,demo:options.demo});
  const url=await app.listen(port);
  streams.stdout.write('NuBloxSQL Workbench ready: '+url+'\n');
  streams.stdout.write('Open that local address in your browser. Ctrl+C stops the server.\n');
  return app;
}
if(require.main===module){
  run().then(function(app){
    if(!app)return;
    let exiting=false;
    function stop(){
      if(exiting)return;
      exiting=true;
      app.close().then(function(){process.exitCode=0;}).catch(function(e){
        process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;
      });
    }
    process.once('SIGINT',stop);
    process.once('SIGTERM',stop);
  }).catch(function(error){
    process.stderr.write(String(error.message||error)+'\n');
    process.exitCode=1;
  });
}
module.exports=Object.freeze({run,usage});
