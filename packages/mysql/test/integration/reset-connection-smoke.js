'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host                    : process.env.MYSQL_HOST || '127.0.0.1',
  port                    : Number(process.env.MYSQL_PORT || 3306),
  user                    : process.env.MYSQL_USER || 'nublox',
  password                : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database                : process.env.MYSQL_DATABASE || 'nublox_ci',
  charset                 : 'UTF8MB4_BIN',
  allowPublicKeyRetrieval : true
};
var connection = mysql.createConnection(config);
var initialThreadId;
var manualStatement;
var smokeTable = 'nublox_reset_connection_smoke';

connection.connect()
  .then(function establishBaseline() {
    return connection.query(
      'SELECT CONNECTION_ID() AS connectionId, DATABASE() AS currentDatabase, ' +
      '@@character_set_client AS characterSetClient, @@collation_connection AS collationConnection'
    );
  })
  .then(function verifyInitialBaseline(result) {
    var row = result[0][0];

    initialThreadId = Number(row.connectionId);
    assert.strictEqual(row.currentDatabase, config.database);
    assert.strictEqual(row.characterSetClient, 'utf8mb4');
    assert.strictEqual(row.collationConnection, 'utf8mb4_bin');

    return connection.query('DROP TABLE IF EXISTS ' + connection.escapeId(smokeTable));
  })
  .then(function createDurableFixture() {
    return connection.query(
      'CREATE TABLE ' + connection.escapeId(smokeTable) + ' (' +
      'id INT NOT NULL PRIMARY KEY, value VARCHAR(32) NOT NULL)'
    );
  })
  .then(function establishSessionState() {
    return connection.query('SET @nublox_reset_value = 123');
  })
  .then(function setLastInsertId() {
    return connection.query('SELECT LAST_INSERT_ID(77) AS value');
  })
  .then(function disableAutocommit() {
    return connection.query('SET autocommit = 0');
  })
  .then(function createUncommittedWork() {
    return connection.query(
      'INSERT INTO ' + connection.escapeId(smokeTable) + ' (id, value) VALUES (1, \'uncommitted\')'
    );
  })
  .then(function createTemporaryTable() {
    return connection.query(
      'CREATE TEMPORARY TABLE nublox_reset_temp (id INT NOT NULL PRIMARY KEY)'
    );
  })
  .then(function populatePreparedCache() {
    return connection.execute('SELECT ? AS value', [41]);
  })
  .then(function verifyPreparedCache(result) {
    assert.strictEqual(result[0][0].value, 41);
    assert.ok(connection.preparedStatementCacheStats().size > 0);
    return connection.prepare('SELECT ? AS value');
  })
  .then(function captureManualStatement(statement) {
    manualStatement = statement;
    return manualStatement.execute([42]);
  })
  .then(function verifyManualStatement(result) {
    assert.strictEqual(result[0][0].value, 42);
    return connection.query('USE information_schema');
  })
  .then(function mutateCharsetAwayFromConfiguredBaseline() {
    return connection.query("SET NAMES 'latin1' COLLATE 'latin1_swedish_ci'");
  })
  .then(function resetSession() {
    return connection.resetConnection({operationTimeout: 5000});
  })
  .then(function verifySessionReset() {
    assert.strictEqual(connection.preparedStatementCacheStats().size, 0);

    return connection.query(
      'SELECT CONNECTION_ID() AS connectionId, DATABASE() AS currentDatabase, ' +
      '@@character_set_client AS characterSetClient, @@collation_connection AS collationConnection, ' +
      '@@autocommit AS autocommitValue, @nublox_reset_value AS userValue, ' +
      'LAST_INSERT_ID() AS lastInsertId'
    );
  })
  .then(function verifyRestoredBaseline(result) {
    var row = result[0][0];

    assert.strictEqual(Number(row.connectionId), initialThreadId, 'physical connection must be preserved');
    assert.strictEqual(row.currentDatabase, config.database, 'configured database must be restored');
    assert.strictEqual(row.characterSetClient, 'utf8mb4', 'configured client charset must be restored');
    assert.strictEqual(row.collationConnection, 'utf8mb4_bin', 'configured collation must be restored');
    assert.strictEqual(Number(row.autocommitValue), 1, 'autocommit must return to the server baseline');
    assert.strictEqual(row.userValue, null, 'user variables must be cleared');
    assert.strictEqual(Number(row.lastInsertId), 0, 'LAST_INSERT_ID must be reset');

    return connection.query('SELECT COUNT(*) AS count FROM ' + connection.escapeId(smokeTable));
  })
  .then(function verifyTransactionRollback(result) {
    assert.strictEqual(Number(result[0][0].count), 0, 'active transaction must be rolled back');

    return connection.query('SELECT COUNT(*) AS count FROM nublox_reset_temp')
      .then(function temporaryTableUnexpectedlySurvived() {
        throw new Error('COM_RESET_CONNECTION did not drop temporary table');
      }, function temporaryTableWasDropped(error) {
        assert.strictEqual(error.code, 'ER_NO_SUCH_TABLE');
      });
  })
  .then(function verifyManualStatementInvalidated() {
    return manualStatement.execute([43]).then(function unexpectedExecute() {
      throw new Error('manual prepared statement remained usable after reset');
    }, function expectedClosedStatement(error) {
      assert.strictEqual(error.code, 'PREPARED_STATEMENT_CLOSED');
    });
  })
  .then(function verifyFreshPreparedExecution() {
    return connection.execute('SELECT ? AS value', [44]);
  })
  .then(function verifyFreshResult(result) {
    assert.strictEqual(result[0][0].value, 44);
    return connection.query('DROP TABLE IF EXISTS ' + connection.escapeId(smokeTable));
  })
  .then(function closeConnection() {
    return connection.end();
  })
  .catch(function fail(error) {
    connection.query('DROP TABLE IF EXISTS ' + connection.escapeId(smokeTable))
      .catch(function ignoreCleanupError() {})
      .then(function closeAfterFailure() {
        return connection.end().catch(function ignoreEndError() {});
      })
      .then(function rethrowFailure() {
        process.nextTick(function throwFailure() {
          throw error;
        });
      });
  });
