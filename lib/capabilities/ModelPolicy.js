'use strict';

var DROP_VIEW_REFERENCES = Object.freeze({
  postgresql: 'https://www.postgresql.org/docs/18/sql-dropview.html',
  mysql: 'https://dev.mysql.com/doc/refman/9.7/en/drop-view.html'
});

function withDropView(core, model) {
  if (!model || !DROP_VIEW_REFERENCES[model.dialect] || model.statements.dropView) return model;
  var categories = {};
  core.CATEGORIES.forEach(function (category) { categories[category] = model[category]; });
  categories.statements = Object.assign({}, model.statements, {
    dropView: core.feature('native', {
      syntax: 'DROP VIEW',
      references: [DROP_VIEW_REFERENCES[model.dialect]],
      notes: 'Capability observation completed by the Wave 5 DDL compiler qualification.'
    })
  });
  return core.createModel(model.dialect, model.identity, categories, {
    coverage: model.coverage,
    evidenceRegister: model.evidenceRegister
  });
}

function apply(core, models) {
  var result = {};
  Object.keys(models).forEach(function (dialect) { result[dialect] = withDropView(core, models[dialect]); });
  return Object.freeze(result);
}

exports.apply = apply;
exports.DROP_VIEW_REFERENCES = DROP_VIEW_REFERENCES;
