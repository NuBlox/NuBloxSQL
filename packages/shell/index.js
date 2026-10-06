'use strict';

var Shell=require('./lib/Shell').Shell;
var cli=require('./lib/Cli');

function loadNuBloxSQL(){
  return require('nubloxsql');
}

function createShell(options){
  options=options||{};
  if(!options.sqlApi)options=Object.assign({},options,{sqlApi:loadNuBloxSQL()});
  return new Shell(options);
}

async function runCli(argv,io,env,sqlApi){
  return cli.run(argv,io,env,sqlApi||loadNuBloxSQL());
}

exports.Shell=Shell;
exports.createShell=createShell;
exports.runCli=runCli;
exports.parseArgs=cli.parseArgs;
