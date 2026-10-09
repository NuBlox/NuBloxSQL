'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-ddl-v9-'));
var tarball=null;
try {
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-ddl-v9-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "for(const id of ['schema.indexKeyOrder','schema.indexKeyCollation','schema.indexNullsOrder','schema.operatorClass']){const c=sql.capabilityOntology.implementation(id);assert(c&&c.scope==='ddl-v9'&&c.qualified);}",
    "const pg=sql.capabilityModel.transpileSql('postgresql','postgresql','CREATE INDEX ledger_idx ON ledger (code COLLATE \"C\" text_pattern_ops DESC NULLS LAST)');assert(pg.certified&&pg.scope==='ddl-v9'&&/NULLS LAST/.test(pg.sql));",
    "const my=sql.capabilityModel.transpileSql('mysql','mysql','CREATE INDEX ledger_idx ON ledger (code DESC)');assert(my.certified&&my.scope==='ddl-v9'&&/DESC/.test(my.sql));",
    "const sq=sql.capabilityModel.transpileSql('sqlite','sqlite','CREATE INDEX ledger_idx ON ledger (code COLLATE NOCASE DESC)');assert(sq.certified&&sq.scope==='ddl-v9'&&/COLLATE/.test(sq.sql));",
    "let blocked=false;try{sql.capabilityModel.transpileSql('sqlite','postgresql','CREATE INDEX ledger_idx ON ledger (code COLLATE NOCASE DESC)');}catch(e){blocked=/collation identity/i.test(String(e&&e.message));}assert.strictEqual(blocked,true);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlAstIndexKey, SqlIndexKeyDirection, SqlIndexNullsOrder, SqlDdlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','CREATE INDEX ledger_idx ON ledger (code DESC NULLS LAST)');",
    "if(a.type==='CreateIndexStatement'&&a.keys){const k:SqlAstIndexKey=a.keys[0];const d:SqlIndexKeyDirection|undefined|null=k.direction;const n:SqlIndexNullsOrder|undefined|null=k.nulls;void d;void n;}",
    "const scope:SqlDdlCompilerScope='ddl-v9';void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed ddl-v9 release qualification: PASS');
} finally { if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}} fs.rmSync(temp,{recursive:true,force:true}); }
