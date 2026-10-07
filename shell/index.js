'use strict';

var Shell=require('./lib/Shell').Shell;
var cli=require('./lib/Cli');

function loadNuBloxSQL(){
  try{return require('nubloxsql');}
  catch(error){
    if(!error||error.code!=='MODULE_NOT_FOUND'||String(error.message).indexOf("'nubloxsql'")===-1)throw error;
    try{
      var rootPackage=require('../package.json');
      if(rootPackage&&rootPackage.name==='nubloxsql')return require('..');
    }catch(ignore){}
    throw error;
  }
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
