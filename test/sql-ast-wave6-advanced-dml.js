'use strict';

var assert=require('assert');
var sql=require('..');
var model=sql.capabilityModel;

(function postgresqlUpdateFrom(){
  var source='UPDATE ledger SET amount = rates.amount FROM rates AS rates WHERE ledger.id = rates.id RETURNING ledger.id';
  var ast=model.parseSql('postgresql',source);
  assert.strictEqual(ast.type,'UpdateStatement');
  assert.strictEqual(ast.from.type,'TableReference');
  assert.strictEqual(ast.from.name.parts[0],'rates');
  assert.strictEqual(ast.from.alias.parts[0],'rates');
  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v3');
  assert.ok(analysis.capabilities.indexOf('syntax.updateFrom')!==-1);
  var compiled=model.compileAst('postgresql',ast);
  assert.ok(/ FROM "rates" AS "rates" WHERE /.test(compiled.sql));
  assert.ok(/ RETURNING /.test(compiled.sql));
})();

(function sqliteUpdateFromIsVersionQualified(){
  var qualification=model.qualify('sqlite',{version:'3.49.0',source:'test'});
  var result=model.transpileSql('sqlite','sqlite',
    'UPDATE ledger SET amount = rates.amount FROM rates AS rates WHERE ledger.id = rates.id',
    {sourceQualification:qualification,targetQualification:qualification});
  assert.strictEqual(result.scope,'dml-v3');
  assert.strictEqual(result.certified,true);
  assert.ok(/ FROM "rates" AS "rates" WHERE /.test(result.sql));
  var old=model.qualify('sqlite',{version:'3.32.0',source:'test'});
  assert.throws(function(){
    model.transpileSql('sqlite','sqlite',
      'UPDATE ledger SET amount = rates.amount FROM rates AS rates WHERE ledger.id = rates.id',
      {sourceQualification:old,targetQualification:old});
  },/blocked|unsupported/i);
})();

(function postgresqlDeleteUsing(){
  var ast=model.parseSql('postgresql','DELETE FROM ledger USING expired AS e WHERE ledger.id = e.id RETURNING ledger.id');
  assert.strictEqual(ast.type,'DeleteStatement');
  assert.strictEqual(ast.using.type,'TableReference');
  var analysis=model.analyzeAst(ast);
  assert.strictEqual(analysis.scope,'dml-v3');
  assert.ok(analysis.capabilities.indexOf('syntax.deleteUsing')!==-1);
  var compiled=model.compileAst('postgresql',ast);
  assert.ok(/ USING "expired" AS "e" WHERE /.test(compiled.sql));
  assert.throws(function(){model.compileAst('sqlite',ast);},/only qualified for PostgreSQL/);
})();

(function vendorFamiliesStayDistinct(){
  assert.strictEqual(model.status('postgresql','syntax.updateFrom').support,'native');
  assert.strictEqual(model.status('sqlite','syntax.updateFrom').support,'runtime-dependent');
  assert.strictEqual(model.status('mysql','syntax.updateFrom').support,'unsupported');
  assert.strictEqual(model.status('mysql','syntax.multiTableUpdate').support,'native');
  assert.strictEqual(model.status('mysql','syntax.multiTableDelete').support,'native');
  assert.throws(function(){
    model.parseSql('mysql','UPDATE ledger SET amount = rates.amount FROM rates WHERE ledger.id = rates.id');
  },/distinct semantic family/);
  assert.throws(function(){
    model.parseSql('sqlite','DELETE FROM ledger USING expired WHERE ledger.id = expired.id');
  },/PostgreSQL source syntax/);
})();

(function auxiliaryScopeIsDeliberatelyNarrow(){
  assert.throws(function(){
    model.parseSql('postgresql','UPDATE ledger SET amount = r.amount FROM rates r JOIN bands b ON b.id = r.band_id WHERE ledger.id = r.id');
  },/one auxiliary table reference/);
})();

console.log('NuBloxSQL Wave 6a advanced DML composition contract: PASS');
