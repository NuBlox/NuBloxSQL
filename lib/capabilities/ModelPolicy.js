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

  if (dialect === 'sqlite' && operation === 'renameColumn') {
    options.since = '3.25.0';
    options.evidence = 'runtime-version';
    return core.feature('runtime-dependent', options);
  }
  if (dialect === 'sqlite' && operation === 'dropColumn') {
    options.since = '3.35.0';
    options.evidence = 'runtime-version';
    return core.feature('runtime-dependent', options);
  }
  return core.feature('native', options);
}

function lifecycleFeature(core, dialect, operation) {
  var reference = ALTER_TABLE_REFERENCES[dialect];
  var syntax = {
    alterColumnType: 'ALTER TABLE ... ALTER COLUMN ... TYPE ...',
    setDefault: 'ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...',
    dropDefault: 'ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT',
    setNotNull: 'ALTER TABLE ... ALTER COLUMN ... SET NOT NULL',
    dropNotNull: 'ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL',
    addConstraint: 'ALTER TABLE ... ADD CONSTRAINT ...',
    dropConstraint: 'ALTER TABLE ... DROP CONSTRAINT ...'
  }[operation];
  var options = { references: [reference], syntax: syntax };

  if (dialect === 'postgresql') return core.feature('native', options);
  if (dialect === 'sqlite') return core.feature('unsupported', options);

  if (operation === 'setDefault' || operation === 'dropDefault') return core.feature('native', options);
  if (operation === 'alterColumnType') {
    options.nativeName = 'MODIFY COLUMN / CHANGE COLUMN';
    options.notes = 'MySQL requires the complete target column definition; automatic lowering needs metadata and is not lossless from a PostgreSQL ALTER TYPE AST alone.';
    return core.feature('equivalent', options);
  }
  if (operation === 'setNotNull' || operation === 'dropNotNull') {
    options.nativeName = 'MODIFY COLUMN';
    options.notes = 'MySQL nullability changes require a complete column definition and therefore explicit semantic lowering.';
    return core.feature('equivalent', options);
  }
  options.notes = 'MySQL constraint lifecycle syntax varies by constraint kind; NuBloxSQL does not treat generic PostgreSQL constraint lifecycle as losslessly equivalent.';
  return core.feature('partial', options);
}

function withAtomicAlterTable(core, model) {
  if (!model || !ALTER_TABLE_REFERENCES[model.dialect]) return model;
  var categories = cloneCategories(core, model);
  var schema = Object.assign({}, model.schema);
  schema.tableAlter = Object.freeze({
    addColumn: alterFeature(core, model.dialect, 'addColumn'),
    dropColumn: alterFeature(core, model.dialect, 'dropColumn'),
    renameColumn: alterFeature(core, model.dialect, 'renameColumn'),
    renameTable: alterFeature(core, model.dialect, 'renameTable'),
    alterColumnType: lifecycleFeature(core, model.dialect, 'alterColumnType'),
    setDefault: lifecycleFeature(core, model.dialect, 'setDefault'),
    dropDefault: lifecycleFeature(core, model.dialect, 'dropDefault'),
    setNotNull: lifecycleFeature(core, model.dialect, 'setNotNull'),
    dropNotNull: lifecycleFeature(core, model.dialect, 'dropNotNull'),
    addConstraint: lifecycleFeature(core, model.dialect, 'addConstraint'),
    dropConstraint: lifecycleFeature(core, model.dialect, 'dropConstraint')
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
