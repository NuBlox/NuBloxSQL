'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v9-')),tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v9-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const source='MERGE INTO t AS x USING s AS y ON x.id=y.id WHEN NOT MATCHED BY TARGET THEN INSERT (id) VALUES (y.id) WHEN NOT MATCHED BY SOURCE THEN DELETE RETURNING x.id';",
    "const ast=sql.capabilityModel.parseSql('postgresql',source);",
    "assert.strictEqual(sql.capabilityModel.analyzeAst(ast).scope,'dml-v9');",
    "const q17=sql.capabilityModel.qualify('postgresql',{version:'17.0'});",
    "const r=sql.capabilityModel.transpileSql('postgresql','postgresql',source,{sourceQualification:q17,targetQualification:q17});",
    "assert.strictEqual(r.certified,true); assert(r.sql.includes('BY SOURCE')); assert(r.sql.includes('RETURNING'));"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlMergeWhenClauseAst, SqlDmlCompilerScope } from 'nubloxsql';",
    "const m=sql.capabilityModel.parseSql('postgresql','MERGE INTO t USING s ON t.id=s.id WHEN NOT MATCHED BY SOURCE THEN DELETE RETURNING t.id');",
    "if(m.type==='MergeStatement'&&m.clauses){const c:SqlMergeWhenClauseAst=m.clauses[0]; const k:'not-matched-by-source'=c.match as 'not-matched-by-source'; void k;}",
    "const scope:SqlDmlCompilerScope='dml-v9'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v9 version-qualified MERGE qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
