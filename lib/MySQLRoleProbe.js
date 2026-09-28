'use strict';

var PROBE_SQL = 'SELECT @@GLOBAL.read_only AS readOnly, @@GLOBAL.super_read_only AS superReadOnly';

exports.probe = function probe(cluster, callback) {
  if (!cluster || typeof cluster.topology !== 'function' ||
      typeof cluster.getConnection !== 'function' ||
      typeof cluster.setNodeMetadata !== 'function') {
    throw new TypeError('cluster must be a NuBloxSQL PoolCluster');
  }

  if (callback !== undefined && typeof callback !== 'function') {
    throw new TypeError('callback argument must be a function');
  }

  var current = cluster.topology();
  var promise = global.Promise.all(current.map(function mapNode(snapshot) {
    return probeNode(cluster, snapshot);
  })).then(function applyRoleEvidence(updates) {
    for (var i = 0; i < updates.length; i++) {
      cluster.setNodeMetadata(updates[i].id, updates[i].metadata);
    }

    return cluster.topology();
  });

  if (callback !== undefined) {
    promise.then(function onProbe(topology) {
      callback(null, topology);
    }, function onProbeError(error) {
      callback(error);
    });
  }

  return promise;
};

function probeNode(cluster, snapshot) {
  return new global.Promise(function(resolve, reject) {
    cluster.getConnection(snapshot.id, 'ORDER', function onConnection(error, connection) {
      if (error) {
        reject(error);
        return;
      }

      connection.query(PROBE_SQL, function onProbe(error, rows) {
        releaseConnection(connection);

        if (error) {
          reject(error);
          return;
        }

        if (!rows || !rows.length) {
          var emptyError = new Error('MySQL role probe returned no rows for pool node: ' + snapshot.id);
          emptyError.code = 'POOL_TOPOLOGY_ROLE_PROBE_EMPTY';
          emptyError.nodeId = snapshot.id;
          reject(emptyError);
          return;
        }

        var readOnly = parseBoolean(rows[0].readOnly);
        var superReadOnly = parseBoolean(rows[0].superReadOnly);
        var tags = copyObject(snapshot.tags);

        tags.mysqlReadOnly = readOnly;
        tags.mysqlSuperReadOnly = superReadOnly;
        tags.mysqlWritable = !readOnly && !superReadOnly;

        resolve({
          id       : snapshot.id,
          metadata : {
            role : tags.mysqlWritable ? 'writable' : 'read-only',
            tags : tags
          }
        });
      });
    });
  });
}

function parseBoolean(value) {
  if (value === true || value === 1 || value === '1') {
    return true;
  }

  if (value === false || value === 0 || value === '0' || value === null || value === undefined) {
    return false;
  }

  var normalized = String(value).trim().toUpperCase();

  if (normalized === 'ON' || normalized === 'TRUE') {
    return true;
  }

  if (normalized === 'OFF' || normalized === 'FALSE') {
    return false;
  }

  var error = new Error('Unexpected MySQL boolean value in role probe: ' + value);
  error.code = 'POOL_TOPOLOGY_ROLE_PROBE_INVALID_BOOLEAN';
  throw error;
}

function releaseConnection(connection) {
  if (connection && typeof connection.release === 'function') {
    connection.release();
  }
}

function copyObject(value) {
  var copy = {};

  if (!value) {
    return copy;
  }

  for (var key in value) {
    copy[key] = value[key];
  }

  return copy;
}
