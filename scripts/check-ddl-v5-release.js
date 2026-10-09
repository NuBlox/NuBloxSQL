'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, options) { return childProcess.execFileSync(command, args, Object.assign({ cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }, options || {})); }

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-ddl-v5-'));
var tarball = null;
try {
  tarball = run(npm, ['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath = path.join(root, tarball);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name:'nubloxsql-ddl-v5-smoke', private:true }));
  run(npm, ['install', tarballPath, '--ignore-scripts','--no-audit','--no-fund'], { cwd: temp });
  var smoke = [
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "for(const id of ['schema.concurrentIndexBuild','schema.concurrentIndexDrop','syntax.dropDependency.cascade','syntax.dropDependency.restrict']){const c=sql.capabilityOntology.implementation(id); assert(c&&c.scope==='ddl-v5'&&c.qualified);}",
    "const c=sql.capabilityModel.transpileSql('postgresql','postgresql','CREATE INDEX CONCURRENTLY idx_x ON t (id)'); assert(c.certified&&c.scope==='ddl-v5'&&c.sql.includes('CONCURRENTLY'));",
    "const d=sql.capabilityModel.transpileSql('postgresql','postgresql','DROP TABLE t CASCADE'); assert(d.certified&&d.sql.endsWith('CASCADE'));",
    "let blocked=false; try{sql.capabilityModel.transpileSql('postgresql','sqlite','DROP TABLE t CASCADE');}catch(e){blocked=/PostgreSQL-only/.test(String(e&&e.message));} assert.strictEqual(blocked,true);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlCreateIndexStatementAst, SqlDropIndexStatementAst, SqlDropDependencyMode, SqlDdlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','CREATE INDEX CONCURRENTLY idx_x ON t (id)');",
    "if(a.type==='CreateIndexStatement'){const x:SqlCreateIndexStatementAst=a; const concurrent:boolean|undefined=x.concurrently; void concurrent;}",
    "const b:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','DROP INDEX CONCURRENTLY idx_x RESTRICT');",
    "if(b.type==='DropIndexStatement'){const x:SqlDropIndexStatementAst=b; const mode:SqlDropDependencyMode|undefined=x.dependencyMode; void mode;}",
    "const scope:SqlDdlCompilerScope='ddl-v5'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts); fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc'); run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed ddl-v5 release qualification: PASS');
} finally { if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}} fs.rmSync(temp,{recursive:true,force:true}); }
