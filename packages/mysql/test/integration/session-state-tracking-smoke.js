'use strict';

var assert = require('assert');
var mysql = require('../../promise');

var config = {
  host                    : process.env.MYSQL_HOST || '127.0.0.1',
  port                    : Number(process.env.MYSQL_PORT || 3306),
  user                    : process.env.MYSQL_USER || 'nublox',
  password                : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database                : process.env.MYSQL_DATABASE || 'nublox_ci',
  allowPublicKeyRetrieval : true
};
var connection = mysql.createConnection(config);

connection.connect()
  .then(function configureSystemVariableTracking() {
    return connection.query("SET SESSION session_track_system_variables = 'autocommit'");
  })
  .then(function changeTrackedSystemVariable() {
    return connection.query('SET autocommit = 0');
  })
  .then(function verifySystemVariableTracking(result) {
    var packet = result[0];
    var change = findChange(packet, 'system_variables');

    assert.ok(change, 'SET autocommit must expose a system_variables session-state change');
    assert.strictEqual(change.variable, 'autocommit');
    assert.strictEqual(change.value, 'OFF');
    assert.deepStrictEqual(change.values, ['autocommit', 'OFF']);

    var snapshot = connection.sessionStateSnapshot();
    assert.strictEqual(snapshot.systemVariables.autocommit, 'OFF');
    assert.ok(snapshot.version > 0);

    return connection.query('SET autocommit = 1');
  })
  .then(function switchSchema() {
    return connection.query('USE information_schema');
  })
  .then(function verifySchemaTracking(result) {
    var packet = result[0];
    var change = findChange(packet, 'schema');

    assert.ok(change, 'USE must expose a schema session-state change');
    assert.strictEqual(change.value, 'information_schema');
    assert.strictEqual(connection.sessionStateSnapshot().schema, 'information_schema');

    return connection.query('USE ' + connection.escapeId(config.database));
  })
  .then(function verifyReturnSchema(result) {
    var packet = result[0];
    var change = findChange(packet, 'schema');

    assert.ok(change, 'returning to the configured schema must be tracked');
    assert.strictEqual(change.value, config.database);

    var snapshot = connection.sessionStateSnapshot();
    assert.strictEqual(snapshot.schema, config.database);
    assert.strictEqual(snapshot.systemVariables.autocommit, 'ON');

    return connection.resetConnection({operationTimeout: 5000});
  })
  .then(function verifyResetLedgerBaseline() {
    var snapshot = connection.sessionStateSnapshot();

    assert.strictEqual(snapshot.version, 0);
    assert.strictEqual(snapshot.schema, config.database);
    assert.deepStrictEqual(Object.keys(snapshot.systemVariables), []);
    assert.strictEqual(snapshot.transactionState, null);
    return connection.end();
  })
  .catch(function fail(error) {
    connection.query('SET autocommit = 1')
      .catch(function ignoreRestoreError() {})
      .then(function closeAfterFailure() {
        return connection.end().catch(function ignoreEndError() {});
      })
      .then(function rethrowFailure() {
        process.nextTick(function throwFailure() {
          throw error;
        });
      });
  });

function findChange(packet, name) {
  assert.ok(packet && Array.isArray(packet.sessionStateChanges), 'OK packet must expose sessionStateChanges');

  for (var i = 0; i < packet.sessionStateChanges.length; i++) {
    if (packet.sessionStateChanges[i].name === name) {
      return packet.sessionStateChanges[i];
    }
  }

  return null;
}
