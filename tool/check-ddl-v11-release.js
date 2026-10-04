'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}
var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-ddl-v11-')); var tarball=null;
try {
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-ddl-v11-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const s=sql.capabilityModel.parseSql('postgresql','CREATE SEQUENCE s START WITH 4 INCREMENT BY 2 CACHE 1 NO CYCLE'); assert.strictEqual(sql.capabilityModel.analyzeAst(s).scope,'ddl-v11');",
    "assert(sql.capabilityModel.compileAst('postgresql',s).sql.includes('START WITH 4'));",
    "const m=sql.capabilityModel.parseSql('mysql','CREATE TABLE t (id BIGINT AUTO_INCREMENT PRIMARY KEY)'); assert.strictEqual(m.columns[0].autoIncrement.strategy,'mysql-auto-increment');",
    "const q=sql.capabilityModel.parseSql('sqlite','CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)'); assert.strictEqual(q.columns[0].autoIncrement.strategy,'sqlite-rowid-autoincrement');",
    "assert.strictEqual(sql.capabilityOntology.implementation('schema.sequenceOptions.start').scope,'ddl-v11');"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlCreateSequenceStatementAst, SqlAstSequenceOptions, SqlDdlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','CREATE SEQUENCE s START WITH 1');",
    "if(a.type==='CreateSequenceStatement'){const x:SqlCreateSequenceStatementAst=a; const o:SqlAstSequenceOptions|undefined=x.options; void o;}",
    "const scope:SqlDdlCompilerScope='ddl-v11'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc'); run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed ddl-v11 release qualification: PASS');
} finally { if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}} fs.rmSync(temp,{recursive:true,force:true}); }
