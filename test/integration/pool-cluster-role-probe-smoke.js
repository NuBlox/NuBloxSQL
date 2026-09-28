'use strict';

var assert = require('assert');
var mysql = require('../..');

var baseConfig = {
  host     : process.env.MYSQL_HOST || '127.0.0.1',
  port     : Number(process.env.MYSQL_PORT || 3306),
  user     : process.env.MYSQL_USER || 'nublox',
  password : process.env.MYSQL_PASSWORD || 'nublox_ci_password',
  database : process.env.MYSQL_DATABASE || 'nublox_ci'
};

var cluster = mysql.createPoolCluster();
cluster.add('MYSQL', baseConfig, {
  replicationState : 'unknown',
  tags             : {source: 'live-smoke'}
});

mysql.probePoolClusterRoles(cluster)
  .then(function(topology) {
    assert.strictEqual(topology.length, 1);
    assert.strictEqual(topology[0].id, 'MYSQL');
    assert.strictEqual(topology[0].role, 'writable');
    assert.strictEqual(topology[0].replicationState, 'unknown');
    assert.strictEqual(topology[0].tags.source, 'live-smoke');
    assert.strictEqual(topology[0].tags.mysqlReadOnly, false);
    assert.strictEqual(topology[0].tags.mysqlSuperReadOnly, false);
    assert.strictEqual(topology[0].tags.mysqlWritable, true);

    return endCluster(cluster);
  })
  .catch(function(error) {
    endCluster(cluster).then(function() {
      process.nextTick(function() {
        throw error;
      });
    });
  });

function endCluster(value) {
  return new global.Promise(function(resolve, reject) {
    value.end(function(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
