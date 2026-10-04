'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}
var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dml-v3-'));var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dml-v3-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const u=sql.capabilityModel.parseSql('postgresql','UPDATE t SET value = s.value FROM source AS s WHERE t.id = s.id'); assert.strictEqual(sql.capabilityModel.analyzeAst(u).scope,'dml-v3');",
    "assert(sql.capabilityModel.compileAst('postgresql',u).sql.includes(' FROM \"source\" AS \"s\" WHERE '));",
    "const d=sql.capabilityModel.parseSql('postgresql','DELETE FROM t USING source AS s WHERE t.id = s.id'); assert.strictEqual(sql.capabilityModel.analyzeAst(d).scope,'dml-v3');",
    "assert.strictEqual(sql.capabilityOntology.implementation('syntax.updateFrom').scope,'dml-v3');",
    "assert.strictEqual(sql.capabilityModel.status('mysql','syntax.multiTableUpdate').support,'native');"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlUpdateStatementAst, SqlDeleteStatementAst, SqlDmlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','UPDATE t SET value = s.value FROM source AS s WHERE t.id = s.id');",
    "if(a.type==='UpdateStatement'){const x:SqlUpdateStatementAst=a; void x.from;}",
    "const b:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','DELETE FROM t USING source AS s WHERE t.id = s.id');",
    "if(b.type==='DeleteStatement'){const x:SqlDeleteStatementAst=b; void x.using;}",
    "const scope:SqlDmlCompilerScope='dml-v3'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed dml-v3 release qualification: PASS');
}finally{if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}fs.rmSync(temp,{recursive:true,force:true});}
