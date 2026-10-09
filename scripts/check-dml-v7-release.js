'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v7-')),tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v7-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const u=sql.capabilityModel.parseSql('mysql','UPDATE LOW_PRIORITY IGNORE ledger AS l SET l.amount=? WHERE l.id=? ORDER BY l.id DESC LIMIT ?');",
    "assert.strictEqual(u.type,'MysqlSingleTableUpdateStatement'); assert.strictEqual(sql.capabilityModel.analyzeAst(u).scope,'dml-v7');",
    "const uc=sql.capabilityModel.compileAst('mysql',u); assert.deepStrictEqual(uc.targetToSource,[1,2,3]);",
    "const d=sql.capabilityModel.parseSql('mysql','DELETE LOW_PRIORITY QUICK IGNORE FROM ledger AS l WHERE l.id=? ORDER BY l.id LIMIT ?');",
    "assert.strictEqual(d.type,'MysqlSingleTableDeleteStatement'); assert.strictEqual(sql.capabilityModel.analyzeAst(d).scope,'dml-v7');"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlAstMysqlSingleTableUpdateStatement, SqlAstMysqlSingleTableDeleteStatement, SqlDmlCompilerScope } from 'nubloxsql';",
    "const u=sql.capabilityModel.parseSql('mysql','UPDATE ledger AS l SET l.amount=? LIMIT 1');",
    "if(u.type==='MysqlSingleTableUpdateStatement'){const typed:SqlAstMysqlSingleTableUpdateStatement=u; void typed;}",
    "const d=sql.capabilityModel.parseSql('mysql','DELETE FROM ledger AS l LIMIT 1');",
    "if(d.type==='MysqlSingleTableDeleteStatement'){const typed:SqlAstMysqlSingleTableDeleteStatement=d; void typed;}",
    "const scope:SqlDmlCompilerScope='dml-v7'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v7 MySQL mutation controls qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
