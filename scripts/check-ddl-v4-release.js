'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, options) { return childProcess.execFileSync(command, args, Object.assign({ cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }, options || {})); }

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-ddl-v4-'));
var tarball = null;
try {
  tarball = run(npm, ['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath = path.join(root, tarball);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name:'nubloxsql-ddl-v4-smoke', private:true }));
  run(npm, ['install', tarballPath, '--ignore-scripts','--no-audit','--no-fund'], { cwd: temp });
  var smoke = [
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "const c=sql.capabilityOntology.implementation('statements.dropIndex'); assert(c&&c.scope==='ddl-v4'&&c.qualified);",
    "const t=sql.capabilityModel.transpileSql('postgresql','sqlite','DROP TABLE IF EXISTS ledger'); assert(t.certified&&t.scope==='ddl-v4');",
    "const i=sql.capabilityModel.transpileSql('postgresql','sqlite','DROP INDEX IF EXISTS ledger_idx'); assert(i.certified&&i.sql.includes('IF EXISTS'));",
    "let m=false; try{sql.capabilityModel.transpileSql('postgresql','mysql','DROP INDEX ledger_idx');}catch(e){m=/table identity|index-identity/.test(String(e&&e.message));} assert.strictEqual(m,true);",
    "const s=sql.capabilityModel.transpileSql('postgresql','postgresql','DROP SEQUENCE IF EXISTS ledger_seq'); assert(s.certified);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlDropIndexStatementAst, SqlDropSchemaStatementAst, SqlDropSequenceStatementAst, SqlDdlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','DROP INDEX IF EXISTS ledger_idx');",
    "if(a.type==='DropIndexStatement'){const x:SqlDropIndexStatementAst=a; void x;}",
    "const b:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','DROP SCHEMA IF EXISTS reporting'); if(b.type==='DropSchemaStatement'){const x:SqlDropSchemaStatementAst=b; void x;}",
    "const d:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','DROP SEQUENCE IF EXISTS ledger_seq'); if(d.type==='DropSequenceStatement'){const x:SqlDropSequenceStatementAst=d; void x;}",
    "const scope:SqlDdlCompilerScope=sql.capabilityModel.analyzeAst(a).scope as SqlDdlCompilerScope; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts); fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc'); run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed ddl-v4 release qualification: PASS');
} finally { if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}} fs.rmSync(temp,{recursive:true,force:true}); }
