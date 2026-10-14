'use strict';

// Contract tests do not claim that non-SQL or cloud database drivers exist.
const assert = require('node:assert/strict');
const contract = require('../lib/runtime/NativeAdapterContract');
const sql = require('..');

assert.equal(contract.SCHEMA_VERSION, 1);
assert.ok(contract.MODELS.includes('graph'));
assert.ok(contract.MODELS.includes('document'));
assert.ok(contract.INTERFACES.includes('sql'));
assert.ok(contract.INTERFACES.includes('vector-api'));

const sqlDefinition = contract.define({
  id: 'postgresql', models: ['relational'],
  nativeInterface: 'sql', operations: ['sql.query']
});
assert.ok(Object.isFrozen(sqlDefinition));
assert.ok(Object.isFrozen(sqlDefinition.models));
assert.ok(Object.isFrozen(sqlDefinition.operations));
assert.equal(sqlDefinition.schemaVersion, 1);
assert.equal(sqlDefinition.nativeInterface, 'sql');

const documentDefinition = contract.define({
  id: 'example-doc', models: ['document'], nativeInterface: 'document-api',
  operations: ['document.read', 'document.write']
});
assert.equal(documentDefinition.id, 'example-doc');
assert.equal(documentDefinition.models[0], 'document');

const fakeDocumentRuntime = {
  descriptor: {identity: {family:'example-doc'}},
  createConnection(config) {return {config, collection() {return {};}};}
};
assert.strictEqual(contract.assertRuntime(documentDefinition, fakeDocumentRuntime), fakeDocumentRuntime);
assert.throws(() => contract.assertRuntime(documentDefinition, {}), /createConnection/);
assert.throws(() => contract.assertRuntime(documentDefinition, {
  descriptor: {identity:{family:'mongodb'}}, createConnection() {}
}), /matching descriptor/);

for (const dialect of Object.keys(sql.DIALECTS)) {
  const spec = contract.define({
    id: dialect, models: ['relational'], nativeInterface: 'sql',
    operations: ['sql.query']
  });
  const runtime = sql.adapter(dialect);
  assert.strictEqual(contract.assertRuntime(spec, runtime), runtime);
}
assert.throws(() => contract.define(null), /declaration must be an object/);
assert.throws(() => contract.define({
  id:'MongoDB', models:['document'], nativeInterface:'document-api',
  operations:['document.read']
}), /lowercase/);
assert.throws(() => contract.define({
  id:'example-doc', models:['document','document'], nativeInterface:'document-api',
  operations:['document.read']
}), /duplicates/);
assert.throws(() => contract.define({
  id:'example-doc', models:['unexpected'], nativeInterface:'document-api',
  operations:['document.read']
}), /unknown native adapter models/);
assert.throws(() => contract.define({
  id:'example-doc', models:['document'], nativeInterface:'invalid',
  operations:['document.read']
}), /unsupported native adapter interface/);
assert.throws(() => contract.define({
  id:'example-doc', models:['document'], nativeInterface:'sql',
  operations:['document.read']
}), /SQL native adapters/);
assert.throws(() => contract.define({
  id:'example-doc', models:['document'], nativeInterface:'document-api',
  operations:['document.read'], credentials:'plaintext'
}), /unknown native adapter declaration field/);
assert.throws(() => contract.assertRuntime(sqlDefinition, {
  descriptor: {identity:{family:'postgresql'},services:{}},
  createConnection() {}
}), /quoteIdentifier and placeholder/);
console.log('NuBloxSQL model-neutral native adapter contract: PASS');
