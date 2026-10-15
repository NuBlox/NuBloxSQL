'use strict';

var REFERENCES = Object.freeze({
  postgresql: 'https://www.postgresql.org/docs/18/sql-createtable.html',
  mysql: 'https://dev.mysql.com/doc/refman/9.7/en/create-table-foreign-keys.html',
  mysqlDifferences: 'https://dev.mysql.com/doc/refman/9.7/en/ansi-diff-foreign-keys.html',
  sqlite: 'https://www.sqlite.org/foreignkeys.html'
});

function recreate(core, model, categories) {
  return core.createModel(model.dialect, model.identity, categories, { coverage: model.coverage, evidenceRegister: model.evidenceRegister });
}
function cloneCategories(core, model) {
  var categories = {};
  core.CATEGORIES.forEach(function (category) { categories[category] = model[category]; });
  return categories;
}
function fkFeature(core, support, syntax, reference, options) {
  options = options || {};
  return core.feature(support, {
    syntax: syntax, references: reference ? [reference] : [], evidence: options.evidence || null,
    nativeName: options.nativeName || null, restrictions: options.restrictions || [], notes: options.notes || null
  });
}
function sqliteRuntime(core, syntax) {
  return fkFeature(core, 'runtime-dependent', syntax, REFERENCES.sqlite, {
    evidence: 'runtime-compile-and-connection-setting',
    restrictions: ['Foreign-key enforcement must be enabled for the connection.']
  });
}

function applyOne(core, model) {
  var dialect = model.dialect;
  var categories = cloneCategories(core, model);
  var integrity = Object.assign({}, model.integrity);
  if (dialect === 'postgresql') {
    integrity.matchSimple = fkFeature(core, 'native', 'MATCH SIMPLE', REFERENCES.postgresql);
    integrity.matchFull = fkFeature(core, 'native', 'MATCH FULL', REFERENCES.postgresql);
    integrity.matchPartial = fkFeature(core, 'unsupported', 'MATCH PARTIAL', REFERENCES.postgresql, { notes: 'PostgreSQL documents MATCH PARTIAL but does not implement it.' });
    integrity.notDeferrableForeignKeys = fkFeature(core, 'native', 'NOT DEFERRABLE', REFERENCES.postgresql);
  } else if (dialect === 'mysql') {
    integrity.matchSimple = fkFeature(core, 'equivalent', 'implicit MATCH SIMPLE semantics', REFERENCES.mysqlDifferences, { nativeName: 'implicit MATCH SIMPLE', notes: 'Explicit MATCH does not implement SQL-standard MATCH semantics and can suppress referential actions.' });
    integrity.matchFull = fkFeature(core, 'unsupported', 'MATCH FULL', REFERENCES.mysqlDifferences);
    integrity.matchPartial = fkFeature(core, 'unsupported', 'MATCH PARTIAL', REFERENCES.mysqlDifferences);
    integrity.notDeferrableForeignKeys = fkFeature(core, 'unsupported', 'NOT DEFERRABLE', REFERENCES.mysql);
    integrity.initiallyDeferred = fkFeature(core, 'unsupported', 'INITIALLY DEFERRED', REFERENCES.mysql);
    integrity.initiallyImmediate = fkFeature(core, 'unsupported', 'INITIALLY IMMEDIATE', REFERENCES.mysql);
    integrity.onDeleteSetDefault = fkFeature(core, 'unsupported', 'ON DELETE SET DEFAULT', REFERENCES.mysql);
    integrity.onUpdateSetDefault = fkFeature(core, 'unsupported', 'ON UPDATE SET DEFAULT', REFERENCES.mysql);
  } else {
    integrity.matchSimple = fkFeature(core, 'equivalent', 'implicit MATCH SIMPLE semantics', REFERENCES.sqlite, { nativeName: 'implicit MATCH SIMPLE', notes: 'SQLite parses MATCH clauses but enforces MATCH SIMPLE semantics.' });
    integrity.matchFull = fkFeature(core, 'unsupported', 'MATCH FULL', REFERENCES.sqlite);
    integrity.matchPartial = fkFeature(core, 'unsupported', 'MATCH PARTIAL', REFERENCES.sqlite);
    integrity.notDeferrableForeignKeys = sqliteRuntime(core, 'NOT DEFERRABLE');
    integrity.initiallyDeferred = sqliteRuntime(core, 'INITIALLY DEFERRED');
    integrity.initiallyImmediate = sqliteRuntime(core, 'INITIALLY IMMEDIATE');
    integrity.onDeleteNoAction = sqliteRuntime(core, 'ON DELETE NO ACTION');
    integrity.onUpdateNoAction = sqliteRuntime(core, 'ON UPDATE NO ACTION');
    integrity.onUpdateRestrict = sqliteRuntime(core, 'ON UPDATE RESTRICT');
    integrity.onUpdateSetDefault = sqliteRuntime(core, 'ON UPDATE SET DEFAULT');
  }
  categories.integrity = integrity;
  var schema = Object.assign({}, model.schema);
  var tableAlter = Object.assign({}, schema.tableAlter || {});
  tableAlter.addForeignKey = fkFeature(core, dialect === 'sqlite' ? 'unsupported' : 'native', 'ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...', dialect === 'postgresql' ? REFERENCES.postgresql : dialect === 'mysql' ? REFERENCES.mysql : REFERENCES.sqlite, dialect === 'sqlite' ? { notes: 'SQLite requires a table-rebuild strategy for standalone foreign-key addition.' } : null);
  schema.tableAlter = Object.freeze(tableAlter);
  categories.schema = schema;
  return recreate(core, model, categories);
}
function apply(core, models) {
  var result = {};
  Object.keys(models).forEach(function (dialect) { result[dialect] = applyOne(core, models[dialect]); });
  return Object.freeze(result);
}
exports.apply = apply;
exports.REFERENCES = REFERENCES;
