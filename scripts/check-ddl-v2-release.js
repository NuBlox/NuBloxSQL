'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, options) {
  return childProcess.execFileSync(command, args, Object.assign({ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, options || {}));
}

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-ddl-v2-'));
var tarball = null;
try {
  tarball = run(npm, ['pack', '--silent', '--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath = path.join(root, tarball);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'nubloxsql-ddl-v2-smoke', private: true }));
  run(npm, ['install', tarballPath, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temp });

  var smoke = [
    "const assert = require('assert');",
    "const sql = require('nubloxsql');",
    "const coverage = sql.capabilityOntology.implementation('schema.tableAlter.renameColumn');",
    "assert(coverage && coverage.scope === 'ddl-v2' && coverage.qualified);",
    "const add = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'ALTER TABLE alter_smoke ADD COLUMN note VARCHAR(40)');",
    "assert.strictEqual(add.scope, 'ddl-v2'); assert.strictEqual(add.certified, true);",
    "const old = sql.capabilityModel.qualify('sqlite', { version: '3.24.0' });",
    "let oldBlocked = false; try { sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'ALTER TABLE alter_smoke RENAME COLUMN note TO memo', { targetQualification: old }); } catch (e) { oldBlocked = /unsupported target capabilities/.test(String(e && e.message)); }",
    "assert.strictEqual(oldBlocked, true);",
    "const db = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "(async () => {",
    "  await db.execute('CREATE TABLE alter_smoke (id INTEGER PRIMARY KEY, name TEXT)');",
    "  const runtime = await sql.capabilityModel.qualifyClient(db);",
    "  await db.execute(add.sql);",
    "  const rename = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'ALTER TABLE alter_smoke RENAME COLUMN note TO memo', { targetQualification: runtime });",
    "  await db.execute(rename.sql);",
    "  const drop = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'ALTER TABLE alter_smoke DROP COLUMN memo', { targetQualification: runtime });",
    "  await db.execute(drop.sql);",
    "  const columns = await db.all('PRAGMA table_info(alter_smoke)');",
    "  assert.deepStrictEqual(columns.map(c => c.name), ['id', 'name']);",
    "  await db.close();",
    "})().catch(error => { console.error(error.stack || error); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.js'), smoke);
  run(process.execPath, ['smoke.js'], { cwd: temp });

  run(npm, ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@5.9.3', '@types/node@22'], { cwd: temp });
  var typeSmoke = [
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlAlterTableStatementAst, SqlAlterTableActionAst, SqlDdlCompilerScope } from 'nubloxsql';",
    "const statement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'ALTER TABLE typed_table ADD COLUMN note VARCHAR(40)');",
    "if (statement.type !== 'AlterTableStatement') throw new Error('expected ALTER TABLE AST');",
    "const alter: SqlAlterTableStatementAst = statement;",
    "const action: SqlAlterTableActionAst = alter.action;",
    "const scope: SqlDdlCompilerScope = sql.capabilityModel.analyzeAst(alter).scope as SqlDdlCompilerScope;",
    "void action; void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.ts'), typeSmoke);
  fs.writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'commonjs', target: 'ES2022', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: false }, files: ['smoke.ts'] }));
  var tsc = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  run(tsc, ['-p', 'tsconfig.json'], { cwd: temp });

  console.log('NuBloxSQL packed ddl-v2 release qualification: PASS');
} finally {
  if (tarball) { try { fs.unlinkSync(path.join(root, tarball)); } catch (_) {} }
  fs.rmSync(temp, { recursive: true, force: true });
}
