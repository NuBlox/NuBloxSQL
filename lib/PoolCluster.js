var Pool          = require('./Pool');
var PoolConfig    = require('./PoolConfig');
var PoolNamespace = require('./PoolNamespace');
var PoolSelector  = require('./PoolSelector');
var Util          = require('util');
var EventEmitter  = require('events').EventEmitter;

module.exports = PoolCluster;

/**
 * PoolCluster
 * @constructor
 * @param {object} [config] The pool cluster configuration
 * @public
 */
function PoolCluster(config) {
  EventEmitter.call(this);

  config = config || {};
  this._canRetry = typeof config.canRetry === 'undefined' ? true : config.canRetry;
  this._defaultSelector = config.defaultSelector || 'RR';
  this._removeNodeErrorCount = config.removeNodeErrorCount || 5;
  this._restoreNodeTimeout = config.restoreNodeTimeout || 0;
  this._topologyPolicy = normalizeTopologyPolicy(config.topologyPolicy);

  this._closed = false;
  this._findCaches = Object.create(null);
  this._lastId = 0;
  this._namespaces = Object.create(null);
  this._nodes = Object.create(null);
}

Util.inherits(PoolCluster, EventEmitter);

PoolCluster.prototype.add = function add(id, config, metadata) {
  if (this._closed) {
    throw new Error('PoolCluster is closed.');
  }

  var anonymous = typeof id === 'object';
  var nodeId = anonymous
    ? 'CLUSTER::' + (++this._lastId)
    : String(id);

  if (this._nodes[nodeId] !== undefined) {
    throw new Error('Node ID "' + nodeId + '" is already defined in PoolCluster.');
  }

  var poolConfig = anonymous
    ? new PoolConfig(id)
    : new PoolConfig(config);
  var topology = anonymous
    ? normalizeTopologyMetadata(config)
    : normalizeTopologyMetadata(metadata);

  this._nodes[nodeId] = {
    id            : nodeId,
    errorCount    : 0,
    pool          : new Pool({config: poolConfig}),
    topology      : topology,
    _offlineUntil : 0
  };

  this._clearFindCaches();
  this.emit('topology', this.topology());
};

PoolCluster.prototype.end = function end(callback) {
  var cb = callback !== undefined
    ? callback
    : _cb;

  if (typeof cb !== 'function') {
    throw TypeError('callback argument must be a function');
  }

  if (this._closed) {
    process.nextTick(cb);
    return;
  }

  this._closed = true;

  var calledBack   = false;
  var nodeIds      = Object.keys(this._nodes);
  var waitingClose = 0;

  function onEnd(err) {
    if (!calledBack && (err || --waitingClose <= 0)) {
      calledBack = true;
      cb(err);
    }
  }

  for (var i = 0; i < nodeIds.length; i++) {
    var nodeId = nodeIds[i];
    var node = this._nodes[nodeId];

    waitingClose++;
    node.pool.end(onEnd);
  }

  if (waitingClose === 0) {
    process.nextTick(onEnd);
  }
};

PoolCluster.prototype.of = function(pattern, selector) {
  pattern = pattern || '*';

  selector = selector || this._defaultSelector;
  selector = selector.toUpperCase();
  if (typeof PoolSelector[selector] === 'undefined') {
    selector = this._defaultSelector;
  }

  var key = pattern + selector;

  if (typeof this._namespaces[key] === 'undefined') {
    this._namespaces[key] = new PoolNamespace(this, pattern, selector);
  }

  return this._namespaces[key];
};

PoolCluster.prototype.remove = function remove(pattern) {
  var foundNodeIds = this._findNodeIds(pattern, true);

  for (var i = 0; i < foundNodeIds.length; i++) {
    var node = this._getNode(foundNodeIds[i]);

    if (node) {
      this._removeNode(node);
    }
  }
};

PoolCluster.prototype.getConnection = function(pattern, selector, cb) {
  var namespace;
  if (typeof pattern === 'function') {
    cb = pattern;
    namespace = this.of();
  } else {
    if (typeof selector === 'function') {
      cb = selector;
      selector = this._defaultSelector;
    }

    namespace = this.of(pattern, selector);
  }

  namespace.getConnection(cb);
};

