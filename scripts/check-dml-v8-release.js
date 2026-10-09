'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v8-')),tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v8-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const m=sql.capabilityModel.parseSql('postgresql','MERGE INTO t AS x USING s AS y ON x.id=y.id WHEN MATCHED AND y.v > $1 THEN UPDATE SET v=y.v WHEN MATCHED THEN DELETE WHEN NOT MATCHED THEN DO NOTHING');",
    "assert.strictEqual(m.type,'MergeStatement'); assert.strictEqual(m.clauses.length,3);",
    "assert.strictEqual(sql.capabilityModel.analyzeAst(m).scope,'dml-v8');",
    "const c=sql.capabilityModel.compileAst('postgresql',m); assert.deepStrictEqual(c.targetToSource,[1]);",
    "assert(c.sql.includes('WHEN MATCHED THEN DELETE')); assert(c.sql.includes('WHEN NOT MATCHED THEN DO NOTHING'));"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlMergeWhenClauseAst, SqlDmlCompilerScope } from 'nubloxsql';",
    "const m=sql.capabilityModel.parseSql('postgresql','MERGE INTO t USING s ON t.id=s.id WHEN MATCHED THEN DO NOTHING');",
    "if(m.type==='MergeStatement'&&m.clauses){const c:SqlMergeWhenClauseAst=m.clauses[0]; void c;}",
    "const scope:SqlDmlCompilerScope='dml-v8'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v8 MERGE action-chain qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
