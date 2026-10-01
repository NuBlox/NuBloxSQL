'use strict';

var assert = require('assert');
var metadataApi = require('../../../client/Metadata');
var integration = require('../../../client/PostgreSQLDeepMetadataIntegration');

integration.install(metadataApi);

async function main() {
  var Metadata = metadataApi.Metadata;
  var prototype = Metadata.prototype;
  [
    'tableDetails', 'columnDetails', 'indexDetails', 'constraintDetails',
    'partitions', 'policies', 'routines', 'types', 'sequences', 'privileges', 'deepCatalog'
  ].forEach(function (name) {
    assert.strictEqual(typeof prototype[name], 'function', name + ' must be installed');
  });

  var nonPostgres = new Metadata({ dialect: 'mysql' });
  assert.strictEqual(await nonPostgres.tableDetails('users'), null);
  assert.deepStrictEqual(Array.from(await nonPostgres.columnDetails('users')), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.indexDetails('users')), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.constraintDetails('users')), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.partitions()), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.policies()), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.routines()), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.types()), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.sequences()), []);
  assert.deepStrictEqual(Array.from(await nonPostgres.privileges()), []);

  var emptyDeep = await nonPostgres.deepCatalog();
  assert.strictEqual(emptyDeep.dialect, 'mysql');
  assert.ok(Object.isFrozen(emptyDeep));
  assert.ok(Object.isFrozen(emptyDeep.partitions));
  assert.ok(Object.isFrozen(emptyDeep.policies));
  assert.ok(Object.isFrozen(emptyDeep.routines));
  assert.ok(Object.isFrozen(emptyDeep.types));
  assert.ok(Object.isFrozen(emptyDeep.sequences));
  assert.ok(Object.isFrozen(emptyDeep.privileges));

  assert.throws(function () { return prototype.tableDetails.call({ dialect: 'postgresql' }, ''); }, /table name/);
  assert.throws(function () { return prototype.columnDetails.call({ dialect: 'postgresql' }, ''); }, /table name/);
  assert.throws(function () { return prototype.indexDetails.call({ dialect: 'postgresql' }, ''); }, /table name/);
  assert.throws(function () { return prototype.constraintDetails.call({ dialect: 'postgresql' }, ''); }, /table name/);

  console.log('ok - PostgreSQL deep metadata contract');
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