PoolCluster.prototype.setNodeMetadata = function setNodeMetadata(id, metadata) {
  var node = this._getNode(String(id));

  if (!node) {
    var err = new Error('Pool node "' + id + '" does not exist.');
    err.code = 'POOL_NOEXIST';
    throw err;
  }

  node.topology = mergeTopologyMetadata(node.topology, metadata);
  this.emit('topology', this.topology());
  return this;
};

PoolCluster.prototype.topology = function topology() {
  var self = this;

  return Object.keys(this._nodes).map(function mapNode(nodeId) {
    return self._snapshotNode(self._nodes[nodeId]);
  });
};

PoolCluster.prototype._clearFindCaches = function _clearFindCaches() {
  this._findCaches = Object.create(null);
};

PoolCluster.prototype._decreaseErrorCount = function _decreaseErrorCount(node) {
  var errorCount = node.errorCount;

  if (errorCount > this._removeNodeErrorCount) {
    errorCount = this._removeNodeErrorCount;
  }

  if (errorCount < 1) {
    errorCount = 1;
  }

  node.errorCount = errorCount - 1;

  if (node._offlineUntil) {
    node._offlineUntil = 0;
    this.emit('online', node.id);
    this.emit('topology', this.topology());
  }
};

PoolCluster.prototype._findNodeIds = function _findNodeIds(pattern, includeOffline) {
  var currentTime  = 0;
  var foundNodeIds = this._findCaches[pattern];

  if (foundNodeIds === undefined) {
    var expression = patternRegExp(pattern);
    var nodeIds    = Object.keys(this._nodes);

    foundNodeIds = nodeIds.filter(function (id) {
      return id.match(expression);
    });

    this._findCaches[pattern] = foundNodeIds;
  }

  if (includeOffline) {
    return foundNodeIds;
  }

  return foundNodeIds.filter(function (nodeId) {
    var node = this._getNode(nodeId);

    if (!node._offlineUntil) {
      return true;
    }

    if (!currentTime) {
      currentTime = getMonotonicMilliseconds();
    }

    return node._offlineUntil <= currentTime;
  }, this);
};

PoolCluster.prototype._getNode = function _getNode(id) {
  return this._nodes[id] || null;
};

PoolCluster.prototype._selectNode = function _selectNode(pattern, selector, context) {
  var foundNodeIds = this._findNodeIds(pattern);
  var nodeId = null;

  if (foundNodeIds.length === 0) {
    return null;
  }

  if (this._topologyPolicy) {
    var self = this;
    var candidates = foundNodeIds.map(function mapCandidate(id) {
      return self._snapshotNode(self._getNode(id));
    });
    var selection = this._topologyPolicy(candidates, copySelectionContext(context, pattern));

    if (selection !== undefined && selection !== null) {
      nodeId = typeof selection === 'object' && selection.id !== undefined
        ? String(selection.id)
        : String(selection);

      if (foundNodeIds.indexOf(nodeId) === -1) {
        var err = new Error('Topology policy selected an unavailable pool node: ' + nodeId);
        err.code = 'POOL_TOPOLOGY_INVALID_SELECTION';
        throw err;
      }
    }
  }

  if (nodeId === null) {
    nodeId = foundNodeIds.length === 1
      ? foundNodeIds[0]
      : selector(foundNodeIds);
  }

  return this._getNode(nodeId);
};

PoolCluster.prototype._snapshotNode = function _snapshotNode(node) {
  if (!node) {
    return null;
  }

  var config = node.pool.config.connectionConfig;
  var now = getMonotonicMilliseconds();
  var offlineUntil = node._offlineUntil || 0;

  return Object.freeze({
    id               : node.id,
    host             : config.host,
    port             : config.port,
    socketPath       : config.socketPath,
    online           : !offlineUntil || offlineUntil <= now,
    offlineUntil     : offlineUntil,
    errorCount       : node.errorCount,
    role             : node.topology.role,
    replicationState : node.topology.replicationState,
    priority         : node.topology.priority,
    weight           : node.topology.weight,
    tags             : copyObject(node.topology.tags)
  });
};

