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
    "if (sql.DIALECT_REGISTRY_SCHEMA_VERSION !== 1 || sql.DIALECT_REGISTRY_MASTER_PROFILE_COUNT !== 100) throw new Error('dialect registry schema mismatch');",
    "if (sql.PROFILE_CAPABILITY_OVERLAY_SCHEMA_VERSION !== 1 || !sql.profileCapabilities.validate().valid) throw new Error('profile capability overlay qualification failed');",
    "if (!sql.dialectRegistry.validate().valid || sql.dialectRegistry.report().counts.firstClassDialects !== 25) throw new Error('dialect registry qualification failed');",
    "const ontologyValidation = sql.capabilityOntology.validate();",
    "if (!ontologyValidation.valid || ontologyValidation.definitions < 150) throw new Error('capability ontology qualification failed');",
    "const rightJoin = sql.capabilityOntology.resolve('sqlite', 'queries.joins.right', { version: '3.39.0' });",
    "if (!rightJoin || rightJoin.available !== true) throw new Error('capability ontology version resolution failed');",
    "const compilerCoverage = sql.capabilityOntology.implementation('queries.cte.recursive');",
    "if (!compilerCoverage || compilerCoverage.scope !== 'select-query-v2' || compilerCoverage.stages.parser !== 'implemented' || !compilerCoverage.qualified) throw new Error('capability implementation coverage failed');",
    "const setCoverage = sql.capabilityOntology.implementation('queries.setOperators.union');",
    "if (!setCoverage || setCoverage.scope !== 'select-query-v3' || !setCoverage.qualified) throw new Error('set-operation implementation coverage failed');",
    "const windowCoverage = sql.capabilityOntology.implementation('queries.windows.rows');",
    "if (!windowCoverage || windowCoverage.scope !== 'select-query-v4' || !windowCoverage.qualified) throw new Error('window implementation coverage failed');",
    "const dmlCoverage = sql.capabilityOntology.implementation('statements.insert');",
    "if (!dmlCoverage || dmlCoverage.scope !== 'dml-v1' || dmlCoverage.stages.parser !== 'implemented' || !dmlCoverage.qualified) throw new Error('DML implementation coverage failed');",
    "const mysqlReturning = sql.capabilityOntology.resolve('mysql', 'syntax.returning');",
    "if (!mysqlReturning || mysqlReturning.available !== false) throw new Error('MySQL RETURNING capability honesty failed');",
    "const rewrite = sql.capabilityModel.rewriteSql('postgresql', 'sqlite', 'SELECT $2, $1');",
    "if (rewrite.sql !== 'SELECT ?2, ?1') throw new Error('rewrite qualification failed');",
    "const ast = sql.capabilityModel.parseSql('postgresql', 'SELECT id FROM users WHERE id = $1');",
    "const compiled = sql.capabilityModel.compileAst('mysql', ast);",
    "if (!compiled.sql.includes('WHERE') || compiled.targetToSource[0] !== 1) throw new Error('AST compiler qualification failed');",
    "const queryWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'WITH scoped AS (SELECT id FROM users) SELECT id FROM scoped');",
    "if (!queryWave.certified || queryWave.scope !== 'select-query-v2') throw new Error('query compiler-wave qualification failed');",
    "const setWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT 1 AS n UNION SELECT 2 INTERSECT SELECT 2 ORDER BY n');",
    "if (!setWave.certified || setWave.scope !== 'select-query-v3') throw new Error('set-operation compiler-wave qualification failed');",
    "const expressionWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT CASE WHEN 1 BETWEEN 1 AND 2 THEN CAST(1 AS DECIMAL(10,2)) ELSE 0 END AS v');",
    "if (!expressionWave.certified || expressionWave.scope !== 'select-query-v4') throw new Error('expression compiler-wave qualification failed');",
    "const dmlWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', \"INSERT INTO release_smoke (id, name) VALUES (2, 'dml')\");",
    "if (!dmlWave.certified || dmlWave.scope !== 'dml-v1' || !dmlWave.sql.startsWith('INSERT INTO')) throw new Error('DML compiler-wave qualification failed');",
    "let mysqlReturningBlocked = false;",
    "try { sql.capabilityModel.transpileSql('postgresql', 'mysql', 'DELETE FROM release_smoke WHERE id = $1 RETURNING id'); } catch (error) { mysqlReturningBlocked = /unsupported target capabilities/.test(String(error && error.message)); }",
    "if (!mysqlReturningBlocked) throw new Error('MySQL RETURNING did not fail closed');",
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
    "  const executableSet = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT 1 AS n UNION SELECT 2 INTERSECT SELECT 2 ORDER BY n');",
    "  const setRows = await db.all(executableSet.sql);",
    "  if (setRows.length !== 2) throw new Error('packed set-operation execution failed');",
    "  const executableWindow = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'SELECT id, sum(id) OVER w AS running FROM release_smoke WINDOW w AS (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)', { targetQualification: runtime });",
    "  const windowRow = await db.one(executableWindow.sql);",
    "  if (Number(windowRow.running) !== 1) throw new Error('packed window execution failed');",
    "  await db.execute(dmlWave.sql);",
    "  const dmlRow = await db.one('SELECT id, name FROM release_smoke WHERE id = 2');",
    "  if (Number(dmlRow.id) !== 2 || dmlRow.name !== 'dml') throw new Error('packed INSERT execution failed');",
    "  const updateWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', \"UPDATE release_smoke SET name = 'updated' WHERE id = 2\");",
    "  await db.execute(updateWave.sql);",
    "  const returningWave = sql.capabilityModel.transpileSql('postgresql', 'sqlite', 'DELETE FROM release_smoke WHERE id = 2 RETURNING id', { targetQualification: runtime });",
    "  if (!returningWave.certified || returningWave.scope !== 'dml-v1') throw new Error('packed RETURNING transpilation failed');",
    "  const returned = await db.all(returningWave.sql);",
    "  if (returned.length !== 1 || Number(returned[0].id) !== 2) throw new Error('packed RETURNING execution failed');",
    "  await db.close();",
    "})().catch(error => { console.error(error.stack || error); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(path.join(temp, 'smoke.js'), consumer);
  run(process.execPath, ['smoke.js'], { cwd: temp });

  run(npm, ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@5.9.3', '@types/node@22'], { cwd: temp });
  var typeConsumer = [
    "import sql = require('nubloxsql');",
    "import type { MySqlClient, PostgreSqlClient, SqliteClient, SqlServerClient, QueryDiagnosticsOptions, QueryDiagnosticsReport, SqlCapabilityOntologyApi, SqlCapabilityDefinition, SqlCapabilityObservation, SqlCapabilityImplementationCoverage, SqlRuntimeCapabilityReport, SqlRewritePlan, SqlRewriteResult, SqlStatementAst, SqlQueryAst, SqlSelectStatementAst, SqlSetOperationStatementAst, SqlInsertStatementAst, SqlUpdateStatementAst, SqlDeleteStatementAst, SqlAstWithClause, SqlAstDerivedTable, SqlAstSubqueryExpression, SqlAstCaseExpression, SqlAstCastExpression, SqlAstWindowExpression, SqlAstWindowDefinition, SqlStatementCompilerScope, SqlCompiledAst, SqlStatementTranspileResult, DialectRegistryApi, DialectRegistryProduct, ProfileCapabilityApi, ProfileCapabilityStatus } from 'nubloxsql';",
    "const mysql: MySqlClient = sql.createClient({ dialect: 'mysql', user: 'app', pool: false });",
    "const pg: PostgreSqlClient = sql.createClient({ dialect: 'pg', user: 'app', pool: false });",
    "const sqlite: SqliteClient = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });",
    "const mssql: SqlServerClient = sql.createClient({ dialect: 'mssql', user: 'app', pool: true });",
    "const sqliteDialect: 'sqlite' = sqlite.dialect; const pgDialect: 'postgresql' = pg.dialect; const mysqlDialect: 'mysql' = mysql.dialect; const sqlServerDialect: 'sqlserver' = mssql.dialect;",
    "const governance = sqlite.native.resourceGovernanceCapabilities();",
    "const budget = sqlite.native.queryBudget({ profile: 'hardened' }); sqlite.native.governedQuery('SELECT 1', undefined, budget);",
    "const diagnosticOptions: QueryDiagnosticsOptions = { includeOpcodes: true };",
    "const diagnosticReport: Promise<QueryDiagnosticsReport> = sqlite.diagnose('SELECT 1', diagnosticOptions);",
    "const pgDiagnostic: Promise<QueryDiagnosticsReport> = pg.diagnose('SELECT 1', { analyze: true, buffers: true });",
    "const mysqlDiagnostic: Promise<QueryDiagnosticsReport> = mysql.diagnose('SELECT 1', { analyze: true });",
    "const ontology: SqlCapabilityOntologyApi = sql.capabilityOntology;",
    "const dialectRegistry: DialectRegistryApi = sql.dialectRegistry;",
    "const profileCapabilityApi: ProfileCapabilityApi = sql.profileCapabilities;",
    "const inheritedCapability: ProfileCapabilityStatus = profileCapabilityApi.status('aurora-postgresql', 'statements.select');",
    "if (inheritedCapability.available !== null) throw new Error('profile capability inheritance must fail closed');",
    "const auroraProfile: DialectRegistryProduct | null = dialectRegistry.product('aurora-postgresql');",
    "if (!auroraProfile || auroraProfile.driver.routable) throw new Error('dialect registry type/runtime contract failed');",
    "const ontologyDefinition: SqlCapabilityDefinition | null = ontology.definition('statements.insert');",
    "const ontologyObservation: SqlCapabilityObservation | null = ontology.observation('postgresql', 'statements.insert');",
    "const ontologyCoverage: SqlCapabilityImplementationCoverage | null = ontology.implementation('statements.insert');",
    "const staticRuntime: SqlRuntimeCapabilityReport = sql.capabilityModel.qualify('sqlite', { version: '3.49.1' });",
    "const liveRuntime: Promise<SqlRuntimeCapabilityReport> = sql.capabilityModel.qualifyClient(sqlite);",
    "const rewritePlan: SqlRewritePlan = sql.capabilityModel.planRewrite('postgresql', 'sqlite', ['statements.insert']);",
    "const rewritten: SqlRewriteResult = sql.capabilityModel.rewriteSql('postgresql', 'sqlite', 'SELECT $1');",
    "const parsedStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'SELECT id FROM users WHERE id = $1');",
    "if (parsedStatement.type !== 'SelectStatement') throw new Error('expected select AST');",
    "const parsedAst: SqlQueryAst = parsedStatement; const ast: SqlSelectStatementAst = parsedStatement;",
    "const compiled: SqlCompiledAst = sql.capabilityModel.compileAst('mysql', ast);",
    "const transpiled: SqlStatementTranspileResult = sql.capabilityModel.transpileSql('postgresql', 'mysql', 'SELECT id FROM users WHERE id = $1');",
    "const parsedCteStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'WITH x AS (SELECT id FROM users) SELECT id FROM x');",
    "if (parsedCteStatement.type !== 'SelectStatement') throw new Error('expected CTE select AST');",
    "const cteAst: SqlSelectStatementAst = parsedCteStatement; const cteWith: SqlAstWithClause | null = cteAst.with;",
    "const queryScope: SqlStatementCompilerScope = sql.capabilityModel.analyzeAst(cteAst).scope;",
    "const derivedStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'SELECT d.id FROM (SELECT id FROM users) d');",
    "if (derivedStatement.type !== 'SelectStatement') throw new Error('expected derived-table select AST');",
    "const derivedQuery: SqlQueryAst = derivedStatement; const derived: SqlAstDerivedTable | null = derivedStatement.from && derivedStatement.from.type === 'DerivedTable' ? derivedStatement.from : null;",
    "const scalarStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'SELECT (SELECT id FROM users) AS nested');",
    "if (scalarStatement.type !== 'SelectStatement') throw new Error('expected scalar-subquery select AST');",
    "const scalar: SqlAstSubqueryExpression | null = scalarStatement.columns[0].type === 'AliasedExpression' && scalarStatement.columns[0].expression.type === 'SubqueryExpression' ? scalarStatement.columns[0].expression : null;",
    "const setStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'SELECT 1 AS n UNION SELECT 2');",
    "if (setStatement.type !== 'SetOperationStatement') throw new Error('expected set-operation AST');",
    "const setNode: SqlSetOperationStatementAst = setStatement;",
    "const wave3Statement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'SELECT CASE WHEN id > 0 THEN CAST(id AS DECIMAL(10,2)) ELSE 0 END AS v, sum(id) OVER w AS running FROM users WINDOW w AS (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)');",
    "if (wave3Statement.type !== 'SelectStatement') throw new Error('expected Wave 3 select AST');",
    "const caseNode: SqlAstCaseExpression | null = wave3Statement.columns[0].type === 'AliasedExpression' && wave3Statement.columns[0].expression.type === 'CaseExpression' ? wave3Statement.columns[0].expression : null;",
    "const castNode: SqlAstCastExpression | null = caseNode && caseNode.branches[0].then.type === 'CastExpression' ? caseNode.branches[0].then : null;",
    "const windowNode: SqlAstWindowExpression | null = wave3Statement.columns[1].type === 'AliasedExpression' && wave3Statement.columns[1].expression.type === 'WindowExpression' ? wave3Statement.columns[1].expression : null;",
    "const windowDefinitions: readonly SqlAstWindowDefinition[] = wave3Statement.windows;",
    "const insertStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'INSERT INTO users (id, name) VALUES ($1, $2) RETURNING id');",
    "if (insertStatement.type !== 'InsertStatement') throw new Error('expected INSERT AST'); const insertAst: SqlInsertStatementAst = insertStatement;",
    "const updateStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'UPDATE users SET name = $1 WHERE id = $2');",
    "if (updateStatement.type !== 'UpdateStatement') throw new Error('expected UPDATE AST'); const updateAst: SqlUpdateStatementAst = updateStatement;",
    "const deleteStatement: SqlStatementAst = sql.capabilityModel.parseSql('postgresql', 'DELETE FROM users WHERE id = $1');",
    "if (deleteStatement.type !== 'DeleteStatement') throw new Error('expected DELETE AST'); const deleteAst: SqlDeleteStatementAst = deleteStatement;",
    "const dmlScope: SqlStatementCompilerScope = sql.capabilityModel.analyzeAst(insertAst).scope;",
    "const dmlCompiled: SqlCompiledAst = sql.capabilityModel.compileAst('postgresql', insertAst);",
    "const dmlTranspiled: SqlStatementTranspileResult = sql.capabilityModel.transpileSql('mysql', 'postgresql', 'INSERT INTO users (id, name) VALUES (?, ?)');",
    "void governance; void budget; void diagnosticOptions; void diagnosticReport; void pgDiagnostic; void mysqlDiagnostic; void ontology; void ontologyDefinition; void ontologyObservation; void ontologyCoverage; void staticRuntime; void liveRuntime; void rewritePlan; void rewritten; void parsedStatement; void parsedAst; void ast; void compiled; void transpiled; void parsedCteStatement; void cteAst; void cteWith; void queryScope; void derivedStatement; void derivedQuery; void derived; void scalarStatement; void scalar; void setStatement; void setNode; void wave3Statement; void caseNode; void castNode; void windowNode; void windowDefinitions; void insertAst; void updateAst; void deleteAst; void dmlScope; void dmlCompiled; void dmlTranspiled;",
    "sqlite.transaction(async tx => { const d: 'sqlite' = tx.dialect; void d; await tx.diagnose('SELECT 1'); });",
    "sql.capabilityReport('pg').dialect satisfies 'postgresql'; sql.transactionPolicy('mssql').dialect satisfies 'sqlserver';",
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
