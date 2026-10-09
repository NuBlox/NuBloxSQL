'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v6-')),tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\\r?\\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v6-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const u=sql.capabilityModel.parseSql('mysql','UPDATE a JOIN b ON b.id = a.id SET a.x = ?, b.y = ? WHERE a.id = ?');",
    "assert.strictEqual(u.type,'MysqlMultiTableUpdateStatement'); assert.strictEqual(sql.capabilityModel.analyzeAst(u).scope,'dml-v6');",
    "const uc=sql.capabilityModel.compileAst('mysql',u); assert.deepStrictEqual(uc.targetToSource,[1,2,3]);",
    "const d=sql.capabilityModel.parseSql('mysql','DELETE a, b FROM a JOIN b ON b.id = a.id WHERE a.id = ?');",
    "assert.strictEqual(d.type,'MysqlMultiTableDeleteStatement'); assert(sql.capabilityModel.compileAst('mysql',d).sql.indexOf('DELETE `a`, `b` FROM')===0);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlAstMysqlMultiTableUpdateStatement, SqlAstMysqlMultiTableDeleteStatement, SqlDmlCompilerScope } from 'nubloxsql';",
    "const u=sql.capabilityModel.parseSql('mysql','UPDATE a JOIN b ON b.id=a.id SET a.x=?');",
    "if(u.type==='MysqlMultiTableUpdateStatement'){const typed:SqlAstMysqlMultiTableUpdateStatement=u; void typed;}",
    "const d=sql.capabilityModel.parseSql('mysql','DELETE a FROM a JOIN b ON b.id=a.id');",
    "if(d.type==='MysqlMultiTableDeleteStatement'){const typed:SqlAstMysqlMultiTableDeleteStatement=d; void typed;}",
    "const scope:SqlDmlCompilerScope='dml-v6'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v6 MySQL multi-table qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
