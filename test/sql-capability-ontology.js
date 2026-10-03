'use strict';

var assert = require('assert');
var sql = require('..');

var ontology = sql.capabilityOntology;

assert.ok(ontology, 'root capability ontology export missing');
assert.strictEqual(ontology, sql.capabilityModel.ontology);
assert.strictEqual(sql.SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION, 1);
assert.strictEqual(ontology.schemaVersion, 1);
assert.ok(ontology.supportLevels.indexOf('native') >= 0);
assert.ok(ontology.supportLevels.indexOf('emulated') >= 0);
assert.ok(ontology.availabilityKinds.indexOf('version-dependent') >= 0);
assert.ok(ontology.availabilityKinds.indexOf('connector-dependent') >= 0);
assert.ok(ontology.maturityLevels.indexOf('preview') >= 0);
assert.ok(ontology.implementationLevels.indexOf('implemented') >= 0);

var validation = ontology.validate();
assert.strictEqual(validation.valid, true);
assert.ok(validation.definitions >= 150, 'ontology should expose the existing exhaustive Tier-1 feature inventory');
assert.ok(validation.observations >= validation.definitions, 'every ontology definition must originate from at least one engine observation');

var ids = ontology.ids();
assert.ok(Object.isFrozen(ids));
assert.ok(ids.indexOf('queries.joins.inner') >= 0);
assert.ok(ids.indexOf('queries.cte.recursive') >= 0);
assert.ok(ids.indexOf('queries.setOperators.union') >= 0);
assert.ok(ids.indexOf('queries.windows.rows') >= 0);
assert.ok(ids.indexOf('expressions.caseExpression') >= 0);
assert.ok(ids.indexOf('expressions.cast') >= 0);
assert.ok(ids.indexOf('schema.materializedView') >= 0);
assert.ok(ids.indexOf('security.rowLevelSecurity') >= 0);
assert.ok(ids.indexOf('transactions.savepoints') >= 0 || ids.indexOf('statements.savepoint') >= 0);

var lateralDefinition = ontology.definition('queries.joins.lateral');
assert.strictEqual(lateralDefinition.id, 'queries.joins.lateral');
assert.strictEqual(lateralDefinition.family, 'queries');
assert.strictEqual(lateralDefinition.kind, 'semantic');
assert.ok(['common', 'standard', 'vendor-extension', 'vendor-specific'].indexOf(lateralDefinition.portability) >= 0);
assert.ok(Object.isFrozen(lateralDefinition));

var pgLateral = ontology.observation('postgresql', 'queries.joins.lateral');
assert.strictEqual(pgLateral.support, 'native');
assert.strictEqual(pgLateral.maturity, 'stable');
assert.ok(pgLateral.evidence.documentation.length > 0);
assert.strictEqual(pgLateral.legacy.support, 'native');

var mysqlLateral = ontology.observation('mysql', 'queries.joins.lateral');
assert.strictEqual(mysqlLateral.support, 'native');
assert.strictEqual(mysqlLateral.since, '8.0.14');
assert.strictEqual(mysqlLateral.availability.kind, 'version-dependent');
assert.strictEqual(ontology.resolve('mysql', 'queries.joins.lateral', { version: '8.0.13' }).available, false);
assert.strictEqual(ontology.resolve('mysql', 'queries.joins.lateral', { version: '8.0.14' }).available, true);
assert.strictEqual(ontology.resolve('mysql', 'queries.joins.lateral', { version: '9.7' }).available, true);

var sqliteRight = ontology.observation('sqlite', 'queries.joins.right');
assert.strictEqual(sqliteRight.support, 'native');
assert.strictEqual(sqliteRight.legacy.support, 'runtime-dependent');
assert.strictEqual(sqliteRight.availability.kind, 'version-dependent');
assert.strictEqual(ontology.resolve('sqlite', 'queries.joins.right', { version: '3.38.5' }).available, false);
assert.strictEqual(ontology.resolve('sqlite', 'queries.joins.right', { version: '3.39.0' }).available, true);

var mysqlBoolean = ontology.observation('mysql', 'types.boolean');
assert.strictEqual(mysqlBoolean.support, 'native');
assert.strictEqual(mysqlBoolean.semantics.equivalent, true);
assert.strictEqual(mysqlBoolean.legacy.support, 'equivalent');

var sqliteUsers = ontology.observation('sqlite', 'security.usersAndRoles');
assert.strictEqual(sqliteUsers.support, 'not-applicable');
assert.strictEqual(ontology.resolve('sqlite', 'security.usersAndRoles').available, false);

var recursive = ontology.definition('queries.cte.recursive');
assert.deepStrictEqual(Array.from(recursive.relationships.requires), ['queries.cte.ordinary']);
var search = ontology.definition('queries.cte.search');
assert.deepStrictEqual(Array.from(search.relationships.requires), ['queries.cte.recursive']);
assert.deepStrictEqual(Array.from(ontology.definition('queries.setOperators.unionAll').relationships.requires), ['queries.setOperators.union']);
assert.deepStrictEqual(Array.from(ontology.definition('queries.setOperators.intersectAll').relationships.requires), ['queries.setOperators.intersect']);
assert.deepStrictEqual(Array.from(ontology.definition('queries.setOperators.exceptAll').relationships.requires), ['queries.setOperators.except']);
assert.deepStrictEqual(Array.from(ontology.definition('queries.windows.rows').relationships.requires), ['queries.windows.supported']);

