var assert = require('assert');
var RoleProbe = require('../../lib/MySQLRoleProbe');

var released = 0;
var applied = [];
var cluster = createCluster({
  WRITABLE : {readOnly: 0, superReadOnly: 0},
  READONLY : {readOnly: 'ON', superReadOnly: 'OFF'}
});

RoleProbe.probe(cluster).then(function(topology) {
  assert.strictEqual(released, 2);
  assert.strictEqual(applied.length, 2);
  assert.strictEqual(topology[0].role, 'writable');
  assert.strictEqual(topology[0].replicationState, 'unknown');
  assert.strictEqual(topology[0].tags.region, 'uk');
  assert.strictEqual(topology[0].tags.mysqlReadOnly, false);
  assert.strictEqual(topology[0].tags.mysqlSuperReadOnly, false);
  assert.strictEqual(topology[0].tags.mysqlWritable, true);
  assert.strictEqual(topology[1].role, 'read-only');
  assert.strictEqual(topology[1].tags.mysqlReadOnly, true);
  assert.strictEqual(topology[1].tags.mysqlWritable, false);

  var callbackCalled = false;
  return RoleProbe.probe(cluster, function(error, callbackTopology) {
    assert.ifError(error);
    callbackCalled = true;
    assert.strictEqual(callbackTopology[0].role, 'writable');
  }).then(function() {
    assert.strictEqual(callbackCalled, true);
  });
}).then(function() {
  var atomicApplied = 0;
  var failingCluster = createCluster({
    WRITABLE : {readOnly: 0, superReadOnly: 0},
    READONLY : new Error('probe failed')
  }, function() {
    atomicApplied++;
  });

  return RoleProbe.probe(failingCluster).then(function() {
    assert.fail('probe should reject when any node fails');
  }, function(error) {
    assert.strictEqual(error.message, 'probe failed');
    assert.strictEqual(atomicApplied, 0);
  });
}).then(function() {
  var invalidBooleanCluster = createCluster({
    WRITABLE : {readOnly: 'MAYBE', superReadOnly: 0},
    READONLY : {readOnly: 0, superReadOnly: 0}
  });

  return RoleProbe.probe(invalidBooleanCluster).then(function() {
    assert.fail('invalid boolean should reject');
  }, function(error) {
    assert.strictEqual(error.code, 'POOL_TOPOLOGY_ROLE_PROBE_INVALID_BOOLEAN');
  });
}).catch(function(error) {
  process.nextTick(function() {
    throw error;
  });
});

assert.throws(function invalidCluster() {
  RoleProbe.probe({});
}, /PoolCluster/);

assert.throws(function invalidCallback() {
  RoleProbe.probe(cluster, 'callback');
}, /callback argument/);

function createCluster(responses, onApply) {
  var snapshots = [
    createSnapshot('WRITABLE'),
    createSnapshot('READONLY')
  ];

  return {
    topology: function topology() {
      return snapshots.map(function copySnapshot(snapshot) {
        return {
          id               : snapshot.id,
          role             : snapshot.role,
          replicationState : snapshot.replicationState,
          tags             : copyObject(snapshot.tags)
        };
      });
    },
    getConnection: function getConnection(id, selector, callback) {
      assert.strictEqual(selector, 'ORDER');
      var response = responses[id];

      callback(null, {
        query: function query(sql, queryCallback) {
          assert.match(sql, /@@GLOBAL\.read_only/);
          assert.match(sql, /@@GLOBAL\.super_read_only/);

          if (response instanceof Error) {
            queryCallback(response);
            return;
          }

          queryCallback(null, [response]);
        },
        release: function release() {
          released++;
        }
      });
    },
    setNodeMetadata: function setNodeMetadata(id, metadata) {
      if (onApply) {
        onApply(id, metadata);
      } else {
        applied.push({id: id, metadata: metadata});
      }

      var snapshot = snapshots.filter(function findSnapshot(item) {
        return item.id === id;
      })[0];

      snapshot.role = metadata.role || snapshot.role;
      snapshot.tags = metadata.tags || snapshot.tags;
      return this;
    }
  };
}

function createSnapshot(id) {
  return {
    id               : id,
    role             : 'unknown',
    replicationState : 'unknown',
    tags             : {region: 'uk'}
  };
}

function copyObject(value) {
  var copy = {};

  for (var key in value) {
    copy[key] = value[key];
  }

  return copy;
}
