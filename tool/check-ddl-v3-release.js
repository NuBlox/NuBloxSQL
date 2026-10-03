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

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-ddl-v3-'));
var tarball = null;
try {
  tarball = run(npm, ['pack', '--silent', '--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath = path.join(root, tarball);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'nubloxsql-ddl-v3-smoke', private: true }));
  run(npm, ['install', tarballPath, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temp });

  var smoke = [
    "const assert = require('assert');",
    "const sql = require('nubloxsql');",
    "const coverage = sql.capabilityOntology.implementation('schema.tableAlter.setDefault');",
    "assert(coverage && coverage.scope === 'ddl-v3' && coverage.qualified);",
    "const portable = sql.capabilityModel.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 7');",
    "assert.strictEqual(portable.scope, 'ddl-v3'); assert.strictEqual(portable.certified, true);",
    "let sqliteBlocked = false; try { sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger ALTER COLUMN amount DROP DEFAULT'); } catch (e) { sqliteBlocked = /unsupported target capabilities/.test(String(e && e.message)); }",
    "assert.strictEqual(sqliteBlocked, true);",
    "let mysqlTypeBlocked = false; try { sql.capabilityModel.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ALTER COLUMN amount TYPE BIGINT'); } catch (e) { mysqlTypeBlocked = /semantic transformation/.test(String(e && e.message)); }",
    "assert.strictEqual(mysqlTypeBlocked, true);",
    "const constraint = sql.capabilityModel.transpileSql('postgresql', 'postgresql', 'ALTER TABLE ledger ADD CONSTRAINT ledger_amount_positive CHECK (amount >= 0)');",
    "assert.strictEqual(constraint.certified, true); assert.strictEqual(constraint.scope, 'ddl-v3');"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.js'), smoke);
  run(process.execPath, ['smoke.js'], { cwd: temp });

  run(npm, ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@5.9.3', '@types/node@22'], { cwd: temp });
  var typeSmoke = [
    "import sql = require('nubloxsql');",
    "import type { SqlStatementAst, SqlAlterTableStatementAst, SqlAlterTableActionAst, SqlAlterColumnTypeActionAst, SqlSetColumnDefaultActionAst, SqlAddConstraintActionAst, SqlDdlCompilerScope } from 'nubloxsql';",
    "const statement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'ALTER TABLE ledger ALTER COLUMN amount TYPE BIGINT');",
    "if (statement.type !== 'AlterTableStatement') throw new Error('expected ALTER TABLE AST');",
    "const alter: SqlAlterTableStatementAst = statement;",
    "const action: SqlAlterTableActionAst = alter.action;",
    "if (action.type === 'AlterColumnTypeAction') { const typed: SqlAlterColumnTypeActionAst = action; void typed; }",
    "const def: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0');",
    "if (def.type === 'AlterTableStatement' && def.action.type === 'SetColumnDefaultAction') { const typed: SqlSetColumnDefaultActionAst = def.action; void typed; }",
    "const con: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'ALTER TABLE ledger ADD CONSTRAINT ck CHECK (amount >= 0)');",
    "if (con.type === 'AlterTableStatement' && con.action.type === 'AddConstraintAction') { const typed: SqlAddConstraintActionAst = con.action; void typed; }",
    "const scope: SqlDdlCompilerScope = sql.capabilityModel.analyzeAst(alter).scope as SqlDdlCompilerScope;",
    "void scope;"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.ts'), typeSmoke);
  fs.writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'commonjs', target: 'ES2022', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: false }, files: ['smoke.ts'] }));
  var tsc = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  run(tsc, ['-p', 'tsconfig.json'], { cwd: temp });

  console.log('NuBloxSQL packed ddl-v3 release qualification: PASS');
} finally {
  if (tarball) { try { fs.unlinkSync(path.join(root, tarball)); } catch (_) {} }
  fs.rmSync(temp, { recursive: true, force: true });
}
