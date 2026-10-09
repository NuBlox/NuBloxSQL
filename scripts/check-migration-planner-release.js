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

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-migration-planner-'));
var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-migration-planner-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert');",
    "const sql=require('nubloxsql');",
    "assert.strictEqual(sql.MIGRATION_PLAN_SCHEMA_VERSION,1);",
    "const base={vocabularyVersion:1,dialect:'postgresql',scope:{database:'app',schema:'public'},databases:[{kind:'database',name:'app',native:{}}],schemas:[{kind:'schema',database:'app',name:'public',native:{}}],tables:[{kind:'table',database:'app',schema:'public',name:'users',native:{},columns:[{kind:'column',database:'app',schema:'public',table:'users',name:'id',ordinal:1,dataType:'integer',nativeType:'integer',nullability:'not-null',default:null,primaryKey:true,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}}],indexes:[],foreignKeys:[],constraints:[]}]};",
    "const next=JSON.parse(JSON.stringify(base));",
    "next.tables[0].columns.push({kind:'column',database:'app',schema:'public',table:'users',name:'nickname',ordinal:2,dataType:'text',nativeType:'text',nullability:'nullable',default:null,primaryKey:false,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}});",
    "const plan=sql.planMigration(sql.diffSchemas(base,next));",
    "assert.strictEqual(plan.steps.length,1);",
    "assert.strictEqual(plan.steps[0].execution,'automatic');",
    "assert(/ADD COLUMN/.test(plan.steps[0].sql));"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { MigrationPlan, MigrationStep } from 'nubloxsql';",
    "const version:1=sql.MIGRATION_PLAN_SCHEMA_VERSION;",
    "const diff=sql.diffSchemas({vocabularyVersion:1,dialect:'sqlite',scope:{},databases:[],schemas:[],tables:[]},{vocabularyVersion:1,dialect:'sqlite',scope:{},databases:[],schemas:[],tables:[]});",
    "const plan:MigrationPlan=sql.planMigration(diff);",
    "const steps:readonly MigrationStep[]=sql.migrationAutomaticSteps(plan);",
    "void version; void steps;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});

  console.log('NuBloxSQL packed migration planner qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
