'use strict';

var REFERENCES=Object.freeze({
  postgresqlMerge:'https://www.postgresql.org/docs/18/sql-merge.html'
});
function recreate(core,model,categories){
  return core.createModel(model.dialect,model.identity,categories,{coverage:model.coverage,evidenceRegister:model.evidenceRegister});
}
function cloneCategories(core,model){
  var categories={};
  core.CATEGORIES.forEach(function(category){categories[category]=model[category];});
  return categories;
}
function feature(core,support,syntax,refs,extra){
  return core.feature(support,Object.assign({syntax:syntax,references:refs||[]},extra||{}));
}
function applyOne(core,model){
  var categories=cloneCategories(core,model);
  var syntax=Object.assign({},model.syntax);
  if(model.dialect==='postgresql'){
    syntax.mergeMultipleWhen=feature(core,'native','MERGE ... WHEN ... WHEN ...',[REFERENCES.postgresqlMerge],{since:'15'});
    syntax.mergeActionCondition=feature(core,'native','WHEN ... AND condition THEN ...',[REFERENCES.postgresqlMerge],{since:'15'});
    syntax.mergeDoNothing=feature(core,'native','WHEN ... THEN DO NOTHING',[REFERENCES.postgresqlMerge],{since:'15'});
  }else{
    syntax.mergeMultipleWhen=feature(core,'unsupported','PostgreSQL MERGE action-chain semantic family',[]);
    syntax.mergeActionCondition=feature(core,'unsupported','PostgreSQL MERGE action predicate semantic family',[]);
    syntax.mergeDoNothing=feature(core,'unsupported','PostgreSQL MERGE DO NOTHING semantic family',[]);
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
