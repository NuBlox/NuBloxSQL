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
    syntax.mysqlMutationTargetAlias=feature(core,'unsupported','MySQL mutation target alias family',[]);
    syntax.mysqlUpdateLowPriority=feature(core,'unsupported','MySQL UPDATE LOW_PRIORITY',[]);
    syntax.mysqlUpdateIgnore=feature(core,'unsupported','MySQL UPDATE IGNORE',[]);
    syntax.mysqlDeleteLowPriority=feature(core,'unsupported','MySQL DELETE LOW_PRIORITY',[]);
    syntax.mysqlDeleteQuick=feature(core,'unsupported','MySQL DELETE QUICK',[]);
    syntax.mysqlDeleteIgnore=feature(core,'unsupported','MySQL DELETE IGNORE',[]);
    syntax.mysqlUpdateOrderBy=feature(core,'unsupported','MySQL single-table UPDATE ORDER BY',[]);
    syntax.mysqlUpdateLimit=feature(core,'unsupported','MySQL single-table UPDATE LIMIT',[]);
    syntax.mysqlDeleteOrderBy=feature(core,'unsupported','MySQL single-table DELETE ORDER BY',[]);
    syntax.mysqlDeleteLimit=feature(core,'unsupported','MySQL single-table DELETE LIMIT',[]);
  }else if(dialect==='sqlite'){
    syntax.updateFrom=feature(core,'runtime-dependent','UPDATE ... SET ... FROM ... WHERE ...',[REFERENCES.sqliteUpdate],{since:'3.33.0',evidence:'runtime-version'});
    syntax.deleteUsing=feature(core,'unsupported','DELETE ... USING ...',[]);
    syntax.multiTableUpdate=feature(core,'unsupported','MySQL multi-table UPDATE semantic family',[]);
    syntax.multiTableDelete=feature(core,'unsupported','MySQL multi-table DELETE semantic family',[]);
    syntax.mysqlMutationTargetAlias=feature(core,'unsupported','MySQL mutation target alias family',[]);
    syntax.mysqlUpdateLowPriority=feature(core,'unsupported','MySQL UPDATE LOW_PRIORITY',[]);
    syntax.mysqlUpdateIgnore=feature(core,'unsupported','MySQL UPDATE IGNORE',[]);
    syntax.mysqlDeleteLowPriority=feature(core,'unsupported','MySQL DELETE LOW_PRIORITY',[]);
    syntax.mysqlDeleteQuick=feature(core,'unsupported','MySQL DELETE QUICK',[]);
    syntax.mysqlDeleteIgnore=feature(core,'unsupported','MySQL DELETE IGNORE',[]);
    syntax.mysqlUpdateOrderBy=feature(core,'unsupported','MySQL single-table UPDATE ORDER BY',[]);
    syntax.mysqlUpdateLimit=feature(core,'unsupported','MySQL single-table UPDATE LIMIT',[]);
    syntax.mysqlDeleteOrderBy=feature(core,'unsupported','MySQL single-table DELETE ORDER BY',[]);
    syntax.mysqlDeleteLimit=feature(core,'unsupported','MySQL single-table DELETE LIMIT',[]);
  }else{
    syntax.updateFrom=feature(core,'unsupported','PostgreSQL/SQLite UPDATE ... FROM semantic family',[REFERENCES.mysqlUpdate],{notes:'MySQL multi-table UPDATE uses a different grammar and is modeled separately.'});
    syntax.deleteUsing=feature(core,'unsupported','PostgreSQL DELETE ... USING semantic family',[REFERENCES.mysqlDelete],{notes:'MySQL multi-table DELETE uses a different grammar and is modeled separately.'});
    syntax.multiTableUpdate=feature(core,'native','UPDATE table_references SET ...',[REFERENCES.mysqlUpdate]);
    syntax.multiTableDelete=feature(core,'native','DELETE ... FROM/USING table_references ...',[REFERENCES.mysqlDelete]);
    syntax.mysqlMutationTargetAlias=feature(core,'native','single-table mutation target aliases',[REFERENCES.mysqlUpdate,REFERENCES.mysqlDelete]);
    syntax.mysqlUpdateLowPriority=feature(core,'native','UPDATE LOW_PRIORITY ...',[REFERENCES.mysqlUpdate],{notes:'Only affects storage engines using table-level locking.'});
    syntax.mysqlUpdateIgnore=feature(core,'native','UPDATE IGNORE ...',[REFERENCES.mysqlUpdate]);
    syntax.mysqlDeleteLowPriority=feature(core,'native','DELETE LOW_PRIORITY ...',[REFERENCES.mysqlDelete],{notes:'Only affects storage engines using table-level locking.'});
    syntax.mysqlDeleteQuick=feature(core,'native','DELETE QUICK ...',[REFERENCES.mysqlDelete],{notes:'MyISAM-specific index-leaf behavior.'});
    syntax.mysqlDeleteIgnore=feature(core,'native','DELETE IGNORE ...',[REFERENCES.mysqlDelete]);
    syntax.mysqlUpdateOrderBy=feature(core,'native','single-table UPDATE ... ORDER BY ...',[REFERENCES.mysqlUpdate],{restrictions:['Not valid for multiple-table UPDATE.']});
    syntax.mysqlUpdateLimit=feature(core,'native','single-table UPDATE ... LIMIT row_count',[REFERENCES.mysqlUpdate],{restrictions:['Not valid for multiple-table UPDATE.']});
    syntax.mysqlDeleteOrderBy=feature(core,'native','single-table DELETE ... ORDER BY ...',[REFERENCES.mysqlDelete],{restrictions:['Not valid for multiple-table DELETE.']});
    syntax.mysqlDeleteLimit=feature(core,'native','single-table DELETE ... LIMIT row_count',[REFERENCES.mysqlDelete],{restrictions:['Not valid for multiple-table DELETE.']});
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
