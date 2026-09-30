'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var root = path.resolve(__dirname, '..');
var npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/releases/public-api-v1.json'), 'utf8'));
var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
var api = require(root);
var failures = [];

function fail(message) { failures.push(message); }
function diagnostic(error) {
  return [error && error.message, error && error.stdout, error && error.stderr].filter(Boolean).join('\n');
}
function run(command, args, options) {
  return childProcess.execFileSync(command, args, Object.assign({ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, options || {}));
}

if (pkg.name !== manifest.packageName) fail('package name differs from public API manifest');
if (pkg.version !== manifest.version) fail('package version differs from public API manifest');
if (pkg.main !== manifest.main) fail('package main entry differs from public API manifest');
if (pkg.types !== manifest.types) fail('package types entry differs from public API manifest');
if (!pkg.engines || pkg.engines.node !== manifest.node) fail('Node support range differs from public API manifest');

var actualExports = Object.keys(api).sort();
var expectedExports = manifest.exports.slice().sort();
try { assert.deepStrictEqual(actualExports, expectedExports); }
catch (_) {
  fail('root public exports changed; update docs/releases/public-api-v1.json only as an intentional API decision\n   expected: ' + expectedExports.join(', ') + '\n   actual:   ' + actualExports.join(', '));
}

manifest.dialects.forEach(function (dialect) {
  if (!api.DIALECTS || api.DIALECTS[dialect] !== dialect) fail('DIALECTS is missing canonical dialect ' + dialect);
  if (!api.dialects || !api.dialects[dialect]) fail('dialects is missing adapter ' + dialect);
  if (typeof api.capabilityReport !== 'function') fail('capabilityReport export missing');
  else if (api.capabilityReport(dialect).dialect !== dialect) fail('capabilityReport does not preserve dialect ' + dialect);
});

var pack;
try { pack = JSON.parse(run(npm, ['pack', '--json', '--dry-run', '--ignore-scripts'])); }
catch (error) { fail('npm pack --dry-run failed: ' + diagnostic(error)); }
if (pack && pack[0]) {
  var files = pack[0].files.map(function (entry) { return entry.path; });
  manifest.requiredPackageFiles.forEach(function (file) {
    if (files.indexOf(file) === -1) fail('packed package is missing ' + file);
  });
  manifest.forbiddenPackagePrefixes.forEach(function (prefix) {
    files.forEach(function (file) {
      if (file.indexOf(prefix) === 0) fail('packed package contains forbidden path ' + file);
    });
  });
}

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-release-'));
var tarball = null;
try {
  tarball = run(npm, ['pack', '--silent', '--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath = path.join(root, tarball);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'nubloxsql-consumer-smoke', private: true }));
  run(npm, ['install', tarballPath, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temp });

  var consumer = [
    "const sql = require('nubloxsql');",
    "if (sql.OBSERVABILITY_SCHEMA_VERSION !== 1) throw new Error('observability schema mismatch');",
    "const db = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "(async () => {",
    "  await db.execute('CREATE TABLE release_smoke (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');",
    "  await db.execute(sql.sql`INSERT INTO release_smoke (id, name) VALUES (${1}, ${'qualified'})`);",
    "  const row = await db.one(sql.sql`SELECT id, name FROM release_smoke WHERE id = ${1}`);",
    "  if (row.name !== 'qualified') throw new Error('consumer smoke query failed');",
    "  const snapshot = await db.introspect({ deep: true });",
    "  if (!snapshot.tables.some(t => t.name === 'release_smoke')) throw new Error('consumer introspection failed');",
    "  await db.close();",
    "})().catch(error => { console.error(error.stack || error); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.js'), consumer);
  run(process.execPath, ['smoke.js'], { cwd: temp });

  run(npm, ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@5.9.3', '@types/node@22'], { cwd: temp });
  var typeConsumer = [
    "import sql = require('nubloxsql');",
    "import type { MySqlClient, PostgreSqlClient, SqliteClient, SqlServerClient } from 'nubloxsql';",
    "const mysql: MySqlClient = sql.createClient({ dialect: 'mysql', user: 'app', pool: false });",
    "const pg: PostgreSqlClient = sql.createClient({ dialect: 'pg', user: 'app', pool: false });",
    "const sqlite: SqliteClient = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "const mssql: SqlServerClient = sql.createClient({ dialect: 'mssql', user: 'app', pool: true });",
    "const sqliteDialect: 'sqlite' = sqlite.dialect;",
    "const pgDialect: 'postgresql' = pg.dialect;",
    "const mysqlDialect: 'mysql' = mysql.dialect;",
    "const sqlServerDialect: 'sqlserver' = mssql.dialect;",
    "sqlite.transaction(async tx => { const d: 'sqlite' = tx.dialect; void d; });",
    "sql.capabilityReport('pg').dialect satisfies 'postgresql';",
    "sql.transactionPolicy('mssql').dialect satisfies 'sqlserver';",
    "void sqliteDialect; void pgDialect; void mysqlDialect; void sqlServerDialect;"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'consumer.ts'), typeConsumer);
  var tsc = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  run(tsc, ['--strict', '--noEmit', '--target', 'ES2022', '--module', 'Node16', '--moduleResolution', 'Node16', 'consumer.ts'], { cwd: temp });
} catch (error) {
  fail('clean-install consumer qualification failed: ' + diagnostic(error));
} finally {
  if (tarball) { try { fs.unlinkSync(path.join(root, tarball)); } catch (_) {} }
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
}

if (failures.length) {
  console.error('NuBloxSQL stable release qualification: FAILED');
  failures.forEach(function (failure) { console.error(' - ' + failure); });
  process.exitCode = 1;
} else {
  console.log('NuBloxSQL stable release qualification: PASS');
  console.log('Public API manifest, npm package surface, JavaScript consumer and strict TypeScript consumer are qualified.');
}
