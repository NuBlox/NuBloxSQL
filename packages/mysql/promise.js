var mysql = require('./');

exports.createConnection = function createConnection(config) {
  return mysql.createConnection(config).promise(getPromiseImplementation(config));
};

exports.createPool = function createPool(config) {
  return mysql.createPool(config).promise(getPromiseImplementation(config));
};

exports.escape = mysql.escape;
exports.escapeId = mysql.escapeId;
exports.format = mysql.format;
exports.raw = mysql.raw;
exports.param = mysql.param;

Object.defineProperty(exports, 'Types', {
  get: function getTypes() {
    return mysql.Types;
  }
});

function getPromiseImplementation(config) {
  if (config && typeof config === 'object' && typeof config.Promise === 'function') {
    return config.Promise;
  }

  return global.Promise;
}
