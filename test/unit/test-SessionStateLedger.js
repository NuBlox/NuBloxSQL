'use strict';

var assert = require('assert');
var Events = require('events');
var SessionStateLedger = require('../../lib/SessionStateLedger');

(function testLedgerApplyAndSnapshotIsolation() {
  var ledger = new SessionStateLedger({database: 'configured_db'});

  assert.deepStrictEqual(normalize(ledger.snapshot()), normalize({
    version                    : 0,
    schema                     : 'configured_db',
    systemVariables            : {},
    stateChanged               : null,
    gtids                      : null,
    gtidEncoding               : null,
    transactionCharacteristics : null,
    transactionState           : null,
    unknown                    : []
  }));

  ledger.apply([
    {name: 'system_variables', variable: 'autocommit', value: 'OFF'},
    {name: 'schema', value: 'runtime_db'},
    {name: 'state_change', value: '1'},
    {name: 'gtids', value: 'uuid:1', encoding: 0},
    {name: 'transaction_characteristics', value: 'START TRANSACTION READ ONLY;'},
    {name: 'transaction_state', value: 'T_______'},
    {name: 'unknown', type: 99, data: Buffer.from([1, 2, 3])}
  ]);

  var snapshot = ledger.snapshot();
  assert.strictEqual(snapshot.version, 1);
  assert.strictEqual(snapshot.schema, 'runtime_db');
  assert.strictEqual(snapshot.systemVariables.autocommit, 'OFF');
  assert.strictEqual(snapshot.stateChanged, '1');
  assert.strictEqual(snapshot.gtids, 'uuid:1');
  assert.strictEqual(snapshot.gtidEncoding, 0);
  assert.strictEqual(snapshot.transactionCharacteristics, 'START TRANSACTION READ ONLY;');
  assert.strictEqual(snapshot.transactionState, 'T_______');
  assert.deepStrictEqual(Array.from(snapshot.unknown[0].data), [1, 2, 3]);

  snapshot.systemVariables.autocommit = 'MUTATED';
  snapshot.unknown[0].data[0] = 255;

  var isolated = ledger.snapshot();
  assert.strictEqual(isolated.systemVariables.autocommit, 'OFF');
  assert.deepStrictEqual(Array.from(isolated.unknown[0].data), [1, 2, 3]);

  ledger.reset();
  var reset = ledger.snapshot();
  assert.strictEqual(reset.version, 0);
  assert.strictEqual(reset.schema, 'configured_db');
  assert.deepStrictEqual(Object.keys(reset.systemVariables), []);
})();

(function testConnectionDecoration() {
  var protocol = new Events.EventEmitter();
  var connection = new Events.EventEmitter();
  connection.config = {database: 'nublox_ci'};
  connection._protocol = protocol;
  connection.resetConnection = function resetConnection(options, callback) {
    callback(null, {fieldCount: 0});
    return this;
  };

  SessionStateLedger.decorateConnection(connection);

  protocol.emit('session-state', [
    {name: 'schema', value: 'information_schema'},
    {name: 'system_variables', variable: 'autocommit', value: 'OFF'}
  ]);

  var snapshot = connection.sessionStateSnapshot();
  assert.strictEqual(snapshot.schema, 'information_schema');
  assert.strictEqual(snapshot.systemVariables.autocommit, 'OFF');

  var emitted;
  connection.once('sessionStateChange', function onChange(changes, current) {
    emitted = {changes: changes, current: current};
  });
  protocol.emit('session-state', [{name: 'schema', value: 'second_db'}]);
  assert.strictEqual(emitted.current.schema, 'second_db');

  connection.resetConnection(function onReset(error) {
    assert.ifError(error);
  });

  var reset = connection.sessionStateSnapshot();
  assert.strictEqual(reset.schema, 'nublox_ci');
  assert.strictEqual(reset.version, 0);
  assert.deepStrictEqual(Object.keys(reset.systemVariables), []);
})();

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}
