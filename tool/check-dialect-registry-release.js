'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.DIALECT_REGISTRY_SCHEMA_VERSION, 1);
assert.strictEqual(sql.DIALECT_REGISTRY_MASTER_PROFILE_COUNT, 100);
assert.strictEqual(sql.capabilityModel.dialectRegistry, sql.dialectRegistry);

var validation = sql.dialectRegistry.validate();
assert.strictEqual(validation.valid, true, validation.errors.join('\n'));
assert.strictEqual(validation.masterProfiles, 100);
assert.strictEqual(validation.firstClassDialects, 25);

var report = sql.dialectRegistry.report();
assert.strictEqual(report.counts.routableProducts, 4);
assert.strictEqual(report.products.length, 100);
assert.strictEqual(report.primaryDialects.length, 25);

report.products.forEach(function (entry) {
  assert.ok(entry.vendor, entry.id + ' vendor missing');
  assert.ok(entry.product, entry.id + ' product missing');
  assert.ok(entry.dialect, entry.id + ' dialect missing');
  assert.ok(entry.versions && Array.isArray(entry.versions.qualified), entry.id + ' versions missing');
  assert.ok(entry.driver && typeof entry.driver.routable === 'boolean', entry.id + ' driver missing');
  assert.ok(entry.wireProtocol && entry.wireProtocol.status, entry.id + ' wire protocol missing');
  assert.ok(entry.compatibility && entry.compatibility.grammar, entry.id + ' compatibility missing');
  ['capabilities','dataTypes','operators','functions','ddl','dml','dcl','tcl','proceduralLanguage'].forEach(function (key) {
    assert.ok(Object.prototype.hasOwnProperty.call(entry.language, key), entry.id + ' language surface missing: ' + key);
  });
});

assert.strictEqual(sql.dialectRegistry.product('aurora-postgresql').driver.routable, false);
assert.strictEqual(sql.dialectRegistry.product('aurora-postgresql').driver.candidateAdapter, 'postgresql');
assert.strictEqual(sql.dialectRegistry.product('spanner-postgresql').parentDialect, 'postgresql');
assert.strictEqual(sql.dialectRegistry.product('bigquery-legacy').parentDialect, 'bigquery');
assert.strictEqual(sql.dialectRegistry.product('oracle-plsql').proceduralLanguage, 'PL/SQL');
assert.deepStrictEqual(
  sql.dialectRegistry.ancestry('memsql-legacy').map(function (entry) { return entry.id; }),
  ['memsql-legacy','singlestore','mysql']
);

assert.throws(function () {
  sql.createClient({ dialect: 'aurora-postgresql', user: 'test' });
}, /Unsupported NuBloxSQL dialect/);

console.log('NuBloxSQL canonical dialect registry release qualification: PASS');
