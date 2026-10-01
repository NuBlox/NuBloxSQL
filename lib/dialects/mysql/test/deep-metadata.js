'use strict';

var assert = require('assert');
var metadataApi = require('../../../client/Metadata');
var pgIntegration = require('../../../client/PostgreSQLDeepMetadataIntegration');
var mysqlIntegration = require('../../../client/MySQLDeepMetadataIntegration');
var mysqlSecurityIntegration = require('../../../client/MySQLSecurityMetadataIntegration');

async function main() {
  pgIntegration.install(metadataApi);
  var pgTableDetails = metadataApi.Metadata.prototype.tableDetails;
  mysqlIntegration.install(metadataApi);
  mysqlSecurityIntegration.install(metadataApi);

  [
    'tableDetails', 'columnDetails', 'indexDetails', 'constraintDetails',
    'partitions', 'routines', 'triggers', 'events', 'privileges', 'accounts', 'roleEdges', 'deepCatalog'
  ].forEach(function (name) {
    assert.strictEqual(typeof metadataApi.Metadata.prototype[name], 'function', name + ' must be installed');
  });

  assert.notStrictEqual(metadataApi.Metadata.prototype.tableDetails, pgTableDetails, 'MySQL dispatcher must wrap the existing PostgreSQL method');
  await assert.rejects(mysqlIntegration.tableDetails.call({ dialect: 'mysql' }, '', {}), /table name/);
  console.log('ok - MySQL deep metadata contract');
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
