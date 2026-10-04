'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-ddl-v8-'));
var tarball=null;
try {
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-ddl-v8-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "for(const id of ['schema.expressionIndex','schema.functionalIndex','schema.coveringIndex','schema.indexAccessMethod']){const c=sql.capabilityOntology.implementation(id);assert(c&&c.scope==='ddl-v8'&&c.qualified);}",
    "const pg=sql.capabilityModel.transpileSql('postgresql','postgresql','CREATE INDEX ledger_idx ON ledger USING btree ((lower(code))) INCLUDE (id)');assert(pg.certified&&pg.scope==='ddl-v8'&&/USING btree/.test(pg.sql)&&/INCLUDE/.test(pg.sql));",
    "const my=sql.capabilityModel.transpileSql('mysql','mysql','CREATE INDEX ledger_idx ON ledger ((lower(code)))');assert(my.certified&&my.scope==='ddl-v8'&&/\\(\\(lower\\(/i.test(my.sql));",
    "const q=sql.capabilityModel.qualify('sqlite',{version:'3.49.1'});const sq=sql.capabilityModel.transpileSql('sqlite','sqlite','CREATE INDEX ledger_idx ON ledger ((lower(code)))',{sourceQualification:q,targetQualification:q});assert(sq.certified&&sq.scope==='ddl-v8');",
    "let blocked=false;try{sql.capabilityModel.transpileSql('postgresql','mysql','CREATE INDEX ledger_idx ON ledger ((lower(code)))');}catch(e){blocked=/semantic decision|functional index/i.test(String(e&&e.message));}assert.strictEqual(blocked,true);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlAstIndexKey, SqlAstIndexExpressionKey, SqlDdlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','CREATE INDEX ledger_idx ON ledger ((lower(code))) INCLUDE (id)');",
    "if(a.type==='CreateIndexStatement'&&a.keys){const k:SqlAstIndexKey=a.keys[0];if(k.type==='IndexExpressionKey'){const e:SqlAstIndexExpressionKey=k;void e;}}",
    "const scope:SqlDdlCompilerScope='ddl-v8';void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed ddl-v8 release qualification: PASS');
} finally { if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}} fs.rmSync(temp,{recursive:true,force:true}); }
