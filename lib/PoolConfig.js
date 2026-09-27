
var ConnectionConfig = require('./ConnectionConfig');

module.exports = PoolConfig;
function PoolConfig(options) {
  if (typeof options === 'string') {
    options = ConnectionConfig.parseUrl(options);
  }

  options = options || {};

  this.acquireTimeout     = (options.acquireTimeout === undefined)
    ? 10 * 1000
    : Number(options.acquireTimeout);
  this.connectionConfig   = new ConnectionConfig(options);
  this.waitForConnections = (options.waitForConnections === undefined)
    ? true
    : Boolean(options.waitForConnections);
  this.connectionLimit    = (options.connectionLimit === undefined)
    ? 10
    : Number(options.connectionLimit);
  this.queueLimit         = (options.queueLimit === undefined)
    ? 0
    : Number(options.queueLimit);
  this.minimumIdle        = normalizeMinimumIdle(options.minimumIdle, this.connectionLimit);
  this.maintainMinimumIdle = options.maintainMinimumIdle === true;
  this.minimumIdleRetryDelayMs = normalizeRetryDelay(
    options.minimumIdleRetryDelayMs,
    250,
    'minimumIdleRetryDelayMs'
  );
  this.minimumIdleMaxRetryDelayMs = normalizeRetryDelay(
    options.minimumIdleMaxRetryDelayMs,
    10000,
    'minimumIdleMaxRetryDelayMs'
  );
  this.minimumIdleRetryJitter = normalizeRetryJitter(options.minimumIdleRetryJitter);

  if (this.minimumIdleMaxRetryDelayMs < this.minimumIdleRetryDelayMs) {
    throw new RangeError('minimumIdleMaxRetryDelayMs cannot be less than minimumIdleRetryDelayMs');
  }
}

PoolConfig.prototype.newConnectionConfig = function newConnectionConfig() {
  var connectionConfig = new ConnectionConfig(this.connectionConfig);

  connectionConfig.clientFlags   = this.connectionConfig.clientFlags;
  connectionConfig.maxPacketSize = this.connectionConfig.maxPacketSize;

  return connectionConfig;
};

function normalizeMinimumIdle(value, connectionLimit) {
  if (value === undefined) {
    return 0;
  }

  var minimumIdle = Number(value);
  if (!Number.isInteger(minimumIdle) || minimumIdle < 0) {
    throw new TypeError('minimumIdle must be a non-negative integer');
  }

  if (connectionLimit > 0 && minimumIdle > connectionLimit) {
    throw new RangeError('minimumIdle cannot exceed connectionLimit');
  }

  return minimumIdle;
}

function normalizeRetryDelay(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  var delay = Number(value);
  if (!Number.isInteger(delay) || delay < 1) {
    throw new TypeError(name + ' must be a positive integer');
  }

  return delay;
}

function normalizeRetryJitter(value) {
  if (value === undefined) {
    return 0.2;
  }

  var jitter = Number(value);
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new RangeError('minimumIdleRetryJitter must be a number from 0 to 1');
  }

  return jitter;
}
