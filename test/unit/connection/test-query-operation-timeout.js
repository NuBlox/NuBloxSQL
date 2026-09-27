'use strict';

var assert = require('assert');
var common = require('../../common');

var server = common.createFakeServer();
var timer = setTimeout(function () {
  throw new Error('test timeout');
}, 2000);

server.listen(0, function (err) {
  assert.ifError(err);

  var connection = common.createConnection({port: server.port()});

  connection.query({sql: 'SELECT 1', operationTimeout: 200}, function (queryError) {
    assert.ok(queryError);
    assert.equal(queryError.code, 'PROTOCOL_OPERATION_TIMEOUT');
    assert.equal(queryError.fatal, true);
    assert.equal(queryError.message, 'Query operation timeout');
    assert.equal(queryError.operationTimeout, 200);
  });
});

server.on('connection', function(conn) {
  conn.handshake();
  conn._socket.on('close', function() {
    clearTimeout(timer);
    server.destroy();
  });
  conn.on('query', function () {
    // Deliberately never complete the operation.
  });
});
