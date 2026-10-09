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

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-ddl-v1-'));
var tarball = null;
try {
  tarball = run(npm, ['pack', '--silent', '--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath = path.join(root, tarball);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'nubloxsql-ddl-v1-smoke', private: true }));
  run(npm, ['install', tarballPath, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temp });

  var smoke = [
    "const assert = require('assert');",
    "const sql = require('nubloxsql');",
    "const coverage = sql.capabilityOntology.implementation('statements.createTable');",
    "assert(coverage && coverage.scope === 'ddl-v1' && coverage.qualified);",
    "const ddl = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'CREATE TABLE release_ddl (id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL UNIQUE, amount DECIMAL(10,2) DEFAULT 0 CHECK (amount >= 0))');",
    "assert.strictEqual(ddl.scope, 'ddl-v1'); assert.strictEqual(ddl.certified, true);",
    "assert(ddl.sql.startsWith('CREATE TABLE \\\"release_ddl\\\"'));",
    "let partialBlocked = false; try { sql.capabilityModel.transpileSql('postgresql', 'mysql', 'CREATE INDEX release_partial ON release_ddl (id) WHERE amount > 0'); } catch (e) { partialBlocked = /unsupported target capabilities/.test(String(e && e.message)); }",
    "assert.strictEqual(partialBlocked, true);",
    "let schemaBlocked = false; try { sql.capabilityModel.transpileSql('postgresql', 'mysql', 'CREATE SCHEMA release_schema'); } catch (e) { schemaBlocked = /semantic rewrite|unsupported target capabilities/.test(String(e && e.message)); }",
    "assert.strictEqual(schemaBlocked, true);",
    "const db = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "(async () => {",
    "  const runtime = await sql.capabilityModel.qualifyClient(db);",
    "  const create = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'CREATE TABLE release_ddl (id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL, amount DECIMAL(10,2) DEFAULT 0 CHECK (amount >= 0))', { targetQualification: runtime });",
    "  await db.execute(create.sql);",
    "  await db.execute(\"INSERT INTO release_ddl (id, name, amount) VALUES (1, 'one', 5)\");",
    "  const view = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'CREATE VIEW release_ddl_view AS SELECT id, name FROM release_ddl WHERE amount >= 0', { targetQualification: runtime });",
    "  await db.execute(view.sql);",
    "  const row = await db.one('SELECT id, name FROM release_ddl_view'); assert.strictEqual(Number(row.id), 1);",
    "  await db.close();",
    "})().catch(error => { console.error(error.stack || error); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.js'), smoke);
  run(process.execPath, ['smoke.js'], { cwd: temp });

  run(npm, ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@5.9.3', '@types/node@22'], { cwd: temp });
  var typeSmoke = [
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlDdlAst, SqlCreateTableStatementAst, SqlCreateIndexStatementAst, SqlCreateViewStatementAst, SqlDdlCompilerScope } from 'nubloxsql';",
    "const statement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'CREATE TABLE typed_ddl (id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL)');",
    "if (statement.type !== 'CreateTableStatement') throw new Error('expected CREATE TABLE AST');",
    "const table: SqlCreateTableStatementAst = statement;",
    "const ddl: SqlDdlAst = table;",
    "const scope: SqlDdlCompilerScope = sql.capabilityModel.analyzeAst(ddl).scope as SqlDdlCompilerScope;",
    "const indexStatement = sql.capabilityModel.parseSql('postgresql', 'CREATE INDEX typed_idx ON typed_ddl (id)');",
    "if (indexStatement.type !== 'CreateIndexStatement') throw new Error('expected CREATE INDEX AST');",
    "const index: SqlCreateIndexStatementAst = indexStatement;",
    "const viewStatement = sql.capabilityModel.parseSql('postgresql', 'CREATE VIEW typed_view AS SELECT id FROM typed_ddl');",
    "if (viewStatement.type !== 'CreateViewStatement') throw new Error('expected CREATE VIEW AST');",
    "const view: SqlCreateViewStatementAst = viewStatement;",
    "void table; void ddl; void scope; void index; void view;"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.ts'), typeSmoke);
  fs.writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'commonjs', target: 'ES2022', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: false }, files: ['smoke.ts'] }));
  var tsc = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  run(tsc, ['-p', 'tsconfig.json'], { cwd: temp });

  console.log('NuBloxSQL packed ddl-v1 release qualification: PASS');
} finally {
  if (tarball) { try { fs.unlinkSync(path.join(root, tarball)); } catch (_) {} }
  fs.rmSync(temp, { recursive: true, force: true });
}
