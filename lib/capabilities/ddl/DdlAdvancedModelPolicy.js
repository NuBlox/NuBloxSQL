'use strict';

var REFERENCES = Object.freeze({
  createIndex: 'https://www.postgresql.org/docs/18/sql-createindex.html',
  dropIndex: 'https://www.postgresql.org/docs/18/sql-dropindex.html',
  dropTable: 'https://www.postgresql.org/docs/18/sql-droptable.html',
  dropView: 'https://www.postgresql.org/docs/18/sql-dropview.html',
  dropSchema: 'https://www.postgresql.org/docs/18/sql-dropschema.html',
  dropSequence: 'https://www.postgresql.org/docs/18/sql-dropsequence.html'
});

function recreate(core, model, categories) {
  return core.createModel(model.dialect, model.identity, categories, { coverage: model.coverage, evidenceRegister: model.evidenceRegister });
}
function cloneCategories(core, model) {
  var categories = {};
  core.CATEGORIES.forEach(function (category) { categories[category] = model[category]; });
  return categories;
}
function feature(core, dialect, support, syntax, references, notes) {
  return core.feature(support, {
    syntax: syntax,
    references: references || [],
    notes: notes || null
  });
}
function applyOne(core, model) {
  var dialect = model.dialect;
  var categories = cloneCategories(core, model);
  var schema = Object.assign({}, model.schema);
  if (!schema.concurrentIndexBuild) {
    schema.concurrentIndexBuild = feature(core, dialect, dialect === 'postgresql' ? 'native' : 'unsupported', 'CREATE INDEX CONCURRENTLY', dialect === 'postgresql' ? [REFERENCES.createIndex] : []);
  }
  schema.concurrentIndexDrop = feature(core, dialect, dialect === 'postgresql' ? 'native' : 'unsupported', 'DROP INDEX CONCURRENTLY', dialect === 'postgresql' ? [REFERENCES.dropIndex] : [], dialect === 'postgresql' ? 'PostgreSQL concurrent index removal; cannot be combined with CASCADE in NuBloxSQL ddl-v5.' : 'PostgreSQL-specific concurrent index lifecycle capability.');
  categories.schema = schema;

  var syntax = Object.assign({}, model.syntax);
  syntax.dropDependency = Object.freeze({
    cascade: feature(core, dialect, dialect === 'postgresql' ? 'native' : 'unsupported', 'DROP ... CASCADE', dialect === 'postgresql' ? [REFERENCES.dropTable, REFERENCES.dropView, REFERENCES.dropIndex, REFERENCES.dropSchema, REFERENCES.dropSequence] : [], 'NuBloxSQL ddl-v5 models explicit PostgreSQL dependency semantics only; it does not treat vendor compatibility keywords as equivalent.'),
    restrict: feature(core, dialect, dialect === 'postgresql' ? 'native' : 'unsupported', 'DROP ... RESTRICT', dialect === 'postgresql' ? [REFERENCES.dropTable, REFERENCES.dropView, REFERENCES.dropIndex, REFERENCES.dropSchema, REFERENCES.dropSequence] : [], 'Explicit PostgreSQL RESTRICT dependency behavior.')
  });
  categories.syntax = syntax;
  return recreate(core, model, categories);
}
function apply(core, models) {
  var result = {};
  Object.keys(models).forEach(function (dialect) { result[dialect] = applyOne(core, models[dialect]); });
  return Object.freeze(result);
}

exports.apply = apply;
exports.REFERENCES = REFERENCES;
