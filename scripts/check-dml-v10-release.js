'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v10-')),tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v10-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const source='MERGE INTO t AS x USING (WITH r AS (SELECT id, v FROM s WHERE v > $1) SELECT r.id, r.v FROM r) AS y ON x.id=y.id WHEN MATCHED THEN UPDATE SET v=y.v WHEN NOT MATCHED THEN INSERT (id, v) VALUES (y.id, y.v)';",
    "const ast=sql.capabilityModel.parseSql('postgresql',source);",
    "assert.strictEqual(ast.source.type,'MutationSource');",
    "assert.strictEqual(sql.capabilityModel.analyzeAst(ast).scope,'dml-v10');",
    "const c=sql.capabilityModel.compileAst('postgresql',ast);",
    "assert.deepStrictEqual(c.targetToSource,[1]); assert(c.sql.includes('USING (WITH'));"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlMergeStatementAst, SqlDmlCompilerScope, SqlAstMutationSource } from 'nubloxsql';",
    "const m=sql.capabilityModel.parseSql('postgresql','MERGE INTO t USING (SELECT id FROM s) AS q ON t.id=q.id WHEN MATCHED THEN DELETE');",
    "if(m.type==='MergeStatement'&&m.source.type==='MutationSource'){const s:SqlAstMutationSource=m.source; void s;}",
    "const typed:SqlMergeStatementAst=m as SqlMergeStatementAst; void typed;",
    "const scope:SqlDmlCompilerScope='dml-v10'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v10 MERGE rich-source qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
