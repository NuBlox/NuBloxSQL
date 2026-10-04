'use strict';

var REFERENCES = Object.freeze({
  postgresqlSequence: 'https://www.postgresql.org/docs/18/sql-createsequence.html',
  postgresqlIdentity: 'https://www.postgresql.org/docs/18/ddl-identity-columns.html',
  mysqlAutoIncrement: 'https://dev.mysql.com/doc/refman/9.7/en/example-auto-increment.html',
  sqliteAutoIncrement: 'https://www.sqlite.org/autoinc.html'
});

function recreate(core, model, categories) {
  return core.createModel(model.dialect, model.identity, categories, { coverage: model.coverage, evidenceRegister: model.evidenceRegister });
}
function cloneCategories(core, model) {
  var categories = {};
  core.CATEGORIES.forEach(function (category) { categories[category] = model[category]; });
  return categories;
}
function feature(core, support, syntax, refs, notes) {
  return core.feature(support, { syntax: syntax, references: refs || [], notes: notes || null });
}
function applyOne(core, model) {
  var dialect = model.dialect;
  var categories = cloneCategories(core, model);
  var schema = Object.assign({}, model.schema);
  var pg = dialect === 'postgresql';
  schema.sequenceOptions = Object.freeze({
    start: feature(core, pg ? 'native' : 'unsupported', 'START [WITH] value', pg ? [REFERENCES.postgresqlSequence] : []),
    increment: feature(core, pg ? 'native' : 'unsupported', 'INCREMENT [BY] value', pg ? [REFERENCES.postgresqlSequence] : []),
    minValue: feature(core, pg ? 'native' : 'unsupported', 'MINVALUE value | NO MINVALUE', pg ? [REFERENCES.postgresqlSequence] : []),
    maxValue: feature(core, pg ? 'native' : 'unsupported', 'MAXVALUE value | NO MAXVALUE', pg ? [REFERENCES.postgresqlSequence] : []),
    cache: feature(core, pg ? 'native' : 'unsupported', 'CACHE value', pg ? [REFERENCES.postgresqlSequence] : []),
    cycle: feature(core, pg ? 'native' : 'unsupported', 'CYCLE | NO CYCLE', pg ? [REFERENCES.postgresqlSequence] : [])
  });
  categories.schema = schema;

  var integrity = Object.assign({}, model.integrity);
  integrity.mysqlAutoIncrement = feature(core, dialect === 'mysql' ? 'native' : 'unsupported', 'AUTO_INCREMENT', dialect === 'mysql' ? [REFERENCES.mysqlAutoIncrement] : [], 'MySQL allocation semantics are not SQL-standard identity semantics.');
  integrity.sqliteRowidAutoIncrement = feature(core, dialect === 'sqlite' ? 'native' : 'unsupported', 'INTEGER PRIMARY KEY AUTOINCREMENT', dialect === 'sqlite' ? [REFERENCES.sqliteAutoIncrement] : [], 'SQLite AUTOINCREMENT changes ROWID allocation and is intentionally distinct from SQL-standard identity.');
  integrity.identitySequenceOptions = feature(core, pg ? 'native' : 'unsupported', 'GENERATED ... AS IDENTITY (sequence_options)', pg ? [REFERENCES.postgresqlIdentity, REFERENCES.postgresqlSequence] : []);
  categories.integrity = integrity;
  return recreate(core, model, categories);
}
function apply(core, models) {
  var result = {};
  Object.keys(models).forEach(function (dialect) { result[dialect] = applyOne(core, models[dialect]); });
  return Object.freeze(result);
}
exports.apply = apply;
exports.REFERENCES = REFERENCES;