var implemented = ontology.implementation('statements.select');
assert.strictEqual(implemented.scope, 'select-foundation-v1');
assert.strictEqual(implemented.stages.parser, 'implemented');
assert.strictEqual(implemented.stages.ast, 'implemented');
assert.strictEqual(implemented.stages.validator, 'partial');
assert.strictEqual(implemented.stages.renderer, 'implemented');
assert.strictEqual(implemented.stages.rewrite, 'partial');
assert.strictEqual(implemented.qualified, true);

[
  'queries.cte.ordinary',
  'queries.cte.recursive',
  'queries.subqueries.scalar',
  'queries.subqueries.correlated',
  'queries.subqueries.exists',
  'queries.subqueries.in',
  'queries.subqueries.derivedTables'
].forEach(function (path) {
  var queryWave = ontology.implementation(path);
  assert.strictEqual(queryWave.scope, 'select-query-v2', path + ' scope');
  assert.strictEqual(queryWave.stages.parser, 'implemented', path + ' parser');
  assert.strictEqual(queryWave.stages.ast, 'implemented', path + ' ast');
  assert.strictEqual(queryWave.stages.validator, 'partial', path + ' validator');
  assert.strictEqual(queryWave.stages.renderer, 'implemented', path + ' renderer');
  assert.strictEqual(queryWave.stages.rewrite, 'partial', path + ' rewrite');
  assert.strictEqual(queryWave.qualified, true, path + ' qualification');
});

[
  'queries.setOperators.union',
  'queries.setOperators.unionAll',
  'queries.setOperators.intersect',
  'queries.setOperators.intersectAll',
  'queries.setOperators.except',
  'queries.setOperators.exceptAll'
].forEach(function (path) {
  var setWave = ontology.implementation(path);
  assert.strictEqual(setWave.scope, 'select-query-v3', path + ' scope');
  assert.strictEqual(setWave.stages.parser, 'implemented', path + ' parser');
  assert.strictEqual(setWave.stages.ast, 'implemented', path + ' ast');
  assert.strictEqual(setWave.stages.validator, 'partial', path + ' validator');
  assert.strictEqual(setWave.stages.renderer, 'implemented', path + ' renderer');
  assert.strictEqual(setWave.stages.rewrite, 'partial', path + ' rewrite');
  assert.strictEqual(setWave.qualified, true, path + ' qualification');
  assert.ok(setWave.evidence.indexOf('test/compiler-query-live.js') >= 0, path + ' live evidence');
});

[
  'expressions.caseExpression',
  'expressions.cast',
  'queries.windows.supported',
  'queries.windows.named',
  'queries.windows.rows',
  'queries.windows.range',
  'queries.windows.groups',
  'queries.windows.exclude'
].forEach(function (path) {
  var expressionWave = ontology.implementation(path);
  assert.strictEqual(expressionWave.scope, 'select-query-v4', path + ' scope');
  assert.strictEqual(expressionWave.stages.parser, 'implemented', path + ' parser');
  assert.strictEqual(expressionWave.stages.ast, 'implemented', path + ' ast');
  assert.strictEqual(expressionWave.stages.validator, 'partial', path + ' validator');
  assert.strictEqual(expressionWave.stages.renderer, 'implemented', path + ' renderer');
  assert.strictEqual(expressionWave.stages.rewrite, 'partial', path + ' rewrite');
  assert.strictEqual(expressionWave.qualified, true, path + ' qualification');
  assert.ok(expressionWave.evidence.indexOf('test/compiler-query-live.js') >= 0, path + ' live evidence');
});

var sqliteIntersectAll = ontology.observation('sqlite', 'queries.setOperators.intersectAll');
assert.strictEqual(sqliteIntersectAll.support, 'unsupported');
assert.strictEqual(ontology.resolve('sqlite', 'queries.setOperators.intersectAll').available, false);

var mysqlGroups = ontology.observation('mysql', 'queries.windows.groups');
assert.strictEqual(mysqlGroups.support, 'unsupported');
assert.strictEqual(ontology.resolve('mysql', 'queries.windows.groups').available, false);

var sqliteRows = ontology.observation('sqlite', 'queries.windows.rows');
assert.strictEqual(sqliteRows.legacy.support, 'runtime-dependent');

['postgresql', 'mysql', 'sqlite'].forEach(function (dialect) {
  var profile = ontology.profile(dialect);
  assert.strictEqual(profile.dialect, dialect);
  assert.ok(profile.summary.total >= 100, dialect + ' ontology profile should retain substantial exhaustive coverage');
  assert.ok(profile.summary.native > 0, dialect + ' ontology profile should retain native capabilities');
  assert.strictEqual(profile.observations.length, profile.summary.total);
  assert.ok(Object.isFrozen(profile));
});

var postgresProfile = ontology.profile('pg');
assert.strictEqual(postgresProfile.dialect, 'postgresql');

var semanticInventory = ontology.inventory({ dialect: 'postgresql', kind: 'semantic' });
assert.ok(semanticInventory.length > 0);
assert.ok(semanticInventory.every(function (entry) { return entry.definition.kind === 'semantic'; }));
assert.ok(semanticInventory.every(function (entry) { return entry.observation === null || entry.observation.subject.dialect === 'postgresql'; }));

assert.strictEqual(ontology.definition('not.real'), null);
assert.strictEqual(ontology.implementation('not.real'), null);
assert.strictEqual(ontology.observation('postgresql', 'not.real'), null);
assert.throws(function () { ontology.definition(''); }, /non-empty string/);
assert.throws(function () { ontology.ids({ kind: 'made-up' }); }, /Unknown SQL capability kind/);

console.log('NuBloxSQL executable SQL capability ontology: PASS (' + validation.definitions + ' definitions, ' + validation.observations + ' observations)');
