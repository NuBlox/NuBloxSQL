'use strict';

var childProcess=require('child_process');
var fs=require('fs');
var path=require('path');

var root=path.resolve(__dirname,'..');
var manifestArg=process.argv[2];

if(!manifestArg){
  console.error('Usage: node scripts/run-suite.js <suite.json>');
  process.exit(2);
}

var manifestPath=path.resolve(root,manifestArg);
var suite=JSON.parse(fs.readFileSync(manifestPath,'utf8'));

if(!suite||suite.schemaVersion!==1||!Array.isArray(suite.steps)){
  throw new TypeError('NuBloxSQL suite manifest v1 required: '+manifestArg);
}

suite.steps.forEach(function(step,index){
  if(typeof step!=='string'||!step.trim())throw new TypeError('Invalid suite step at index '+index);
  var file=path.resolve(root,step);
  if(!file.startsWith(root+path.sep))throw new Error('Suite step escapes repository root: '+step);
  if(!fs.existsSync(file))throw new Error('Suite step does not exist: '+step);
  console.log('\n['+(index+1)+'/'+suite.steps.length+'] '+step);
  var result=childProcess.spawnSync(process.execPath,[file],{
    cwd:root,
    stdio:'inherit',
    env:process.env
  });
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status===null?1:result.status);
});

console.log('\n'+(suite.name||manifestArg)+': PASS');
