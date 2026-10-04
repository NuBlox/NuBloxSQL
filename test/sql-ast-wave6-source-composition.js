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

(function sourceBindsAreRemappedLosslessly(){
  var pg=model.parseSql('postgresql','UPDATE ledger SET amount = $1 FROM (SELECT id, amount FROM rates WHERE tenant_id = $3) AS r WHERE ledger.id = $2');
  assert.strictEqual(model.analyzeAst(pg).scope,'dml-v5');
  var pgCompiled=model.compileAst('postgresql',pg);
  assert.deepStrictEqual(pgCompiled.targetToSource,[1,3,2]);
  assert.ok(/SET "amount" = \$1 FROM \(SELECT .*tenant_id.* = \$2/.test(pgCompiled.sql));
  assert.ok(/WHERE .*ledger.*id.* = \$3/.test(pgCompiled.sql));

  var sqlite=model.parseSql('sqlite','UPDATE ledger SET amount = ? FROM (SELECT id, amount FROM rates WHERE tenant_id = ?) AS r WHERE ledger.id = ?');
  assert.strictEqual(model.analyzeAst(sqlite).scope,'dml-v5');
  var sqliteCompiled=model.compileAst('sqlite',sqlite);
  assert.deepStrictEqual(sqliteCompiled.targetToSource,[1,2,3]);
  assert.ok(/SET "amount" = \?1 FROM \(SELECT .*tenant_id.* = \?2/.test(sqliteCompiled.sql));
  assert.ok(/WHERE .*ledger.*id.* = \?3/.test(sqliteCompiled.sql));

  var named=model.parseSql('sqlite','UPDATE ledger SET amount = :amount FROM (SELECT id, amount FROM rates WHERE tenant_id = :tenant) AS r WHERE ledger.id = :id');
  var namedCompiled=model.compileAst('sqlite',named);
  assert.deepStrictEqual(namedCompiled.targetToSource,[':amount',':tenant',':id']);
})();

(function mysqlFamilyRemainsDistinct(){
  assert.throws(function(){
    model.parseSql('mysql','UPDATE ledger SET amount = r.amount FROM rates AS r JOIN bands AS b ON b.id = r.band_id WHERE ledger.id = r.id');
  },/distinct semantic family/);
})();

console.log('NuBloxSQL Wave 6b rich DML source composition contract: PASS');
