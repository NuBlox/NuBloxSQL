'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v5-')),tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v5-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const pg=sql.capabilityModel.parseSql('postgresql','UPDATE ledger SET amount = $1 FROM (SELECT id, amount FROM rates WHERE tenant_id = $3) AS r WHERE ledger.id = $2');",
    "assert.strictEqual(sql.capabilityModel.analyzeAst(pg).scope,'dml-v5');",
    "const pgc=sql.capabilityModel.compileAst('postgresql',pg); assert.deepStrictEqual(pgc.targetToSource,[1,3,2]);",
    "const sq=sql.capabilityModel.parseSql('sqlite','UPDATE ledger SET amount = ? FROM (SELECT id, amount FROM rates WHERE tenant_id = ?) AS r WHERE ledger.id = ?');",
    "const sqc=sql.capabilityModel.compileAst('sqlite',sq); assert.deepStrictEqual(sqc.targetToSource,[1,2,3]);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlDmlCompilerScope } from 'nubloxsql';",
    "const ast=sql.capabilityModel.parseSql('postgresql','UPDATE ledger SET amount = $1 FROM (SELECT id FROM rates WHERE tenant_id = $2) AS r WHERE ledger.id = r.id');",
    "const scope:SqlDmlCompilerScope=sql.capabilityModel.analyzeAst(ast).scope as SqlDmlCompilerScope; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v5 parameter remapping qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
