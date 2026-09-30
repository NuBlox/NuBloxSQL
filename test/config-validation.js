'use strict';

var assert = require('assert');
var sql = require('..');

function expectConfigError(fn, pattern) {
  assert.throws(fn, function (error) {
    return error && error.code === 'NUBLOXSQL_CONFIGURATION' && pattern.test(error.message);
  });
}

expectConfigError(function () {
  sql.createConnection({ dialect: 'mysql', host: 42, user: 'app' });
}, /host must be a string/);

expectConfigError(function () {
  sql.createConnection({ dialect: 'postgresql', host: 'localhost', port: 0, user: 'app' });
}, /port must be at least 1/);

expectConfigError(function () {
  sql.createConnection({ dialect: 'sqlserver', host: 'localhost', port: 65536, user: 'app' });
}, /port must be at most 65535/);

expectConfigError(function () {
  sql.createConnection({ dialect: 'mysql', host: 'localhost', user: 'app', connectTimeout: -1 });
}, /connectTimeout must be at least 0/);

expectConfigError(function () {
  sql.createPool({ dialect: 'mysql', user: 'app', connectionLimit: 0 });
}, /connectionLimit must be at least 1/);

expectConfigError(function () {
  sql.createPool({ dialect: 'mysql', user: 'app', connectionLimit: 2, maxIdle: 3 });
}, /maxIdle must not exceed connectionLimit/);

expectConfigError(function () {
  sql.createPool({ dialect: 'postgresql', user: 'app', idleTimeout: -1 });
}, /idleTimeout must be at least 0/);

expectConfigError(function () {
  sql.createPool({ dialect: 'sqlserver', user: 'app', acquireTimeout: 0 });
}, /acquireTimeout must be at least 1/);

expectConfigError(function () {
  sql.createPool({ dialect: 'mysql', user: 'app', queueLimit: -1 });
}, /queueLimit must be at least 0/);

expectConfigError(function () {
  sql.createPool({ dialect: 'mysql', user: 'app', resetOnRelease: 'yes' });
}, /resetOnRelease must be a boolean/);

expectConfigError(function () {
  sql.createClient({ dialect: 'mysql', user: 'app', pool: [] });
}, /pool must be false, true, or an options object/);

expectConfigError(function () {
  sql.createClient({ dialect: 'mysql', user: 'app', pool: { max: 0 } });
}, /max must be at least 1/);

expectConfigError(function () {
  sql.createClient({ dialect: 'mysql', user: 'app', pool: { max: 4, connectionLimit: 3 } });
}, /pool\.max and pool\.connectionLimit must match/);

expectConfigError(function () {
  sql.createClient({ dialect: 'mysql', user: 'app', connectionLimit: 5, pool: { max: 4 } });
}, /top-level connectionLimit conflicts/);

expectConfigError(function () {
  sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: true });
}, /does not support connection pools/);

var direct = sql.createConnection({
  dialect: 'mysql',
  host: 'localhost',
  user: 'app',
  characterSet: 45
});
assert.strictEqual(direct.config.characterSet, 45, 'dialect-specific options must pass through validation');

var pool = sql.createPool({
  dialect: 'mysql',
  user: 'app',
  connectionLimit: 4,
  maxIdle: 2,
  idleTimeout: 0,
  acquireTimeout: 2500,
  queueLimit: 10,
  resetOnRelease: true
});
assert.strictEqual(pool.connectionLimit, 4);
assert.strictEqual(pool.maxIdle, 2);
assert.strictEqual(pool.idleTimeout, 0);
assert.strictEqual(pool.acquireTimeout, 2500);
assert.strictEqual(pool.queueLimit, 10);

var client = sql.createClient({ dialect: 'mysql', user: 'app', pool: { max: 3, maxIdle: 2 } });
assert.strictEqual(client.native.connectionLimit, 3);
assert.strictEqual(client.native.maxIdle, 2);

Promise.all([pool.end(), client.close()]).then(function () {
  console.log('NuBloxSQL platform configuration validation contract passed');
}).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
