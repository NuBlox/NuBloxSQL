#!/usr/bin/env node
'use strict';

require('../index').runCli(
  process.argv.slice(2),
  {stdin:process.stdin,stdout:process.stdout,stderr:process.stderr},
  process.env
).then(function(code){
  process.exitCode=code;
}).catch(function(error){
  process.stderr.write((error&&error.stack?error.stack:String(error))+'\n');
  process.exitCode=1;
});
