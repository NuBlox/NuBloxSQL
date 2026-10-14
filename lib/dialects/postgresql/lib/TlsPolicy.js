'use strict';

// Central PostgreSQL transport policy shared by connection and cancellation.
// Unknown or misspelled modes must never become plaintext fallback.
function normalizeSsl(ssl) {
  if (ssl === false || ssl === 'disable') return { mode: 'disable', options: null };
  if (ssl === true || ssl === 'require') return { mode: 'require', options: {} };
  if (ssl === undefined || ssl === null || ssl === 'prefer') {
    return { mode: 'prefer', options: null };
  }
  if (ssl && typeof ssl === 'object' && !Array.isArray(ssl)) {
    var mode = ssl.mode === undefined ? 'require' : ssl.mode;
    if (mode !== 'disable' && mode !== 'prefer' && mode !== 'require') {
      throw new TypeError('Invalid PostgreSQL ssl.mode: expected disable, prefer or require');
    }
    return { mode: mode, options: ssl };
  }
  throw new TypeError('Invalid PostgreSQL ssl option: expected a boolean, TLS mode or options object');
}

// An explicit TLS peer name must not be overwritten by a proxy/TCP endpoint.
// The caller owns the transport socket regardless of supplied options.
function tlsConnectOptions(ssl, socket, hostname) {
  var options = Object.assign({}, ssl.options || {});
  delete options.mode;
  options.socket = socket;
  if (options.servername === undefined) options.servername = hostname;
  return options;
}

exports.normalizeSsl = normalizeSsl;
exports.tlsConnectOptions = tlsConnectOptions;
