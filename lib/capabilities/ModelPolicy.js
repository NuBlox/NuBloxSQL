'use strict';

var DROP_VIEW_REFERENCES = Object.freeze({
  postgresql: 'https://www.postgresql.org/docs/18/sql-dropview.html',
  mysql: 'https://dev.mysql.com/doc/refman/9.7/en/drop-view.html'
});

var ALTER_TABLE_REFERENCES = Object.freeze({
  postgresql: 'https://www.postgresql.org/docs/18/sql-altertable.html',
  mysql: 'https://dev.mysql.com/doc/refman/9.7/en/alter-table.html',
  sqlite: 'https://www.sqlite.org/lang_altertable.html'
});

function recreate(core, model, categories) {
  return core.createModel(model.dialect, model.identity, categories, {
    coverage: model.coverage,
    evidenceRegister: model.evidenceRegister
  });
}

function cloneCategories(core, model) {
  var categories = {};
  core.CATEGORIES.forEach(function (category) { categories[category] = model[category]; });
  return categories;
}

function withDropView(core, model) {
  if (!model || !DROP_VIEW_REFERENCES[model.dialect] || model.statements.dropView) return model;
  var categories = cloneCategories(core, model);
  categories.statements = Object.assign({}, model.statements, {
    dropView: core.feature('native', {
      syntax: 'DROP VIEW',
      references: [DROP_VIEW_REFERENCES[model.dialect]],
      notes: 'Capability observation completed by the Wave 5 DDL compiler qualification.'
    })
  });
  return recreate(core, model, categories);
}

function alterFeature(core, dialect, operation) {
  var reference = ALTER_TABLE_REFERENCES[dialect];
  var options = { references: [reference] };
  if (operation === 'addColumn') options.syntax = 'ALTER TABLE ... ADD COLUMN ...';
  if (operation === 'dropColumn') options.syntax = 'ALTER TABLE ... DROP COLUMN ...';
  if (operation === 'renameColumn') options.syntax = 'ALTER TABLE ... RENAME COLUMN ... TO ...';
  if (operation === 'renameTable') options.syntax = 'ALTER TABLE ... RENAME TO ...';
  if (dialect === 'sqlite' && operation === 'renameColumn') options.since = '3.25.0';
  if (dialect === 'sqlite' && operation === 'dropColumn') options.since = '3.35.0';
  return core.feature('native', options);
}

function withAtomicAlterTable(core, model) {
  if (!model || !ALTER_TABLE_REFERENCES[model.dialect]) return model;
  var categories = cloneCategories(core, model);
  var schema = Object.assign({}, model.schema);
  schema.tableAlter = Object.freeze({
    addColumn: alterFeature(core, model.dialect, 'addColumn'),
    dropColumn: alterFeature(core, model.dialect, 'dropColumn'),
    renameColumn: alterFeature(core, model.dialect, 'renameColumn'),
    renameTable: alterFeature(core, model.dialect, 'renameTable')
  });
  categories.schema = schema;
  return recreate(core, model, categories);
}

function apply(core, models) {
  var result = {};
  Object.keys(models).forEach(function (dialect) {
    var model = withDropView(core, models[dialect]);
    model = withAtomicAlterTable(core, model);
    result[dialect] = model;
  });
  return Object.freeze(result);
}

exports.apply = apply;
exports.DROP_VIEW_REFERENCES = DROP_VIEW_REFERENCES;
exports.ALTER_TABLE_REFERENCES = ALTER_TABLE_REFERENCES;
