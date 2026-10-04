'use strict';

var assert=require('assert');
var sql=require('..');
var model=sql.capabilityModel;

(function orderedMergeClauses(){
  var source=[
    'MERGE INTO ledger AS t USING incoming AS s ON t.id = s.id',
    'WHEN MATCHED AND s.amount > $1 THEN UPDATE SET amount = s.amount',
    'WHEN MATCHED THEN DELETE',
    'WHEN NOT MATCHED AND s.amount > $2 THEN INSERT (id, amount) VALUES (s.id, s.amount)',
    'WHEN NOT MATCHED THEN DO NOTHING'
  ].join(' ');
  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(ast.type,'MergeStatement');
  assert.ok(Array.isArray(ast.clauses));
  assert.strictEqual(ast.clauses.length,4);
  assert.strictEqual(ast.clauses[0].match,'matched');
  assert.strictEqual(ast.clauses[0].condition.type,'BinaryExpression');
  assert.strictEqual(ast.clauses[0].action.action,'update');
  assert.strictEqual(ast.clauses[1].action.action,'delete');
  assert.strictEqual(ast.clauses[2].match,'not-matched');
  assert.strictEqual(ast.clauses[2].action.action,'insert');
  assert.strictEqual(ast.clauses[3].action.action,'nothing');

  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v8');
  ['statements.merge','syntax.mergeMultipleWhen','syntax.mergeActionCondition','syntax.mergeDoNothing'].forEach(function(path){
    assert.ok(analysis.capabilities.indexOf(path)!==-1,'missing '+path);
  });

  var compiled=model.compileAst('postgresql',ast);
  assert.ok(/WHEN MATCHED AND .* > \$1 THEN UPDATE SET/.test(compiled.sql));
  assert.ok(/WHEN MATCHED THEN DELETE/.test(compiled.sql));
  assert.ok(/WHEN NOT MATCHED AND .* > \$2 THEN INSERT/.test(compiled.sql));
  assert.ok(/WHEN NOT MATCHED THEN DO NOTHING/.test(compiled.sql));
  assert.deepStrictEqual(compiled.targetToSource,[1,2]);
})();

(function bareAliasesAreNormalized(){
  var ast=model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id = s.id WHEN MATCHED THEN DO NOTHING');
  assert.strictEqual(ast.targetAlias.parts[0],'t');
  assert.strictEqual(ast.sourceAlias.parts[0],'s');
  var compiled=model.compileAst('postgresql',ast);
  assert.ok(/^MERGE INTO "ledger" AS "t" USING "incoming" AS "s"/.test(compiled.sql));
})();

(function caseExpressionsDoNotBreakClauseDiscovery(){
  var ast=model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN MATCHED THEN UPDATE SET amount = CASE WHEN s.amount > 0 THEN s.amount ELSE 0 END WHEN NOT MATCHED THEN DO NOTHING');
  assert.strictEqual(ast.clauses.length,2);
  assert.strictEqual(ast.clauses[0].action.assignments[0].value.type,'CaseExpression');
})();

(function unreachableClausesFailClosed(){
  assert.throws(function(){
    model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id = s.id WHEN MATCHED THEN DELETE WHEN MATCHED AND s.amount > 0 THEN UPDATE SET amount = s.amount');
  },/unreachable after an unconditional clause/);
  assert.throws(function(){
    model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id = s.id WHEN NOT MATCHED THEN DO NOTHING WHEN NOT MATCHED AND s.amount > 0 THEN INSERT (id) VALUES (s.id)');
  },/unreachable after an unconditional clause/);
})();

(function versionedFamiliesRemainSeparate(){
  assert.throws(function(){
    model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN NOT MATCHED BY SOURCE THEN DELETE');
  },/does not yet include PostgreSQL 17\+ BY SOURCE\/BY TARGET/);
})();

(function crossDialectFailsClosed(){
  var ast=model.parseSql('postgresql','MERGE INTO ledger t USING incoming s ON t.id=s.id WHEN MATCHED AND s.amount>0 THEN UPDATE SET amount=s.amount WHEN MATCHED THEN DELETE');
  assert.throws(function(){model.compileAst('mysql',ast);},/PostgreSQL-only/);
  assert.throws(function(){model.compileAst('sqlite',ast);},/PostgreSQL-only/);
})();

(function ontologyCoverage(){
  ['syntax.mergeMultipleWhen','syntax.mergeActionCondition','syntax.mergeDoNothing'].forEach(function(path){
    var impl=sql.capabilityOntology.implementation(path);
    assert.strictEqual(impl.scope,'dml-v8');
    assert.strictEqual(impl.qualified,true);
    assert.strictEqual(sql.capabilityOntology.resolve('postgresql',path,{version:'15'}).available,true);
    assert.strictEqual(sql.capabilityOntology.resolve('mysql',path).available,false);
    assert.strictEqual(sql.capabilityOntology.resolve('sqlite',path).available,false);
  });
})();

console.log('NuBloxSQL ordered PostgreSQL MERGE action-chain contract: PASS');
