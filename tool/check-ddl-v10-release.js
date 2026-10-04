'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-ddl-v10-'));
var tarball=null;
try {
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-ddl-v10-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const c=sql.capabilityOntology.implementation('statements.createTableAs');assert(c&&c.scope==='ddl-v10'&&c.qualified);",
    "for(const d of ['postgresql','mysql','sqlite']){const s=sql.capabilityModel.status(d,'statements.createTableAs');assert(s&&s.supported===true,d);}",
    "const pg=sql.capabilityModel.transpileSql('postgresql','postgresql','CREATE TABLE snap AS SELECT 1 AS id');assert(pg.certified&&pg.scope==='ddl-v10'&&/CREATE TABLE/.test(pg.sql));",
    "const my=sql.capabilityModel.transpileSql('mysql','mysql','CREATE TABLE snap AS SELECT 1 AS id');assert(my.certified&&my.scope==='ddl-v10');",
    "const sq=sql.capabilityModel.transpileSql('sqlite','sqlite','CREATE TABLE snap AS SELECT 1 AS id');assert(sq.certified&&sq.scope==='ddl-v10');",
    "let blocked=false;try{sql.capabilityModel.transpileSql('postgresql','mysql','CREATE TABLE snap AS SELECT 1 AS id');}catch(e){blocked=String(e&&e.message).includes('result-schema/type-normalisation');}assert.strictEqual(blocked,true);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlCreateTableAsStatementAst, SqlDdlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','CREATE TABLE snap AS SELECT 1 AS id');",
    "if(a.type==='CreateTableAsStatement'){const x:SqlCreateTableAsStatementAst=a;void x.query;}",
    "const scope:SqlDdlCompilerScope='ddl-v10';void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed ddl-v10 release qualification: PASS');
} finally {
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}
