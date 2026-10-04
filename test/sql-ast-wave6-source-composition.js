'use strict';

var assert=require('assert');
var sql=require('..');
var model=sql.capabilityModel;

(function postgresqlUpdateFromJoin(){
  var source='UPDATE ledger SET amount = r.amount FROM rates AS r INNER JOIN bands AS b ON b.id = r.band_id WHERE ledger.id = r.id';
  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(ast.type,'UpdateStatement');
  assert.strictEqual(ast.from.type,'MutationSource');
  assert.strictEqual(ast.from.relation.type,'TableReference');
  assert.strictEqual(ast.from.joins.length,1);
  assert.strictEqual(ast.from.joins[0].kind,'INNER');
  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v4');
  assert.ok(analysis.capabilities.indexOf('syntax.updateFrom')!==-1);
  assert.ok(analysis.capabilities.some(function(path){return /join/i.test(path);}));
  var compiled=model.compileAst('postgresql',ast);
  assert.ok(/ FROM "rates" AS "r" INNER JOIN "bands" AS "b" ON /.test(compiled.sql));
})();

(function sqliteUpdateFromJoinIsQualified(){
  var q=model.qualify('sqlite',{version:'3.49.0',source:'test'});
  var source='UPDATE ledger SET amount = r.amount FROM rates AS r LEFT JOIN bands AS b ON b.id = r.band_id WHERE ledger.id = r.id';
  var result=model.transpileSql('sqlite','sqlite',source,{sourceQualification:q,targetQualification:q});
  assert.strictEqual(result.scope,'dml-v4');
  assert.strictEqual(result.certified,true);
  assert.ok(/ LEFT JOIN /.test(result.sql));
})();

(function postgresqlDeleteUsingJoin(){
  var source='DELETE FROM ledger USING expired AS e INNER JOIN batches AS b ON b.id = e.batch_id WHERE ledger.id = e.id';
  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(ast.using.type,'MutationSource');
  assert.strictEqual(ast.using.joins.length,1);
  assert.strictEqual(model.analyzeAst(ast).scope,'dml-v4');
  assert.ok(/ USING "expired" AS "e" INNER JOIN "batches" AS "b" ON /.test(model.compileAst('postgresql',ast).sql));
  assert.throws(function(){model.compileAst('sqlite',ast);},/only qualified for PostgreSQL/);
})();

(function derivedTableMutationSource(){
  var source='UPDATE ledger SET amount = r.amount FROM (SELECT id, amount FROM rates) AS r WHERE ledger.id = r.id';
  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(ast.from.type,'MutationSource');
  assert.strictEqual(ast.from.relation.type,'DerivedTable');
  assert.strictEqual(ast.from.relation.alias.parts[0],'r');
  var compiled=model.compileAst('postgresql',ast);
  assert.ok(/ FROM \(SELECT /.test(compiled.sql));
  assert.ok(/\) AS "r" WHERE /.test(compiled.sql));
})();

(function sourceBindsFailClosed(){
  assert.throws(function(){
    model.parseSql('postgresql','UPDATE ledger SET amount = r.amount FROM (SELECT id, amount FROM rates WHERE tenant_id = $1) AS r WHERE ledger.id = r.id');
  },/bind parameters inside auxiliary mutation sources|parameter remapping/i);
})();

(function mysqlFamilyRemainsDistinct(){
  assert.throws(function(){
    model.parseSql('mysql','UPDATE ledger SET amount = r.amount FROM rates AS r JOIN bands AS b ON b.id = r.band_id WHERE ledger.id = r.id');
  },/distinct semantic family/);
})();

console.log('NuBloxSQL Wave 6b rich DML source composition contract: PASS');
