'use strict';

var assert=require('assert');
var sql=require('..');
var model=sql.capabilityModel;

(function derivedJoinSource(){
  var source=[
    'MERGE INTO ledger AS t',
    'USING (SELECT i.id, i.amount FROM incoming AS i INNER JOIN tenants AS x ON x.id = i.tenant_id WHERE x.id = $1) AS s',
    'ON t.id = s.id',
    'WHEN MATCHED AND s.amount > $2 THEN UPDATE SET amount = s.amount',
    'WHEN NOT MATCHED THEN INSERT (id, amount) VALUES (s.id, s.amount)'
  ].join(' ');

  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(ast.type,'MergeStatement');
  assert.strictEqual(ast.source.type,'MutationSource');
  assert.strictEqual(ast.source.relation.type,'DerivedTable');
  assert.strictEqual(ast.source.relation.alias.parts[0],'s');
  assert.strictEqual(ast.source.relation.query.joins.length,1);
  assert.ok(ast.source.relation.query.where);

  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v10');
  assert.ok(analysis.capabilities.indexOf('syntax.mergeQuerySource')!==-1);
  assert.ok(analysis.capabilities.indexOf('queries.joins.inner')!==-1);

  var compiled=model.compileAst('postgresql',ast);
  assert.ok(compiled.sql.indexOf('USING (SELECT')!==-1);
  assert.ok(compiled.sql.indexOf('INNER JOIN')!==-1);
  assert.ok(compiled.sql.indexOf('AS "s" ON')!==-1);
  assert.deepStrictEqual(compiled.targetToSource,[1,2]);
})();

(function cteBackedSource(){
  var source=[
    'MERGE INTO ledger t',
    'USING (WITH recent AS (SELECT id, amount FROM incoming WHERE amount > $1)',
    'SELECT r.id, r.amount FROM recent r) AS s',
    'ON t.id=s.id',
    'WHEN MATCHED THEN UPDATE SET amount=s.amount',
    'WHEN NOT MATCHED THEN INSERT (id, amount) VALUES (s.id, s.amount)'
  ].join(' ');

  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(model.analyzeAst(ast).scope,'dml-v10');
  assert.ok(ast.source.relation.query.with);
  assert.strictEqual(ast.source.relation.query.with.entries.length,1);

  var compiled=model.compileAst('postgresql',ast);
  assert.ok(compiled.sql.indexOf('USING (WITH "recent" AS (SELECT')!==-1);
  assert.deepStrictEqual(compiled.targetToSource,[1]);
})();

(function richSourceCanComposeWithV9Capabilities(){
  var source=[
    'MERGE INTO ledger t',
    'USING (SELECT id, amount FROM incoming) AS s',
    'ON t.id=s.id',
    'WHEN NOT MATCHED BY SOURCE THEN DELETE',
    'RETURNING t.id'
  ].join(' ');
  var ast=model.parseSql('postgresql',source);
  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v10');
  assert.ok(analysis.capabilities.indexOf('syntax.mergeQuerySource')!==-1);
  assert.ok(analysis.capabilities.indexOf('syntax.mergeNotMatchedBySource')!==-1);
  assert.ok(analysis.capabilities.indexOf('syntax.mergeReturning')!==-1);

  var q16=model.qualify('postgresql',{version:'16.9'});
  var q17=model.qualify('postgresql',{version:'17.0'});
  assert.throws(function(){
    model.transpileSql('postgresql','postgresql',source,{sourceQualification:q16,targetQualification:q16});
  },/blocked by unsupported capabilities/);
  var result=model.transpileSql('postgresql','postgresql',source,{sourceQualification:q17,targetQualification:q17});
  assert.strictEqual(result.scope,'dml-v10');
  assert.strictEqual(result.certified,true);
})();

(function simpleSourcesPreservePreviousScopes(){
  var v8=model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN MATCHED AND s.amount>0 THEN UPDATE SET amount=s.amount WHEN MATCHED THEN DELETE');
  assert.strictEqual(model.analyzeAst(v8).scope,'dml-v8');

  var v9=model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN NOT MATCHED BY SOURCE THEN DELETE RETURNING t.id');
  assert.strictEqual(model.analyzeAst(v9).scope,'dml-v9');
})();

(function querySourceRequiresAlias(){
  assert.throws(function(){
    model.parseSql('postgresql','MERGE INTO ledger t USING (SELECT id FROM incoming) ON t.id=id WHEN MATCHED THEN DELETE');
  },/query source requires an alias/);
})();

(function directJoinIsNotInvented(){
  assert.throws(function(){
    model.parseSql('postgresql','MERGE INTO ledger t USING incoming i JOIN tenants x ON x.id=i.tenant_id ON t.id=i.id WHEN MATCHED THEN DELETE');
  });
})();

console.log('NuBloxSQL dml-v10 PostgreSQL MERGE rich-source contract: PASS');
