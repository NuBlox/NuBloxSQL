'use strict';

var assert=require('assert');
var sql=require('..');
var model=sql.capabilityModel;

(function parseAndCompileVersionedMerge(){
  var source=[
    'MERGE INTO ledger AS t USING incoming AS s ON t.id = s.id',
    'WHEN MATCHED AND s.amount > $1 THEN UPDATE SET amount = s.amount',
    'WHEN NOT MATCHED BY TARGET THEN INSERT (id, amount) VALUES (s.id, s.amount)',
    'WHEN NOT MATCHED BY SOURCE AND t.amount < $2 THEN DELETE',
    'RETURNING merge_action(), t.id, t.amount'
  ].join(' ');

  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(ast.type,'MergeStatement');
  assert.strictEqual(ast.clauses.length,3);
  assert.strictEqual(ast.clauses[1].match,'not-matched-by-target');
  assert.strictEqual(ast.clauses[2].match,'not-matched-by-source');
  assert.strictEqual(ast.returning.length,3);

  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v9');
  ['syntax.mergeNotMatchedBySource','syntax.mergeNotMatchedByTarget','syntax.mergeReturning'].forEach(function(path){
    assert.ok(analysis.capabilities.indexOf(path)!==-1,'missing '+path);
  });

  var compiled=model.compileAst('postgresql',ast);
  assert.ok(compiled.sql.indexOf('WHEN NOT MATCHED BY TARGET THEN INSERT')!==-1);
  assert.ok(compiled.sql.indexOf('WHEN NOT MATCHED BY SOURCE AND')!==-1);
  assert.ok(compiled.sql.indexOf('RETURNING merge_action(), "t"."id", "t"."amount"')!==-1);
  assert.deepStrictEqual(compiled.targetToSource,[1,2]);
})();

(function runtimeVersionQualification(){
  var source='MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN NOT MATCHED BY TARGET THEN INSERT (id) VALUES (s.id) WHEN NOT MATCHED BY SOURCE THEN DELETE RETURNING t.id';
  var q16=model.qualify('postgresql',{version:'16.9'});
  var q17=model.qualify('postgresql',{version:'17.0'});
  function entry(report,path){return report.entries.find(function(item){return item.path===path;});}

  ['syntax.mergeNotMatchedBySource','syntax.mergeNotMatchedByTarget','syntax.mergeReturning'].forEach(function(path){
    assert.strictEqual(entry(q16,path).supported,false);
    assert.strictEqual(entry(q17,path).supported,true);
  });

  assert.throws(function(){
    model.transpileSql('postgresql','postgresql',source,{sourceQualification:q16,targetQualification:q16});
  },/blocked by unsupported capabilities/);

  assert.throws(function(){
    model.transpileSql('postgresql','postgresql',source);
  },/requires runtime qualification/);

  var result=model.transpileSql('postgresql','postgresql',source,{sourceQualification:q17,targetQualification:q17});
  assert.strictEqual(result.scope,'dml-v9');
  assert.strictEqual(result.certified,true);
})();

(function v8RemainsV8(){
  var source='MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN MATCHED AND s.amount>0 THEN UPDATE SET amount=s.amount WHEN MATCHED THEN DELETE WHEN NOT MATCHED THEN DO NOTHING';
  var result=model.analyzeAst(model.parseSql('postgresql',source));
  assert.strictEqual(result.scope,'dml-v8');
})();

(function matchFamilyReachability(){
  assert.throws(function(){
    model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN NOT MATCHED BY TARGET THEN DO NOTHING WHEN NOT MATCHED AND s.id>0 THEN INSERT (id) VALUES (s.id)');
  },/unreachable after an unconditional clause/);

  var ast=model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN NOT MATCHED BY SOURCE THEN DELETE WHEN NOT MATCHED BY TARGET THEN INSERT (id) VALUES (s.id)');
  assert.strictEqual(ast.clauses.length,2);
})();

(function returningOutputAliasesRemainFuture(){
  assert.throws(function(){
    model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN MATCHED THEN DO NOTHING RETURNING WITH (OLD AS o) o.id');
  },/does not yet support MERGE RETURNING WITH/);
})();

console.log('NuBloxSQL dml-v9 PostgreSQL version-qualified MERGE contract: PASS');
