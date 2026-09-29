'use strict';

var net = require('net');
var tls = require('tls');
var protocol = require('./protocol');

function normalizeSsl(ssl) {
  if (ssl === false || ssl === 'disable') return { mode: 'disable', options: null };
  if (ssl === true || ssl === 'require') return { mode: 'require', options: {} };
  if (ssl && typeof ssl === 'object') return { mode: ssl.mode || 'require', options: ssl };
  return { mode: 'prefer', options: null };
}

function sendCancelRequest(config, backendKeyData, options) {
  options = options || {};
  if (!backendKeyData || !Number.isInteger(backendKeyData.processId) || !backendKeyData.secretKey) {
    return Promise.reject(new Error('PostgreSQL cancellation requires BackendKeyData'));
  }
  var timeout = options.timeout === undefined ? (config.cancelTimeout === undefined ? 5000 : config.cancelTimeout) : options.timeout;
  if (!Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new RangeError('PostgreSQL cancel timeout must be a positive number'));

  var request;
  try { request = protocol.encodeCancelRequest(backendKeyData.processId, backendKeyData.secretKey); }
  catch (error) { return Promise.reject(error); }

  return new Promise(function (resolve, reject) {
    var settled = false;
    var raw = net.createConnection({ host: config.host || '127.0.0.1', port: config.port || 5432 });
    var active = raw;
    var ssl = normalizeSsl(config.ssl);
    var timer = setTimeout(function () { finish(new Error('PostgreSQL cancel request timed out')); }, timeout);
    if (timer.unref) timer.unref();

    function cleanup() {
      clearTimeout(timer);
      if (active) active.removeListener('error', onError);
      if (raw && raw !== active) raw.removeListener('error', onError);
    }
    function finish(error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        try { active.destroy(); } catch (destroyError) {}
        reject(error);
      } else {
        resolve();
      }
    }
    function onError(error) { finish(error); }
    function dispatch(socket) {
      active = socket;
      socket.once('error', onError);
      socket.end(request, function () { finish(); });
    }

    raw.once('error', onError);
    raw.once('connect', function () {
      if (ssl.mode === 'disable') {
        raw.removeListener('error', onError);
        dispatch(raw);
        return;
      }
      raw.write(protocol.encodeSSLRequest());
      raw.once('data', function (chunk) {
        if (!chunk.length) return finish(new Error('Invalid PostgreSQL cancel SSL negotiation response'));
        var response = String.fromCharCode(chunk[0]);
        if (response === 'S') {
          raw.removeListener('error', onError);
          var tlsOptions = Object.assign({}, ssl.options || {}, {
            socket: raw,
            servername: (ssl.options && ssl.options.servername) || config.host || '127.0.0.1'
          });
          delete tlsOptions.mode;
          var secure = tls.connect(tlsOptions, function () { dispatch(secure); });
          active = secure;
          secure.once('error', onError);
          return;
        }
        if (response === 'N' && ssl.mode !== 'require') {
          raw.removeListener('error', onError);
          dispatch(raw);
          return;
        }
        finish(new Error(response === 'N' ? 'PostgreSQL server refused TLS for cancel request' : 'Invalid PostgreSQL cancel SSL negotiation response'));
      });
    });
  });
}

exports.sendCancelRequest = sendCancelRequest;
exports.normalizeSsl = normalizeSsl;
