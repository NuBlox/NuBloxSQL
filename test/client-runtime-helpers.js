'use strict';

const assert = require('node:assert/strict');
const facade = require('../lib/client/Client');
const results = require('../lib/client/runtime/ResultNormalization');
const binds = require('../lib/client/runtime/PreparedBindings');
const sql = require('..').sql;

assert.strictEqual(facade.normalizeResult, results.normalizeResult);
assert.strictEqual(facade.resolvePreparedBindings, binds.resolvePreparedBindings);
assert.strictEqual(facade.parameterTypeOids, binds.parameterTypeOids);
assert.strictEqual(facade.parameterTypeOidsFromValues, binds.parameterTypeOidsFromValues);
assert.strictEqual(facade.bindParameters, binds.bindParameters);

assert.equal(results.inferCommand('  SELECT 1'), 'SELECT');
assert.equal(results.inferCommand('  create table x'), 'CREATE');
assert.equal(results.inferCommand(' -- comment'), '');
assert.equal(results.inferCommand(null), '');
const native = {rows:[{a:1}], fields:[{name:'a'}], changes:2};
const query = results.normalizeResult('sqlite','select 1',native);
assert.strictEqual(query.native,native);
assert.strictEqual(query.rows,native.rows);
assert.strictEqual(query.fields,native.fields);
assert.equal(query.rowCount,1);
assert.equal(query.affectedRows,2);
assert.equal(query.insertId,null);
assert.equal(query.command,'SELECT');
assert.equal(query.dialect,'sqlite');
const explicit=results.normalizeResult('mysql','select 2',{
  rows:[1,2],fields:[],rowCount:0,affectedRows:0,insertId:0,command:'EXECUTE'
});
assert.equal(explicit.rowCount,0);
assert.equal(explicit.affectedRows,0);
assert.equal(explicit.insertId,0);
assert.equal(explicit.command,'EXECUTE');
assert.equal(results.normalizeResult('postgresql','',{}).rowCount,0);
assert.equal(results.normalizeResult('postgresql','',{}).affectedRows,null);
assert.equal(results.normalizeResult('postgresql','',{}).command,'');

const plan=[{kind:'value',value:12},{kind:'parameter',name:'text'},{kind:'parameter',name:'date',type:{type:'date'}}];
const bound=binds.resolvePreparedBindings(plan,{text:'ok',date:'2026-10-14'});
assert.equal(bound[0],12);
assert.equal(bound[1],'ok');
assert.equal(bound[2].spec.type,'date');
assert.throws(()=>binds.resolvePreparedBindings(plan,[]),/bindings must be an object/);
assert.throws(()=>binds.resolvePreparedBindings(plan,{text:'ok'}),/missing binding "date"/);
assert.throws(()=>binds.resolvePreparedBindings([{kind:'parameter',name:'x'}],{}),/missing binding "x"/);
const services={parameterTypeOid(spec){return spec.type==='date'?1082:0;},
  bindParameter(value,index){return {index,value};}};
assert.deepEqual(binds.parameterTypeOids({bindings:[{type:{type:'date'}},{type:null}]},services),[1082,0]);
assert.equal(binds.parameterTypeOids({bindings:[{type:null}]},services),null);
assert.equal(binds.parameterTypeOids(null,services),null);
assert.deepEqual(binds.parameterTypeOidsFromValues([sql.typed('2026-10-14','date'),'ordinary'],services),[1082,0]);
assert.equal(binds.parameterTypeOidsFromValues(['ordinary'],services),null);
assert.equal(binds.parameterTypeOidsFromValues([],services),null);
assert.strictEqual(binds.bindParameters(bound,null),bound);
assert.deepEqual(binds.bindParameters([1,2],services),[
  {index:0,value:1},{index:1,value:2}
]);
assert.deepEqual(binds.operationOptionsForTypedValues({timeout:5},
  [sql.typed('2026-10-14','date')],services),{timeout:5,parameterTypeOids:[1082]});
const provided={parameterTypeOids:[123],timeout:9};
assert.strictEqual(binds.operationOptionsForTypedValues(provided,
  [sql.typed('2026-10-14','date')],services),provided);
assert.deepEqual(binds.operationOptionsForTypedValues(null,[12],services),{});
console.log('NuBloxSQL result normalization and prepared binding extraction: PASS');
