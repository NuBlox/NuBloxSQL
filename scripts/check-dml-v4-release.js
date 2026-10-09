'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v4-')),tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v4-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const a=sql.capabilityModel.parseSql('postgresql','UPDATE ledger SET amount = r.amount FROM rates AS r INNER JOIN bands AS b ON b.id = r.band_id WHERE ledger.id = r.id');",
    "assert.strictEqual(a.from.type,'MutationSource'); assert.strictEqual(a.from.joins.length,1);",
    "assert.strictEqual(sql.capabilityModel.analyzeAst(a).scope,'dml-v4');",
    "const c=sql.capabilityModel.compileAst('postgresql',a); assert(c.sql.includes(' INNER JOIN '));",
    "const d=sql.capabilityModel.parseSql('postgresql','UPDATE ledger SET amount = r.amount FROM (SELECT id, amount FROM rates) AS r WHERE ledger.id = r.id'); assert.strictEqual(d.from.relation.type,'DerivedTable');"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlAstMutationSource, SqlDmlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','UPDATE ledger SET amount = r.amount FROM rates AS r JOIN bands AS b ON b.id = r.band_id WHERE ledger.id = r.id');",
    "if(a.type==='UpdateStatement'&&a.from&&a.from.type==='MutationSource'){const s:SqlAstMutationSource=a.from; void s;}",
    "const scope:SqlDmlCompilerScope=sql.capabilityModel.analyzeAst(a).scope as SqlDmlCompilerScope; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v4 release qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
