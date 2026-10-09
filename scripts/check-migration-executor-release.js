'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';

function run(command,args,options){
  return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));
}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-migration-executor-'));
var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-migration-executor-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert');",
    "const sql=require('nubloxsql');",
    "assert.strictEqual(sql.MIGRATION_EXECUTION_SCHEMA_VERSION,1);",
    "const plan={schemaVersion:1,targetDialect:'postgresql',transactionStrategy:'transactional-preferred',source:{semanticHash:'a'},target:{semanticHash:'b'},steps:[{id:'migration-step-0001',phase:70,status:'added',safety:'safe',execution:'automatic',targetDialect:'postgresql',logicalKey:'x',kind:'column',sql:'ALTER TABLE x ADD COLUMN y TEXT',preconditions:[],rollback:{mode:'compensating',sql:'ALTER TABLE x DROP COLUMN y'},notes:null}]};",
    "let calls=0;",
    "sql.executeMigration({dialect:'postgresql',execute:async()=>{calls++;}},plan,{dryRun:true}).then(result=>{assert.strictEqual(result.status,'dry-run');assert.strictEqual(calls,0);}).catch(error=>{console.error(error);process.exitCode=1;});"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { MigrationExecutionResult, MigrationCheckpoint } from 'nubloxsql';",
    "const version:1=sql.MIGRATION_EXECUTION_SCHEMA_VERSION;",
    "const client=sql.createClient({dialect:'sqlite',filename:':memory:'});",
    "const plan={schemaVersion:1 as const,diffSchemaVersion:1 as const,targetDialect:'sqlite' as const,transactionStrategy:'transactional-preferred' as const,source:{semanticHash:'a',sourceHash:'a',dialect:'sqlite'},target:{semanticHash:'b',sourceHash:'b',dialect:'sqlite'},highestSafety:'safe' as const,executable:true,summary:{steps:0,automatic:0,manual:0,safe:0,dependencySensitive:0,manualReview:0,potentiallyLossy:0,destructive:0},steps:[]};",
    "const result:Promise<MigrationExecutionResult>=client.executeMigration(plan,{dryRun:true});",
    "result.then(r=>{const cp:MigrationCheckpoint=r.checkpoint;void cp;return client.close();});",
    "void version;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});

  console.log('NuBloxSQL packed migration execution engine qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
