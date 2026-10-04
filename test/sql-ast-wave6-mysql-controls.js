'use strict';

var assert=require('assert');
var sql=require('..');
var model=sql.capabilityModel;

(function singleUpdateControls(){
  var source='UPDATE LOW_PRIORITY IGNORE ledger AS l SET l.amount = ? WHERE l.tenant_id = ? ORDER BY l.id DESC LIMIT ?';
  var ast=model.parseSql('mysql',source);
  assert.strictEqual(ast.type,'MysqlSingleTableUpdateStatement');
  assert.deepStrictEqual(ast.modifiers,['LOW_PRIORITY','IGNORE']);
  assert.strictEqual(ast.target.alias.parts[0],'l');
  assert.strictEqual(ast.orderBy.length,1);
  assert.ok(ast.limit);
  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v7');
  ['syntax.mysqlMutationTargetAlias','syntax.mysqlUpdateLowPriority','syntax.mysqlUpdateIgnore','syntax.mysqlUpdateOrderBy','syntax.mysqlUpdateLimit'].forEach(function(path){
    assert.ok(analysis.capabilities.indexOf(path)!==-1,path);
  });
  var compiled=model.compileAst('mysql',ast);
  assert.ok(/^UPDATE LOW_PRIORITY IGNORE `ledger` AS `l` SET /.test(compiled.sql));
  assert.ok(/ ORDER BY `l`.`id` DESC LIMIT \?$/.test(compiled.sql));
  assert.deepStrictEqual(compiled.targetToSource,[1,2,3]);
  assert.strictEqual(model.transpileSql('mysql','mysql',source).certified,true);
})();

(function singleDeleteControls(){
  var source='DELETE LOW_PRIORITY QUICK IGNORE FROM ledger AS l WHERE l.tenant_id = ? ORDER BY l.id ASC LIMIT ?';
  var ast=model.parseSql('mysql',source);
  assert.strictEqual(ast.type,'MysqlSingleTableDeleteStatement');
  assert.deepStrictEqual(ast.modifiers,['LOW_PRIORITY','QUICK','IGNORE']);
  assert.strictEqual(ast.target.alias.parts[0],'l');
  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v7');
  ['syntax.mysqlMutationTargetAlias','syntax.mysqlDeleteLowPriority','syntax.mysqlDeleteQuick','syntax.mysqlDeleteIgnore','syntax.mysqlDeleteOrderBy','syntax.mysqlDeleteLimit'].forEach(function(path){
    assert.ok(analysis.capabilities.indexOf(path)!==-1,path);
  });
  var compiled=model.compileAst('mysql',ast);
  assert.ok(/^DELETE LOW_PRIORITY QUICK IGNORE FROM `ledger` AS `l`/.test(compiled.sql));
  assert.ok(/ ORDER BY `l`.`id` ASC LIMIT \?$/.test(compiled.sql));
  assert.deepStrictEqual(compiled.targetToSource,[1,2]);
})();

(function multiTableModifiersRemainDmlV7(){
  var update=model.parseSql('mysql','UPDATE LOW_PRIORITY IGNORE a JOIN b ON b.id = a.id SET a.x = ?, b.y = ? WHERE a.id = ?');
  assert.strictEqual(update.type,'MysqlMultiTableUpdateStatement');
  assert.deepStrictEqual(update.modifiers,['LOW_PRIORITY','IGNORE']);
  assert.strictEqual(model.analyzeAst(update).scope,'dml-v7');
  var uc=model.compileAst('mysql',update);
  assert.ok(/^UPDATE LOW_PRIORITY IGNORE /.test(uc.sql));
  assert.deepStrictEqual(uc.targetToSource,[1,2,3]);

  var del=model.parseSql('mysql','DELETE LOW_PRIORITY QUICK IGNORE a FROM a JOIN b ON b.id = a.id WHERE a.id = ?');
  assert.strictEqual(del.type,'MysqlMultiTableDeleteStatement');
  assert.deepStrictEqual(del.modifiers,['LOW_PRIORITY','QUICK','IGNORE']);
  assert.strictEqual(model.analyzeAst(del).scope,'dml-v7');
  assert.ok(/^DELETE LOW_PRIORITY QUICK IGNORE `a` FROM /.test(model.compileAst('mysql',del).sql));
})();

(function grammarBoundariesFailClosed(){
  assert.throws(function(){
    model.parseSql('mysql','UPDATE IGNORE LOW_PRIORITY ledger SET amount = 1');
  },/modifier order/);
  assert.throws(function(){
    model.parseSql('mysql','DELETE IGNORE QUICK FROM ledger');
  },/modifier order/);
  assert.throws(function(){
    model.parseSql('mysql','UPDATE a JOIN b ON b.id=a.id SET a.x=1 ORDER BY a.id LIMIT 1');
  },/Unexpected|unsupported|expression|trailing|relations and joins only/i);
  assert.throws(function(){
    model.parseSql('mysql','DELETE a FROM a JOIN b ON b.id=a.id ORDER BY a.id LIMIT 1');
  },/Unexpected|unsupported|expression|trailing|relations and joins only/i);
})();

(function crossDialectFailsClosed(){
  var ast=model.parseSql('mysql','DELETE FROM ledger AS l ORDER BY l.id LIMIT 1');
  assert.throws(function(){model.compileAst('postgresql',ast);},/only renderable for MySQL/);
  assert.throws(function(){model.transpileSql('mysql','sqlite','DELETE FROM ledger AS l LIMIT 1');},/vendor-specific/);
})();

(function ontologyCoverage(){
  [
    'syntax.mysqlMutationTargetAlias',
    'syntax.mysqlUpdateLowPriority','syntax.mysqlUpdateIgnore',
    'syntax.mysqlDeleteLowPriority','syntax.mysqlDeleteQuick','syntax.mysqlDeleteIgnore',
    'syntax.mysqlUpdateOrderBy','syntax.mysqlUpdateLimit',
    'syntax.mysqlDeleteOrderBy','syntax.mysqlDeleteLimit'
  ].forEach(function(path){
    assert.strictEqual(sql.capabilityOntology.implementation(path).scope,'dml-v7',path);
    assert.strictEqual(sql.capabilityOntology.resolve('mysql',path).available,true,path);
    assert.strictEqual(sql.capabilityOntology.resolve('postgresql',path).available,false,path);
    assert.strictEqual(sql.capabilityOntology.resolve('sqlite',path).available,false,path);
  });
})();

console.log('NuBloxSQL Wave 6e MySQL mutation controls contract: PASS');
