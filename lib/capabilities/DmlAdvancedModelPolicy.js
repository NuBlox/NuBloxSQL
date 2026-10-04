'use strict';

var REFERENCES = Object.freeze({
  postgresqlUpdate: 'https://www.postgresql.org/docs/18/sql-update.html',
  postgresqlDelete: 'https://www.postgresql.org/docs/18/sql-delete.html',
  sqliteUpdate: 'https://www.sqlite.org/lang_update.html',
  mysqlUpdate: 'https://dev.mysql.com/doc/refman/9.7/en/update.html',
  mysqlDelete: 'https://dev.mysql.com/doc/refman/9.7/en/delete.html'
});

function recreate(core, model, categories) {
  return core.createModel(model.dialect, model.identity, categories, { coverage:model.coverage, evidenceRegister:model.evidenceRegister });
}
function cloneCategories(core, model) {
  var categories={};
  core.CATEGORIES.forEach(function(category){categories[category]=model[category];});
  return categories;
}
function feature(core,support,syntax,refs,extra){
  return core.feature(support,Object.assign({syntax:syntax,references:refs||[]},extra||{}));
}
function applyOne(core,model){
  var dialect=model.dialect;
  var categories=cloneCategories(core,model);
  var syntax=Object.assign({},model.syntax);
  if(dialect==='postgresql'){
    syntax.updateFrom=feature(core,'native','UPDATE ... SET ... FROM ... WHERE ...',[REFERENCES.postgresqlUpdate]);
    syntax.deleteUsing=feature(core,'native','DELETE FROM ... USING ... WHERE ...',[REFERENCES.postgresqlDelete]);
    syntax.multiTableUpdate=feature(core,'unsupported','MySQL multi-table UPDATE semantic family',[]);
    syntax.multiTableDelete=feature(core,'unsupported','MySQL multi-table DELETE semantic family',[]);
  }else if(dialect==='sqlite'){
    syntax.updateFrom=feature(core,'runtime-dependent','UPDATE ... SET ... FROM ... WHERE ...',[REFERENCES.sqliteUpdate],{since:'3.33.0',evidence:'runtime-version'});
    syntax.deleteUsing=feature(core,'unsupported','DELETE ... USING ...',[]);
    syntax.multiTableUpdate=feature(core,'unsupported','MySQL multi-table UPDATE semantic family',[]);
    syntax.multiTableDelete=feature(core,'unsupported','MySQL multi-table DELETE semantic family',[]);
  }else{
    syntax.updateFrom=feature(core,'unsupported','PostgreSQL/SQLite UPDATE ... FROM semantic family',[REFERENCES.mysqlUpdate],{notes:'MySQL multi-table UPDATE uses a different grammar and is modeled separately.'});
    syntax.deleteUsing=feature(core,'unsupported','PostgreSQL DELETE ... USING semantic family',[REFERENCES.mysqlDelete],{notes:'MySQL multi-table DELETE uses a different grammar and is modeled separately.'});
    syntax.multiTableUpdate=feature(core,'native','UPDATE table_references SET ...',[REFERENCES.mysqlUpdate]);
    syntax.multiTableDelete=feature(core,'native','DELETE ... FROM/USING table_references ...',[REFERENCES.mysqlDelete]);
  }
  categories.syntax=syntax;
  return recreate(core,model,categories);
}
function apply(core,models){
  var result={};
  Object.keys(models).forEach(function(dialect){result[dialect]=applyOne(core,models[dialect]);});
  return Object.freeze(result);
}
exports.apply=apply;
exports.REFERENCES=REFERENCES;
