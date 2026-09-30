' strict';

var assert = require('assert');
var sql = require('..');

function expectPublic(fn, expected) {
  assert.throws(fn, function (error) {
    return error instanceof sql.NuBloxSqlError &&
      error.code === expected.code &&
      error.category === expected.category &&
      error.operation === expected.operation &&
      (expected.dialect === undefined || error.dialect === expected.dialect);
  });
}

expectPublic(function () { sql.createConnection({}); }, {
  code: sql.ERROR_CODES.ROUTING,
  category: 'state',
  operation: 'routing'
});

expectPublic(function () { sql.createConnection('oracle', {}); }, {
  code: sql.ERROR_CODES.UNSUPPORTED_DIALECT,
  category: 'unsupported',
  operation: 'routing'
});

expectPublic(function () { sql.createConnection('oracle://localhost/app'); }, {
  code: sql.ERROR_CODES.UNSUPPORTED_URL_SCHEME,
  category: 'unsupported',
  operation: 'routing'
});

expectPublic(function () {
  sql.createConnection({ dialect: 'mysql', url: 'postgresql://app@localhost/db' });
}, {
  code: sql.ERROR_CODES.ROUTING,
  category: 'state',
  operation: 'routing',
  dialect: 'mysql'
});

expectPublic(function () {
  sql.createClient({ dialect: 'mysql', user: 'app', telemetry: [] });
}, {
  code: sql.ERROR_CODES.CONFIGURATION,
  category: 'state',
  operation: 'configuration',
  dialect: 'mysql'
});

expectPublic(function () {
  sql.createConnection('mysql://app@localhost/db?ssl=perhaps');
}, {
  code: sql.ERROR_CODES.ROUTING,
  category: 'state',
  operation: 'routing',
  dialect: 'mysql'
});

(async function () {
  var client = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });
  await client.close();
  await assert.rejects(function () { return client.query('SELECT 1'); }, function (error) {
    return error instanceof sql.NuBloxSqlError &&
      error.code === sql.ERROR_CODES.CLIENT_LIFECYCLE &&
      error.category === 'state' &&
      error.operation === 'lifecycle' &&
      error.dialect === 'sqlite' &&
      error.lifecycleState === 'closed';
  });
  console.log('NuBloxSQL public facade error contract passed');
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
