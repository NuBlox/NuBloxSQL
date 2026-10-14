'use strict';

// The registry is private infrastructure, not a user-managed driver plugin API.
const assert = require('node:assert/strict');
const nativeRegistry = require('../lib/runtime/NativeAdapterRegistry');
const contract = require('../lib/runtime/NativeAdapterContract');
const sql = require('..');

const make = id => ({
  descriptor: {
    identity: {family:id},
    services: {
      quoteIdentifier(value) {return '"' + value + '"';},
      placeholder(i) {return '?' + i;}
    }
  },
  createConnection(config) {return {config};}
});
const mysql = make('mysql');
const document = {
  descriptor: {identity: {family:'test-document'}},
  createConnection(config) {return {config, getDocument() {return null;}};}
};
let sqlLoads=0, documentLoads=0;
const entries = [
  {id:'mysql',models:['relational'],nativeInterface:'sql',
    operations:['sql.query'],load() {sqlLoads++;return mysql;}},
  {id:'test-document',models:['document'],nativeInterface:'document-api',
    operations:['document.read'],load() {documentLoads++;return document;}}
];
const registry = nativeRegistry.create(entries);
assert.equal(sqlLoads,0);
assert.equal(documentLoads,0);
assert.ok(Object.isFrozen(registry));
assert.ok(Object.isFrozen(registry.list()));
assert.deepEqual(registry.list().map(x=>x.id),['mysql','test-document']);
assert.ok(Object.isFrozen(registry.list()[0]));
assert.ok(Object.isFrozen(registry.list()[0].models));
assert.deepEqual(registry.get('mysql'),contract.define({
  id:'mysql',models:['relational'],nativeInterface:'sql',operations:['sql.query']
}));
assert.equal(registry.get('__proto__'),null);
assert.equal(registry.get('constructor'),null);
assert.equal(registry.get('mongodb'),null);
assert.equal(registry.get('MYSQL'),null);
assert.equal(registry.get(null),null);
assert.throws(()=>registry.load('__proto__'), /not registered/);
assert.throws(()=>registry.load('mongodb'), /not registered/);
assert.equal(sqlLoads,0);
assert.equal(documentLoads,0);

assert.throws(()=>registry.load('mysql','document.read'), /operation is not declared/);
assert.throws(()=>registry.load('test-document','sql.query'), /operation is not declared/);
assert.throws(()=>registry.load('mysql',[]), /operation is not declared/);
assert.equal(sqlLoads,0);
assert.equal(documentLoads,0);

assert.strictEqual(registry.load('mysql','sql.query'),mysql);
assert.strictEqual(registry.load('mysql'),mysql);
assert.equal(sqlLoads,1,'successful loader invoked only once');
assert.strictEqual(registry.load('test-document','document.read'),document);
assert.strictEqual(registry.load('test-document','document.read'),document);
assert.equal(documentLoads,1);
assert.equal(typeof registry.register,'undefined');
assert.equal(typeof registry.unregister,'undefined');

entries[0].id='postgresql';
entries[0].operations.push('sql.drop');
entries.push({id:'test-malicious',models:['relational'],nativeInterface:'sql',
  operations:['sql.query'],load() {throw Error('must not register');}});
assert.strictEqual(registry.get('postgresql'),null);
assert.strictEqual(registry.get('test-malicious'),null);
assert.deepEqual(registry.get('mysql').operations,['sql.query']);

assert.throws(()=>nativeRegistry.create([]), /nonempty registration array/);
assert.throws(()=>nativeRegistry.create(null), /nonempty registration array/);
assert.throws(()=>nativeRegistry.create([null]), /registration must be an object/);
assert.throws(()=>nativeRegistry.create([{id:'x',models:['document'],
  nativeInterface:'document-api',operations:['document.read']}]), /loader must be a function/);
assert.throws(()=>nativeRegistry.create([{
  id:'x',models:['document'],nativeInterface:'document-api',
  operations:['document.read'],load:()=>document,secret:'plaintext'
}]), /unknown native adapter registration field/);
assert.throws(()=>nativeRegistry.create([
  {id:'x',models:['document'],nativeInterface:'document-api',
    operations:['document.read'],load:()=>document},
  {id:'x',models:['document'],nativeInterface:'document-api',
    operations:['document.read'],load:()=>document}
]), /duplicate native adapter registration/);

let attempts=0;
const retry = nativeRegistry.create([{
  id:'retry',models:['document'],nativeInterface:'document-api',
  operations:['document.read'],
  load() {
    attempts++;
    if(attempts===1)return {descriptor:{identity:{family:'retry'}}};
    return {descriptor:{identity:{family:'retry'}},createConnection() {return {}}};
  }
}]);
assert.throws(()=>retry.load('retry'), /createConnection/);
assert.equal(typeof retry.load('retry').createConnection,'function');
assert.equal(attempts,2,'failed implementation is not cached');

let recursion;
recursion = nativeRegistry.create([{
  id:'recursive',models:['document'],nativeInterface:'document-api',
  operations:['document.read'],
  load() {return recursion.load('recursive');}
}]);
assert.throws(()=>recursion.load('recursive'),/recursive native adapter loading/);
assert.throws(()=>recursion.load('recursive'),/recursive native adapter loading/);

const lazyMysqlPath = require.resolve('../lib/dialects/mysql');
const isolated = nativeRegistry.create([{
  id:'mysql',models:['relational'],nativeInterface:'sql',
  operations:['sql.query'],
  load() {return require('../lib/dialects/mysql');}
}]);
assert.equal(isolated.list()[0].nativeInterface,'sql');
assert.strictEqual(isolated.load('mysql'),sql.adapter('mysql'));
assert.equal(typeof require.cache[lazyMysqlPath]?.exports.createConnection,'function');

// Real SQL qualification remains unchanged. MongoDB is a separate native
// document runtime, not an SQL dialect and not a catalogue-only descriptor.
assert.equal(sql.databaseTechnologyRegistry.get('mongodb').runtime.routable,true);
assert.deepEqual(sql.databaseTechnologyRegistry.inspect('mongodb').executableOperations,
  ['document.read','document.write']);
assert.equal(sql.cloudDatabaseRegistry.report().counts.cloudQualified,0);
assert.throws(()=>sql.adapter('mongodb'),/Unsupported NuBloxSQL dialect/);
console.log('NuBloxSQL private native adapter registry and fail-closed operations: PASS');
