'use strict';

var assert=require('assert');
var sql=require('..');
var model=sql.capabilityModel;

(function multiTableUpdate(){
  var source='UPDATE accounts AS a INNER JOIN balances AS b ON b.account_id = a.id SET a.status = ?, b.amount = ? WHERE a.tenant_id = ?';
  var ast=model.parseSql('mysql',source);
  assert.strictEqual(ast.type,'MysqlMultiTableUpdateStatement');
  assert.strictEqual(ast.source.type,'MutationSource');
  assert.strictEqual(ast.source.joins.length,1);
  assert.strictEqual(ast.assignments.length,2);
  assert.deepStrictEqual(ast.assignments[0].column.parts,['a','status']);
  assert.deepStrictEqual(ast.assignments[1].column.parts,['b','amount']);
  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v6');
  assert.ok(analysis.capabilities.indexOf('syntax.multiTableUpdate')!==-1);
  assert.ok(analysis.capabilities.indexOf('queries.joins.inner')!==-1);
  var compiled=model.compileAst('mysql',ast);
  assert.ok(/^UPDATE `accounts` AS `a` INNER JOIN `balances` AS `b` ON /.test(compiled.sql));
  assert.ok(/SET `a`.`status` = \?, `b`.`amount` = \? WHERE /.test(compiled.sql));
  assert.deepStrictEqual(compiled.targetToSource,[1,2,3]);
  var same=model.transpileSql('mysql','mysql',source);
  assert.strictEqual(same.certified,true);
  assert.strictEqual(same.scope,'dml-v6');
})();

(function deleteFromForm(){
  var source='DELETE a, b FROM accounts AS a INNER JOIN balances AS b ON b.account_id = a.id WHERE a.tenant_id = ?';
  var ast=model.parseSql('mysql',source);
  assert.strictEqual(ast.type,'MysqlMultiTableDeleteStatement');
  assert.strictEqual(ast.syntax,'from');
  assert.deepStrictEqual(ast.targets.map(function(t){return t.parts[0];}),['a','b']);
  assert.strictEqual(model.analyzeAst(ast).scope,'dml-v6');
  assert.ok(model.analyzeAst(ast).capabilities.indexOf('syntax.multiTableDelete')!==-1);
  var compiled=model.compileAst('mysql',ast);
  assert.ok(/^DELETE `a`, `b` FROM /.test(compiled.sql));
  assert.deepStrictEqual(compiled.targetToSource,[1]);
})();

(function deleteUsingForm(){
  var source='DELETE FROM a, b USING accounts AS a LEFT JOIN balances AS b ON b.account_id = a.id WHERE a.tenant_id = ?';
  var ast=model.parseSql('mysql',source);
  assert.strictEqual(ast.type,'MysqlMultiTableDeleteStatement');
  assert.strictEqual(ast.syntax,'using');
  var compiled=model.compileAst('mysql',ast);
  assert.ok(/^DELETE FROM `a`, `b` USING /.test(compiled.sql));
  assert.deepStrictEqual(compiled.targetToSource,[1]);
})();

(function crossDialectFailsClosed(){
  var ast=model.parseSql('mysql','DELETE a FROM accounts AS a JOIN balances AS b ON b.account_id = a.id WHERE b.amount = ?');
  assert.throws(function(){model.compileAst('postgresql',ast);},/only renderable for MySQL/);
  assert.throws(function(){model.transpileSql('mysql','postgresql','DELETE a FROM accounts AS a JOIN balances AS b ON b.account_id = a.id WHERE b.amount = ?');},/vendor-specific dml-v6 family/);
})();

(function ontologyCoverage(){
  ['syntax.multiTableUpdate','syntax.multiTableDelete'].forEach(function(path){
    var impl=sql.capabilityOntology.implementation(path);
    assert.strictEqual(impl.scope,'dml-v6');
    assert.strictEqual(impl.qualified,true);
    assert.strictEqual(sql.capabilityOntology.resolve('mysql',path).available,true);
    assert.strictEqual(sql.capabilityOntology.resolve('postgresql',path).available,false);
    assert.strictEqual(sql.capabilityOntology.resolve('sqlite',path).available,false);
  });
})();

console.log('NuBloxSQL Wave 6d MySQL multi-table DML contract: PASS');
