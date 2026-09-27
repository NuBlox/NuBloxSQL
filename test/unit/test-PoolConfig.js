var assert     = require('assert');
var common     = require('../common');
var test       = require('utest');
var PoolConfig = common.PoolConfig;

test('PoolConfig#Constructor', {
  'works with combined object': function() {
    var config = new PoolConfig({
      connectionLimit : 2,
      host            : 'remote',
      port            : 3333
    });

    assert.ok(config.connectionConfig);
    assert.equal(config.connectionConfig.host, 'remote');
    assert.equal(config.connectionConfig.port, 3333);
    assert.equal(config.connectionLimit, 2);
  },

  'works with connection string': function() {
    var url    = 'mysql://myhost:3333/mydb?debug=true&charset=BIG5_CHINESE_CI';
    var config = new PoolConfig(url);

    assert.ok(config.connectionConfig);
    assert.equal(config.connectionConfig.host, 'myhost');
    assert.equal(config.connectionConfig.port, 3333);
    assert.equal(config.connectionConfig.database, 'mydb');
    assert.equal(config.connectionConfig.debug, true);
    assert.equal(config.connectionConfig.charsetNumber, common.Charsets.BIG5_CHINESE_CI);
  },

  'connection string can configure pool': function() {
    var url    = 'mysql://myhost:3333/mydb?connectionLimit=2';
    var config = new PoolConfig(url);

    assert.ok(config.connectionConfig);
    assert.equal(config.connectionConfig.host, 'myhost');
    assert.equal(config.connectionConfig.port, 3333);
    assert.equal(config.connectionConfig.database, 'mydb');
    assert.equal(config.connectionLimit, 2);
  }
});

test('PoolConfig#Constructor.acquireTimeout', {
  'defaults to 10 seconds': function() {
    var config = new PoolConfig({});

    assert.equal(config.acquireTimeout, (10 * 1000));
  },

  'undefined uses default': function() {
    var config = new PoolConfig({
      acquireTimeout: undefined
    });

    assert.equal(config.acquireTimeout, (10 * 1000));
  },

  'can set to 0': function() {
    var config = new PoolConfig({
      acquireTimeout: 0
    });

    assert.equal(config.acquireTimeout, 0);
  },

  'can set to custom value': function() {
    var config = new PoolConfig({
      acquireTimeout: 10000
    });

    assert.equal(config.acquireTimeout, 10000);
  }
});

test('PoolConfig#Constructor.minimumIdle', {
  'defaults to zero': function() {
    var config = new PoolConfig({});
    assert.strictEqual(config.minimumIdle, 0);
  },

  'accepts a target within connectionLimit': function() {
    var config = new PoolConfig({connectionLimit: 5, minimumIdle: 3});
    assert.strictEqual(config.minimumIdle, 3);
  },

  'accepts a target with an unlimited pool': function() {
    var config = new PoolConfig({connectionLimit: 0, minimumIdle: 20});
    assert.strictEqual(config.minimumIdle, 20);
  },

  'rejects negative and fractional targets': function() {
    assert.throws(function() {
      return new PoolConfig({minimumIdle: -1});
    }, /minimumIdle must be a non-negative integer/);

    assert.throws(function() {
      return new PoolConfig({minimumIdle: 1.5});
    }, /minimumIdle must be a non-negative integer/);
  },

  'rejects a target above connectionLimit': function() {
    assert.throws(function() {
      return new PoolConfig({connectionLimit: 2, minimumIdle: 3});
    }, /minimumIdle cannot exceed connectionLimit/);
  }
});

test('PoolConfig#Constructor.minimumIdleMaintenance', {
  'is disabled by default with bounded retry defaults': function() {
    var config = new PoolConfig({});

    assert.strictEqual(config.maintainMinimumIdle, false);
    assert.strictEqual(config.minimumIdleRetryDelayMs, 250);
    assert.strictEqual(config.minimumIdleMaxRetryDelayMs, 10000);
    assert.strictEqual(config.minimumIdleRetryJitter, 0.2);
  },

  'accepts explicit maintenance policy': function() {
    var config = new PoolConfig({
      maintainMinimumIdle         : true,
      minimumIdleRetryDelayMs     : 100,
      minimumIdleMaxRetryDelayMs  : 2000,
      minimumIdleRetryJitter      : 0.5
    });

    assert.strictEqual(config.maintainMinimumIdle, true);
    assert.strictEqual(config.minimumIdleRetryDelayMs, 100);
    assert.strictEqual(config.minimumIdleMaxRetryDelayMs, 2000);
    assert.strictEqual(config.minimumIdleRetryJitter, 0.5);
  },

  'rejects unsafe retry policy': function() {
    assert.throws(function() {
      return new PoolConfig({minimumIdleRetryDelayMs: 0});
    }, /positive integer/);

    assert.throws(function() {
      return new PoolConfig({minimumIdleRetryJitter: 1.1});
    }, /number from 0 to 1/);

    assert.throws(function() {
      return new PoolConfig({
        minimumIdleRetryDelayMs: 1000,
        minimumIdleMaxRetryDelayMs: 100
      });
    }, /cannot be less than/);
  }
});
