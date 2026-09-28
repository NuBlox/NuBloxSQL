var assert = require('assert');
var common = require('../../common');

var cipher = 'ECDHE-RSA-AES128-GCM-SHA256';
var server = common.createFakeServer({
  ssl: {
    ciphers    : cipher,
    minVersion : 'TLSv1.2',
    maxVersion : 'TLSv1.2'
  }
});

server.listen(0, function (err) {
  assert.ifError(err);

  var connection = common.createConnection({
    port : server.port(),
    ssl  : {
      ca         : common.getSSLConfig().ca,
      ciphers    : cipher,
      minVersion : 'TLSv1.2',
      maxVersion : 'TLSv1.2'
    }
  });

  connection.query('SHOW STATUS LIKE \'Ssl_cipher\';', function (err, rows) {
    assert.ifError(err);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Variable_name, 'Ssl_cipher');
    assert.equal(rows[0].Value, cipher);

    connection.destroy();
    server.destroy();
  });
});

server.on('connection', function (incomingConnection) {
  incomingConnection.handshake({
    serverCapabilities1: common.ClientConstants.CLIENT_SSL
  });
});
