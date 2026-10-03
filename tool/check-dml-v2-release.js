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

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-dml-v2-'));
var tarball = null;
try {
  tarball = run(npm, ['pack', '--silent', '--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath = path.join(root, tarball);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'nubloxsql-dml-v2-smoke', private: true }));
  run(npm, ['install', tarballPath, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temp });

  var smoke = [
    "const assert = require('assert');",
    "const sql = require('nubloxsql');",
    "const conflict = sql.capabilityOntology.implementation('syntax.conflictHandling');",
    "assert(conflict && conflict.scope === 'dml-v2' && conflict.qualified);",
    "const merge = sql.capabilityOntology.implementation('statements.merge');",
    "assert(merge && merge.scope === 'dml-v2' && merge.qualified);",
    "const upsert = sql.capabilityModel.transpileSql('postgresql', 'sqlite', \"INSERT INTO t (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = excluded.name\");",
    "assert.strictEqual(upsert.scope, 'dml-v2'); assert.strictEqual(upsert.certified, true);",
    "assert.deepStrictEqual(upsert.targetToSource, [1, 2]);",
    "let crossFamilyBlocked = false; try { sql.capabilityModel.transpileSql('postgresql', 'mysql', \"INSERT INTO t (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = excluded.name\"); } catch (e) { crossFamilyBlocked = /not losslessly portable/.test(String(e && e.message)); }",
    "assert.strictEqual(crossFamilyBlocked, true);",
    "const mergeAst = sql.capabilityModel.parseSql('postgresql', 'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE');",
    "assert.strictEqual(mergeAst.type, 'MergeStatement');",
    "const mergeSql = sql.capabilityModel.compileAst('postgresql', mergeAst); assert(mergeSql.sql.includes('WHEN MATCHED THEN DELETE'));",
    "let mergeBlocked = false; try { sql.capabilityModel.transpileSql('postgresql', 'mysql', 'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE'); } catch (e) { mergeBlocked = /no certified automatic rewrite/.test(String(e && e.message)); }",
    "assert.strictEqual(mergeBlocked, true);",
    "const db = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "(async () => {",
    "  await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');",
    "  await db.execute(\"INSERT INTO t (id, name) VALUES (1, 'old')\");",
    "  const runtime = await sql.capabilityModel.qualifyClient(db);",
    "  const executable = sql.capabilityModel.transpileSql('postgresql', 'sqlite', \"INSERT INTO t (id, name) VALUES (1, 'new') ON CONFLICT (id) DO UPDATE SET name = excluded.name\", { targetQualification: runtime });",
    "  await db.execute(executable.sql);",
    "  const row = await db.one('SELECT name FROM t WHERE id = 1'); assert.strictEqual(row.name, 'new');",
    "  await db.close();",
    "})().catch(error => { console.error(error.stack || error); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.js'), smoke);
  run(process.execPath, ['smoke.js'], { cwd: temp });
  console.log('NuBloxSQL packed dml-v2 UPSERT/MERGE release qualification: PASS');
} finally {
  if (tarball) { try { fs.unlinkSync(path.join(root, tarball)); } catch (_) {} }
  fs.rmSync(temp, { recursive: true, force: true });
}
