'use strict';

var REFERENCES = Object.freeze({
  postgresql: 'https://www.postgresql.org/docs/18/sql-createindex.html',
  mysql: 'https://dev.mysql.com/doc/refman/9.7/en/create-index.html',
  sqlite: 'https://www.sqlite.org/lang_createindex.html'
});

function recreate(core, model, categories) {
  return core.createModel(model.dialect, model.identity, categories, { coverage:model.coverage, evidenceRegister:model.evidenceRegister });
}
function cloneCategories(core, model) {
  var categories={}; core.CATEGORIES.forEach(function(category){ categories[category]=model[category]; }); return categories;
}
function feature(core, support, syntax, reference, options) {
  options=options||{};
  return core.feature(support,{syntax:syntax,references:reference?[reference]:[],nativeName:options.nativeName||null,restrictions:options.restrictions||[],notes:options.notes||null});
}
function applyOne(core, model) {
  var dialect=model.dialect;
  var categories=cloneCategories(core,model);
  var schema=Object.assign({},model.schema);
  schema.indexAccessMethod = feature(core,dialect==='postgresql'?'native':'unsupported','CREATE INDEX ... USING <method> ...',REFERENCES[dialect],{
    restrictions:dialect==='postgresql'?['ddl-v8 qualifies built-in btree, hash, gist, spgist, gin and brin access methods only.']:[],
    notes:dialect==='postgresql'?'User-defined access methods require catalog-aware qualification and are outside ddl-v8.':'PostgreSQL-specific index access-method syntax.'
  });
  categories.schema=schema;
  return recreate(core,model,categories);
}
function apply(core,models){var result={};Object.keys(models).forEach(function(d){result[d]=applyOne(core,models[d]);});return Object.freeze(result);}
exports.apply=apply; exports.REFERENCES=REFERENCES;
