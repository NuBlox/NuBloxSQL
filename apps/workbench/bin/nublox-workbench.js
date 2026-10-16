#!/usr/bin/env node
'use strict';
const sqlApi=require('../../../index');
const workbenchOptions=require('../lib/Options');
const {createWorkbench}=require('../lib/Server');

function usage(){
  return [
    'NuBloxSQL Graphical Workbench (local preview)',
    'Usage:',
    '  node apps/workbench/bin/nublox-workbench.js --demo',
    '  node apps/workbench/bin/nublox-workbench.js --dialect sqlite --filename ./database.sqlite',
    '  node apps/workbench/bin/nublox-workbench.js --url <database-url>',
    '  node apps/workbench/bin/nublox-workbench.js --port 4277 [connection options]',
    '  node apps/workbench/bin/nublox-workbench.js --db-port 5433 --dialect postgresql --host 127.0.0.1',
    '',
    'The Workbench listens ONLY on 127.0.0.1. --port/--listen-port set',
    'its HTTP listener; --db-port sets the database TCP port.',
    'Credentials remain server-side in process memory.',
    'SQL entered in the browser executes with the selected DB permissions.',
    'Use --option mode=readonly with SQLite for inspection-only access.'
  ].join('\n');
}
async function run(argv=process.argv.slice(2),env=process.env,streams=process){
  const options=workbenchOptions.parseArgs(argv);
  if(options.help){streams.stdout.write(usage()+'\n');return null;}
  if(options.version){
    streams.stdout.write('NuBloxSQL Workbench preview (driver '+require('../../../package.json').version+')\n');
    return null;
  }
  const connection=options.demo?null:workbenchOptions.connectionFrom(options,env);
  if(!options.demo&&!connection)throw new Error('Workbench requires --demo or a database connection. Use --help.');
  const app=createWorkbench({sqlApi,connection,demo:options.demo});
  const url=await app.listen(options.listenPort);
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
