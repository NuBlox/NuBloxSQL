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

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-schema-diff-'));
var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-schema-diff-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert');",
    "const sql=require('nubloxsql');",
    "assert.strictEqual(sql.SCHEMA_DIFF_SCHEMA_VERSION,1);",
    "const a={vocabularyVersion:1,dialect:'postgresql',scope:{},databases:[],schemas:[],tables:[]};",
    "const b={vocabularyVersion:1,dialect:'mysql',scope:{},databases:[],schemas:[],tables:[]};",
    "const diff=sql.diffSchemas(a,b);",
    "assert.strictEqual(diff.equivalent,true);",
    "assert.strictEqual(sql.schemaDiffChanged(diff),false);",
    "assert.strictEqual(sql.schemaDiffHighestSafety(diff),'safe');"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SchemaDiff, SchemaChangeSafety } from 'nubloxsql';",
    "const version:1=sql.SCHEMA_DIFF_SCHEMA_VERSION;",
    "const input={vocabularyVersion:1 as const,dialect:'sqlite' as const,scope:{},databases:[],schemas:[],tables:[]};",
    "const diff:SchemaDiff=sql.diffSchemas(input,input);",
    "const safety:SchemaChangeSafety=sql.schemaDiffHighestSafety(diff);",
    "void version; void safety;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});

  console.log('NuBloxSQL packed canonical schema diff qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
