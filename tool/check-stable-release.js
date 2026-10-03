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
function diagnostic(error) { return [error && error.message, error && error.stdout, error && error.stderr].filter(Boolean).join('\n'); }
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
catch (_) { fail('root public exports changed; update docs/releases/public-api-v1.json only as an intentional API decision\n   expected: ' + expectedExports.join(', ') + '\n   actual:   ' + actualExports.join(', ')); }

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
  manifest.requiredPackageFiles.forEach(function (file) { if (files.indexOf(file) === -1) fail('packed package is missing ' + file); });
  manifest.forbiddenPackagePrefixes.forEach(function (prefix) {
    files.forEach(function (file) { if (file.indexOf(prefix) === 0) fail('packed package contains forbidden path ' + file); });
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
    "if (sql.QUERY_DIAGNOSTICS_SCHEMA_VERSION !== 1) throw new Error('query diagnostics schema mismatch');",
    "if (sql.SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION !== 1) throw new Error('capability ontology schema mismatch');",
    "const ontologyValidation = sql.capabilityOntology.validate();",
    "if (!ontologyValidation.valid || ontologyValidation.definitions < 150) throw new Error('capability ontology qualification failed');",
    "const rightJoin = sql.capabilityOntology.resolve('sqlite', 'queries.joins.right', { version: '3.39.0' });",
    "if (!rightJoin || rightJoin.available !== true) throw new Error('capability ontology version resolution failed');",
    "const compilerCoverage = sql.capabilityOntology.implementation('queries.cte.recursive');",
    "if (!compilerCoverage || compilerCoverage.scope !== 'select-query-v2' || compilerCoverage.stages.parser !== 'implemented' || !compilerCoverage.qualified) throw new Error('capability implementation coverage failed');",
    "const setCoverage = sql.capabilityOntology.implementation('queries.setOperators.union');",
    "if (!setCoverage || setCoverage.scope !== 'select-query-v3' || setCoverage.stages.parser !== 'implemented' || !setCoverage.qualified) throw new Error('set-operation capability implementation coverage failed');",
    "const windowCoverage = sql.capabilityOntology.implementation('queries.windows.rows');",
    "if (!windowCoverage || windowCoverage.scope !== 'select-query-v4' || windowCoverage.stages.parser !== 'implemented' || !windowCoverage.qualified) throw new Error('window capability implementation coverage failed');",
    "const caseCoverage = sql.capabilityOntology.implementation('expressions.caseExpression');",
    "if (!caseCoverage || caseCoverage.scope !== 'select-query-v4' || !caseCoverage.qualified) throw new Error('expression capability implementation coverage failed');",
    "const rewrite = sql.capabilityModel.rewriteSql('postgresql', 'sqlite', 'SELECT $2, $1');",
    "if (rewrite.sql !== 'SELECT ?2, ?1') throw new Error('rewrite qualification failed');",
    "const ast = sql.capabilityModel.parseSql('postgresql', 'SELECT id FROM users WHERE id = $1');",
    "const compiled = sql.capabilityModel.compileAst('mysql', ast);",
    "if (!compiled.sql.includes('WHERE') || compiled.targetToSource[0] !== 1) throw new Error('AST compiler qualification failed');",
    "const transpiled = sql.capabilityModel.transpileSql('postgresql', 'mysql', 'SELECT id FROM users WHERE id = $1');",
    "if (!transpiled.certified || transpiled.scope !== 'select-foundation-v1' || transpiled.targetToSource[0] !== 1) throw new Error('AST transpilation qualification failed');",
    "const queryWave = sql.capabilityModel.transpileSql('postgresql', 'mysql', 'WITH scoped AS (SELECT id FROM users WHERE id = $1) SELECT id FROM scoped');",
    "if (!queryWave.certified || queryWave.scope !== 'select-query-v2' || !queryWave.sql.startsWith('WITH `scoped` AS')) throw new Error('CTE compiler-wave qualification failed');",
    "const nestedWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT d.id FROM (SELECT id FROM users) d WHERE EXISTS (SELECT 1 FROM users x WHERE x.id = d.id)');",
    "if (!nestedWave.certified || nestedWave.scope !== 'select-query-v2') throw new Error('subquery compiler-wave qualification failed');",
    "const setWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT 1 AS n UNION SELECT 2 INTERSECT SELECT 2 ORDER BY n');",
    "if (!setWave.certified || setWave.scope !== 'select-query-v3' || !setWave.sql.includes('INTERSECT')) throw new Error('set-operation compiler-wave qualification failed');",
    "const expressionWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT CASE WHEN 1 BETWEEN 1 AND 2 THEN CAST(1 AS DECIMAL(10,2)) ELSE 0 END AS v');",
    "if (!expressionWave.certified || expressionWave.scope !== 'select-query-v4' || !expressionWave.sql.includes('CAST')) throw new Error('expression compiler-wave qualification failed');",
    "const db = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "(async () => {",
    "  await db.execute('CREATE TABLE release_smoke (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');",
    "  await db.execute(sql.sql`INSERT INTO release_smoke (id, name) VALUES (${1}, ${'qualified'})`);",
    "  const row = await db.one(sql.sql`SELECT id, name FROM release_smoke WHERE id = ${1}`);",
    "  if (row.name !== 'qualified') throw new Error('consumer smoke query failed');",
    "  const runtime = await sql.capabilityModel.qualifyClient(db);",
    "  if (runtime.dialect !== 'sqlite' || !runtime.version) throw new Error('runtime capability qualification failed');",
    "  const snapshot = await db.introspect({ deep: true });",
    "  if (!snapshot.tables.some(t => t.name === 'release_smoke')) throw new Error('consumer introspection failed');",
    "  const diagnosis = await db.diagnose(sql.sql`SELECT id FROM release_smoke WHERE id = ${1}`, { includeOpcodes: true });",
    "  if (diagnosis.dialect !== 'sqlite' || diagnosis.schemaVersion !== 1 || !diagnosis.native.plan || !diagnosis.native.explain) throw new Error('consumer diagnostics failed');",
    "  const executableCte = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'WITH RECURSIVE scoped(id) AS (SELECT id FROM release_smoke) SELECT id FROM scoped');",
    "  const cteRow = await db.one(executableCte.sql);",
    "  if (cteRow.id !== 1) throw new Error('packed CTE execution failed');",
    "  const executableNested = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT d.id FROM (SELECT id FROM release_smoke) d WHERE EXISTS (SELECT 1 FROM release_smoke x WHERE x.id = d.id)');",
    "  const nestedRow = await db.one(executableNested.sql);",
    "  if (nestedRow.id !== 1) throw new Error('packed subquery execution failed');",
    "  const executableSet = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT 1 AS n UNION SELECT 2 INTERSECT SELECT 2 ORDER BY n');",
    "  const setRows = await db.all(executableSet.sql);",
    "  if (setRows.length !== 2 || Number(setRows[0].n) !== 1 || Number(setRows[1].n) !== 2) throw new Error('packed set-operation execution failed');",
    "  const executableExpression = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT CASE WHEN id BETWEEN 1 AND 1 THEN CAST(id AS DECIMAL(10,2)) ELSE 0 END AS v FROM release_smoke');",
    "  const expressionRow = await db.one(executableExpression.sql);",
    "  if (Number(expressionRow.v) !== 1) throw new Error('packed CASE/CAST execution failed');",
    "  const executableWindow = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT id, sum(id) OVER w AS running FROM release_smoke WINDOW w AS (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)', { targetQualification: runtime });",
    "  if (!executableWindow.certified || executableWindow.scope !== 'select-query-v4') throw new Error('packed window transpilation failed');",
    "  const windowRow = await db.one(executableWindow.sql);",
    "  if (Number(windowRow.running) !== 1) throw new Error('packed window execution failed');",
    "  await db.close();",
    "})().catch(error => { console.error(error.stack || error); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.js'), consumer);
  run(process.execPath, ['smoke.js'], { cwd: temp });

  run(npm, ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@5.9.3', '@types/node@22'], { cwd: temp });
  var typeConsumer = [
    "import sql = require('nubloxsql');",
    "import type { MySqlClient, PostgreSqlClient, SqliteClient, SqlServerClient, QueryDiagnosticsOptions, QueryDiagnosticsReport, SqlCapabilityOntologyApi, SqlCapabilityDefinition, SqlCapabilityObservation, SqlCapabilityImplementationCoverage, SqlRuntimeCapabilityReport, SqlRewritePlan, SqlRewriteResult, SqlQueryAst, SqlSelectStatementAst, SqlSetOperationStatementAst, SqlAstWithClause, SqlAstDerivedTable, SqlAstSubqueryExpression, SqlAstCaseExpression, SqlAstCastExpression, SqlAstWindowExpression, SqlAstWindowDefinition, SqlCompilerScope, SqlCompiledAst, SqlTranspileResult } from 'nubloxsql';",
    "const mysql: MySqlClient = sql.createClient({ dialect: 'mysql', user: 'app', pool: false });",
    "const pg: PostgreSqlClient = sql.createClient({ dialect: 'pg', user: 'app', pool: false });",
    "const sqlite: SqliteClient = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "const mssql: SqlServerClient = sql.createClient({ dialect: 'mssql', user: 'app', pool: true });",
    "const sqliteDialect: 'sqlite' = sqlite.dialect;",
    "const pgDialect: 'postgresql' = pg.dialect;",
    "const mysqlDialect: 'mysql' = mysql.dialect;",
    "const sqlServerDialect: 'sqlserver' = mssql.dialect;",
    "const governance = sqlite.native.resourceGovernanceCapabilities();",
    "const budget = sqlite.native.queryBudget({ profile: 'hardened' });",
    "sqlite.native.governedQuery('SELECT 1', undefined, budget);",
    "const diagnosticOptions: QueryDiagnosticsOptions = { includeOpcodes: true };",
    "const diagnosticReport: Promise<QueryDiagnosticsReport> = sqlite.diagnose('SELECT 1', diagnosticOptions);",
    "const pgDiagnostic: Promise<QueryDiagnosticsReport> = pg.diagnose('SELECT 1', { analyze: true, buffers: true });",
    "const mysqlDiagnostic: Promise<QueryDiagnosticsReport> = mysql.diagnose('SELECT 1', { analyze: true });",
    "const ontology: SqlCapabilityOntologyApi = sql.capabilityOntology;",
    "const ontologyDefinition: SqlCapabilityDefinition | null = ontology.definition('queries.cte.recursive');",
    "const ontologyObservation: SqlCapabilityObservation | null = ontology.observation('postgresql', 'queries.cte.recursive');",
    "const ontologyCoverage: SqlCapabilityImplementationCoverage | null = sql.capabilityModel.ontology.implementation('queries.cte.recursive');",
    "const staticRuntime: SqlRuntimeCapabilityReport = sql.capabilityModel.qualify('sqlite', { version: '3.49.1' });",
    "const liveRuntime: Promise<SqlRuntimeCapabilityReport> = sql.capabilityModel.qualifyClient(sqlite);",
    "const rewritePlan: SqlRewritePlan = sql.capabilityModel.planRewrite('postgresql', 'sqlite', ['queries.joins.inner']);",
    "const rewritten: SqlRewriteResult = sql.capabilityModel.rewriteSql('postgresql', 'sqlite', 'SELECT $1');",
    "const parsedAst: SqlQueryAst = sql.capabilityModel.parseSql('postgresql', 'SELECT id FROM users WHERE id = $1');",
    "if (parsedAst.type !== 'SelectStatement') throw new Error('expected select AST');",
    "const ast: SqlSelectStatementAst = parsedAst;",
    "const compiled: SqlCompiledAst = sql.capabilityModel.compileAst('mysql', ast);",
    "const transpiled: SqlTranspileResult = sql.capabilityModel.transpileSql('postgresql', 'mysql', 'SELECT id FROM users WHERE id = $1');",
    "const parsedCte: SqlQueryAst = sql.capabilityModel.parseSql('postgresql', 'WITH x AS (SELECT id FROM users) SELECT id FROM x');",
    "if (parsedCte.type !== 'SelectStatement') throw new Error('expected CTE select AST');",
    "const cteAst: SqlSelectStatementAst = parsedCte;",
    "const cteWith: SqlAstWithClause | null = cteAst.with;",
    "const queryScope: SqlCompilerScope = sql.capabilityModel.analyzeAst(cteAst).scope;",
    "const derivedQuery: SqlQueryAst = sql.capabilityModel.parseSql('postgresql', 'SELECT d.id FROM (SELECT id FROM users) d');",
    "if (derivedQuery.type !== 'SelectStatement') throw new Error('expected derived-table select AST');",
    "const derived: SqlAstDerivedTable | null = derivedQuery.from && derivedQuery.from.type === 'DerivedTable' ? derivedQuery.from : null;",
    "const scalarQuery: SqlQueryAst = sql.capabilityModel.parseSql('postgresql', 'SELECT (SELECT id FROM users) AS nested');",
    "if (scalarQuery.type !== 'SelectStatement') throw new Error('expected scalar-subquery select AST');",
    "const scalar: SqlAstSubqueryExpression | null = scalarQuery.columns[0].type === 'AliasedExpression' && scalarQuery.columns[0].expression.type === 'SubqueryExpression' ? scalarQuery.columns[0].expression : null;",
    "const setAst: SqlQueryAst = sql.capabilityModel.parseSql('postgresql', 'SELECT 1 AS n UNION SELECT 2');",
    "const setNode: SqlSetOperationStatementAst | null = setAst.type === 'SetOperationStatement' ? setAst : null;",
    "const setScope: SqlCompilerScope = sql.capabilityModel.analyzeAst(setAst).scope;",
    "const wave3Ast: SqlQueryAst = sql.capabilityModel.parseSql('postgresql', 'SELECT CASE WHEN id > 0 THEN CAST(id AS DECIMAL(10,2)) ELSE 0 END AS v, sum(id) OVER w AS running FROM users WINDOW w AS (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)');",
    "if (wave3Ast.type !== 'SelectStatement') throw new Error('expected Wave 3 select AST');",
    "const wave3Scope: SqlCompilerScope = sql.capabilityModel.analyzeAst(wave3Ast).scope;",
    "const caseNode: SqlAstCaseExpression | null = wave3Ast.columns[0].type === 'AliasedExpression' && wave3Ast.columns[0].expression.type === 'CaseExpression' ? wave3Ast.columns[0].expression : null;",
    "const castNode: SqlAstCastExpression | null = caseNode && caseNode.branches[0].then.type === 'CastExpression' ? caseNode.branches[0].then : null;",
    "const windowNode: SqlAstWindowExpression | null = wave3Ast.columns[1].type === 'AliasedExpression' && wave3Ast.columns[1].expression.type === 'WindowExpression' ? wave3Ast.columns[1].expression : null;",
    "const windowDefinitions: readonly SqlAstWindowDefinition[] = wave3Ast.windows;",
    "void governance; void budget; void diagnosticOptions; void diagnosticReport; void pgDiagnostic; void mysqlDiagnostic; void ontology; void ontologyDefinition; void ontologyObservation; void ontologyCoverage; void staticRuntime; void liveRuntime; void rewritePlan; void rewritten; void parsedAst; void ast; void compiled; void transpiled; void parsedCte; void cteAst; void cteWith; void queryScope; void derivedQuery; void derived; void scalarQuery; void scalar; void setAst; void setNode; void setScope; void wave3Ast; void wave3Scope; void caseNode; void castNode; void windowNode; void windowDefinitions;",
    "sqlite.transaction(async tx => { const d: 'sqlite' = tx.dialect; void d; await tx.diagnose('SELECT 1'); });",
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
