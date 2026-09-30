'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.SQL_CAPABILITY_MODEL_SCHEMA_VERSION, 1);
assert.deepStrictEqual(Array.from(sql.TIER1_DIALECTS), ['postgresql', 'mysql', 'sqlite']);
assert.ok(sql.SQL_CAPABILITY_CATEGORIES.indexOf('statements') >= 0);
assert.ok(sql.SQL_CAPABILITY_CATEGORIES.indexOf('dataMovement') >= 0);
assert.ok(sql.SQL_CAPABILITY_CATEGORIES.indexOf('types') >= 0);
assert.ok(sql.SQL_CAPABILITY_SUPPORT_LEVELS.indexOf('runtime-dependent') >= 0);

['postgresql', 'mysql', 'sqlite'].forEach(function (dialect) {
  var model = sql.capabilityModel.dialect(dialect);
  assert.strictEqual(model.schemaVersion, 1);
  assert.strictEqual(model.dialect, dialect);
  assert.strictEqual(model.tier, 1);
  assert.strictEqual(model.coverage, 'foundation');
  sql.SQL_CAPABILITY_CATEGORIES.forEach(function (category) {
    assert.ok(model[category] && typeof model[category] === 'object', dialect + ' missing category ' + category);
  });
  assert.ok(Object.isFrozen(model));
});

assert.strictEqual(sql.capabilityModel.dialect('pg').dialect, 'postgresql');
assert.strictEqual(sql.capabilityModel.supports('postgresql', 'queries.joins.lateral'), true);
assert.strictEqual(sql.capabilityModel.status('postgresql', 'queries.joins.lateral').support, 'native');
assert.strictEqual(sql.capabilityModel.supports('mysql', 'queries.joins.lateral'), true);
assert.strictEqual(sql.capabilityModel.status('mysql', 'queries.joins.lateral').since, '8.0.14');
assert.strictEqual(sql.capabilityModel.supports('sqlite', 'queries.joins.lateral'), false);
assert.strictEqual(sql.capabilityModel.status('sqlite', 'expressions.json').support, 'runtime-dependent');
assert.strictEqual(sql.capabilityModel.get('postgresql', 'schema.materializedView').supported, true);
assert.strictEqual(sql.capabilityModel.get('mysql', 'schema.materializedView').supported, false);

var lateral = sql.capabilityModel.compare('queries.joins.lateral');
assert.strictEqual(lateral.portable, false);
assert.strictEqual(lateral.determinate, true);
assert.strictEqual(lateral.dialects.postgresql.support, 'native');
assert.strictEqual(lateral.dialects.mysql.support, 'native');
assert.strictEqual(lateral.dialects.sqlite.support, 'unsupported');
assert.ok(Object.isFrozen(lateral));

var json = sql.capabilityModel.compare('expressions.json');
assert.strictEqual(json.portable, false);
assert.strictEqual(json.determinate, false);
assert.strictEqual(json.dialects.sqlite.supported, null);

assert.strictEqual(sql.capabilityModel.get('postgresql', 'not.real'), undefined);
assert.strictEqual(sql.capabilityModel.status('postgresql', 'not.real'), null);
assert.strictEqual(sql.capabilityModel.supports('postgresql', 'not.real'), false);
assert.throws(function () { sql.capabilityModel.dialect('sqlserver'); }, /Tier-1 dialects/);
assert.throws(function () { sql.capabilityModel.get('postgresql', ''); }, /non-empty/);

console.log('NuBloxSQL Tier-1 SQL capability model contract: PASS');
