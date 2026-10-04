'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command,args,options){return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-ddl-v7-'));
var tarball=null;
try {
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-ddl-v7-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});
  var smoke=[
    "const assert=require('assert'); const sql=require('nubloxsql');",
    "for(const id of ['schema.tableAlter.addForeignKey','integrity.deferrableForeignKeys','integrity.onDeleteCascade','integrity.onUpdateRestrict','integrity.matchFull']){const c=sql.capabilityOntology.implementation(id); assert(c&&c.scope==='ddl-v7'&&c.qualified);}",
    "const src='CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id) ON DELETE CASCADE ON UPDATE RESTRICT)'; const r=sql.capabilityModel.transpileSql('postgresql','mysql',src); assert(r.certified&&r.scope==='ddl-v7'&&/ON DELETE CASCADE/.test(r.sql));",
    "const alt=sql.capabilityModel.transpileSql('postgresql','mysql','ALTER TABLE child ADD CONSTRAINT child_parent_fk FOREIGN KEY (parent_id) REFERENCES parent (id) ON DELETE CASCADE'); assert(alt.certified&&alt.capabilities.includes('schema.tableAlter.addForeignKey'));",
    "let blocked=false; try{sql.capabilityModel.parseSql('mysql','CREATE TABLE child (a INTEGER REFERENCES parent (a) MATCH SIMPLE)');}catch(e){blocked=/MATCH/.test(String(e&&e.message));} assert.strictEqual(blocked,true);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke); run(process.execPath,['smoke.js'],{cwd:temp});
  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlAstForeignKeyReference, SqlForeignKeyAction, SqlForeignKeyMatch, SqlForeignKeyInitialMode, SqlDdlCompilerScope } from 'nubloxsql';",
    "const a:SqlStatementAst=sql.capabilityModel.parseSql('postgresql','CREATE TABLE child (id INTEGER, parent_id INTEGER REFERENCES parent (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE)');",
    "if(a.type==='CreateTableStatement'){const fk:SqlAstForeignKeyReference|null=a.columns[1].references; if(fk){const action:SqlForeignKeyAction|undefined=fk.onDelete; const match:SqlForeignKeyMatch|undefined=fk.match; const initial:SqlForeignKeyInitialMode|undefined=fk.initially; void action; void match; void initial;}}",
    "const scope:SqlDdlCompilerScope='ddl-v7'; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc'); run(tsc,['-p','tsconfig.json'],{cwd:temp});
  console.log('NuBloxSQL packed ddl-v7 release qualification: PASS');
} finally { if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}} fs.rmSync(temp,{recursive:true,force:true}); }
