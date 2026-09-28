var assert = require('assert');
var common = require('../../common');

var providerCalls = 0;
var resolveProvider;
var cluster = common.createPoolCluster({
  topologyProvider: function topologyProvider(current) {
    providerCalls++;
    assert.ok(Object.isFrozen(current));
    assert.ok(Object.isFrozen(current[0]));
    assert.ok(Object.isFrozen(current[0].tags));

    return new global.Promise(function(resolve) {
      resolveProvider = resolve;
    });
  }
});

var poolConfig = common.getTestConfig();
cluster.add('PRIMARY', poolConfig, {role: 'unknown'});
cluster.add('REPLICA', poolConfig, {role: 'unknown'});

var firstRefresh = cluster.refreshTopology();
var secondRefresh = cluster.refreshTopology();
assert.strictEqual(firstRefresh, secondRefresh);
assert.strictEqual(providerCalls, 0);

setImmediate(function() {
  assert.strictEqual(providerCalls, 1);

  resolveProvider([
    {id: 'PRIMARY', role: 'primary', replicationState: 'online', priority: 100},
    {id: 'REPLICA', role: 'replica', replicationState: 'online', priority: 50}
  ]);
});

firstRefresh.then(function(topology) {
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(topology[0].role, 'primary');
  assert.strictEqual(topology[1].role, 'replica');
  assert.strictEqual(cluster.topology()[0].priority, 100);

  var callbackCalled = false;
  cluster._topologyProvider = function callbackProvider() {
    return [{id: 'REPLICA', replicationState: 'lagging'}];
  };

  return cluster.refreshTopology(function(err, refreshed) {
    assert.ifError(err);
    callbackCalled = true;
    assert.strictEqual(refreshed[1].replicationState, 'lagging');
  }).then(function() {
    assert.strictEqual(callbackCalled, true);
  });
}).then(function() {
  var before = cluster.topology();
  cluster._topologyProvider = function invalidProvider() {
    return [
      {id: 'PRIMARY', role: 'replica'},
      {id: 'MISSING', role: 'primary'}
    ];
  };

  return cluster.refreshTopology().then(function() {
    assert.fail('refresh with unknown node should reject');
  }, function(error) {
    assert.strictEqual(error.code, 'POOL_TOPOLOGY_UNKNOWN_NODE');
    assert.strictEqual(cluster.topology()[0].role, before[0].role);
  });
}).then(function() {
  cluster._topologyProvider = function duplicateProvider() {
    return [{id: 'PRIMARY'}, {id: 'PRIMARY'}];
  };

  return cluster.refreshTopology().then(function() {
    assert.fail('refresh with duplicate nodes should reject');
  }, function(error) {
    assert.match(error.message, /duplicate pool node/);
  });
}).then(function() {
  cluster.end(function(err) {
    assert.ifError(err);
  });
}).catch(function(error) {
  process.nextTick(function() {
    throw error;
  });
});

var missingProvider = common.createPoolCluster();
missingProvider.refreshTopology().then(function() {
  assert.fail('refresh without a provider should reject');
}, function(error) {
  assert.strictEqual(error.code, 'POOL_TOPOLOGY_PROVIDER_MISSING');
  missingProvider.end(function(err) {
    assert.ifError(err);
  });
});

assert.throws(function invalidProviderConfiguration() {
  common.createPoolCluster({topologyProvider: 'dns'});
}, /topologyProvider must be a function/);
