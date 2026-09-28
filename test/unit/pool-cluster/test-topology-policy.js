var assert = require('assert');
var common = require('../../common');

var observedContext = null;
var cluster = common.createPoolCluster({
  topologyPolicy: function topologyPolicy(candidates, context) {
    observedContext = context;

    if (context.operation === 'query' && /^\s*select\b/i.test(context.sql || '')) {
      return candidates.filter(function filterReplica(candidate) {
        return candidate.role === 'replica' && candidate.replicationState === 'online';
      })[0].id;
    }

    return candidates.filter(function filterPrimary(candidate) {
      return candidate.role === 'primary';
    })[0].id;
  }
});

var poolConfig = common.getTestConfig();
cluster.add('PRIMARY', poolConfig, {
  role             : 'PRIMARY',
  replicationState : 'ONLINE',
  priority         : 100,
  tags             : {region: 'uk'}
});
cluster.add('REPLICA', poolConfig, {
  role             : 'REPLICA',
  replicationState : 'ONLINE',
  priority         : 50,
  weight           : 2,
  tags             : {region: 'uk'}
});

var topology = cluster.topology();
assert.strictEqual(topology.length, 2);
assert.deepStrictEqual(topology.map(function mapRole(node) { return node.role; }), ['primary', 'replica']);
assert.strictEqual(topology[0].online, true);
assert.strictEqual(topology[0].priority, 100);
assert.strictEqual(topology[1].weight, 2);
assert.strictEqual(topology[0].tags.region, 'uk');
assert.ok(Object.isFrozen(topology[0]));

var namespace = cluster.of('*', 'ORDER');
var readNode = namespace._getClusterNode({operation: 'query', sql: 'SELECT 1'});
assert.strictEqual(readNode.id, 'REPLICA');
assert.strictEqual(observedContext.operation, 'query');
assert.strictEqual(observedContext.pattern, '*');
assert.strictEqual(observedContext.sql, 'SELECT 1');
assert.ok(Object.isFrozen(observedContext));

var writeNode = namespace._getClusterNode({operation: 'query', sql: 'UPDATE t SET n = 1'});
assert.strictEqual(writeNode.id, 'PRIMARY');

cluster.setNodeMetadata('REPLICA', {
  replicationState : 'lagging',
  tags             : {region: 'uk', az: 'b'}
});

topology = cluster.topology();
var replica = topology.filter(function findReplica(node) { return node.id === 'REPLICA'; })[0];
assert.strictEqual(replica.replicationState, 'lagging');
assert.strictEqual(replica.tags.az, 'b');
assert.strictEqual(replica.role, 'replica');

assert.throws(function invalidSelection() {
  var invalidCluster = common.createPoolCluster({
    topologyPolicy: function topologyPolicy() {
      return 'MISSING';
    }
  });

  invalidCluster.add('ONLY', poolConfig, {role: 'primary'});
  invalidCluster.of('*')._getClusterNode({operation: 'connection'});
}, function validate(error) {
  return error && error.code === 'POOL_TOPOLOGY_INVALID_SELECTION';
});

assert.throws(function invalidPolicy() {
  common.createPoolCluster({topologyPolicy: 'primary'});
}, /topologyPolicy must be a function/);

assert.throws(function missingNodeUpdate() {
  cluster.setNodeMetadata('MISSING', {role: 'replica'});
}, function validate(error) {
  return error && error.code === 'POOL_NOEXIST';
});

cluster.end(function(err) {
  assert.ifError(err);
});