PoolCluster.prototype._increaseErrorCount = function _increaseErrorCount(node) {
  var errorCount = ++node.errorCount;

  if (this._removeNodeErrorCount > errorCount) {
    return;
  }

  if (this._restoreNodeTimeout > 0) {
    node._offlineUntil = getMonotonicMilliseconds() + this._restoreNodeTimeout;
    this.emit('offline', node.id);
    this.emit('topology', this.topology());
    return;
  }

  this._removeNode(node);
  this.emit('remove', node.id);
};

PoolCluster.prototype._getConnection = function(node, cb) {
  var self = this;

  node.pool.getConnection(function (err, connection) {
    if (err) {
      self._increaseErrorCount(node);
      cb(err);
      return;
    } else {
      self._decreaseErrorCount(node);
    }

    connection._clusterId = node.id;

    cb(null, connection);
  });
};

PoolCluster.prototype._removeNode = function _removeNode(node) {
  delete this._nodes[node.id];

  this._clearFindCaches();

  node.pool.end(_noop);
  this.emit('topology', this.topology());
};

function normalizeTopologyPolicy(value) {
  if (value === undefined || value === null || value === false) {
    return null;
  }

  if (typeof value !== 'function') {
    throw new TypeError('topologyPolicy must be a function');
  }

  return value;
}

function normalizeTopologyMetadata(value) {
  value = value || {};

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('pool node topology metadata must be an object');
  }

  return {
    role             : normalizeMetadataString(value.role, 'unknown'),
    replicationState : normalizeMetadataString(value.replicationState, 'unknown'),
    priority         : normalizeFiniteNumber(value.priority, 0, 'priority'),
    weight           : normalizeFiniteNumber(value.weight, 1, 'weight'),
    tags             : normalizeTags(value.tags)
  };
}

function mergeTopologyMetadata(current, update) {
  if (update === undefined || update === null) {
    return current;
  }

  if (typeof update !== 'object' || Array.isArray(update)) {
    throw new TypeError('pool node topology metadata must be an object');
  }

  return {
    role             : update.role === undefined
      ? current.role
      : normalizeMetadataString(update.role, 'unknown'),
    replicationState : update.replicationState === undefined
      ? current.replicationState
      : normalizeMetadataString(update.replicationState, 'unknown'),
    priority         : update.priority === undefined
      ? current.priority
      : normalizeFiniteNumber(update.priority, 0, 'priority'),
    weight           : update.weight === undefined
      ? current.weight
      : normalizeFiniteNumber(update.weight, 1, 'weight'),
    tags             : update.tags === undefined
      ? current.tags
      : normalizeTags(update.tags)
  };
}

function normalizeMetadataString(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value).toLowerCase();
}

function normalizeFiniteNumber(value, fallback, name) {
  if (value === undefined || value === null) {
    return fallback;
  }

  var number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError('pool node topology ' + name + ' must be a finite number');
  }

  return number;
}

function normalizeTags(value) {
  if (value === undefined || value === null) {
    return Object.create(null);
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('pool node topology tags must be an object');
  }

  return copyObject(value);
}

function copySelectionContext(context, pattern) {
  var copy = copyObject(context || {});
  copy.pattern = pattern;
  return Object.freeze(copy);
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

function getMonotonicMilliseconds() {
  var ms;

  if (typeof process.hrtime === 'function') {
    ms = process.hrtime();
    ms = ms[0] * 1e3 + ms[1] * 1e-6;
  } else {
    ms = process.uptime() * 1000;
  }

  return Math.floor(ms);
}

function isRegExp(val) {
  return typeof val === 'object'
    && Object.prototype.toString.call(val) === '[object RegExp]';
}

function patternRegExp(pattern) {
  if (isRegExp(pattern)) {
    return pattern;
  }

  var source = pattern
    .replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1')
    .replace(/\*/g, '.*');

  return new RegExp('^' + source + '$');
}

function _cb(err) {
  if (err) {
    throw err;
  }
}

function _noop() {}
