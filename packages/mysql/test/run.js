var fs         = require('fs');
var os         = require('os');
var path       = require('path');
var selfsigned = require('selfsigned');
var urun       = require('urun');

var options = {};
var tlsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-mysql-tls-'));
var notAfterDate = new Date();

notAfterDate.setFullYear(notAfterDate.getFullYear() + 2);

process.on('exit', function () {
  fs.rmSync(tlsDirectory, {force: true, recursive: true});
});

if (process.env.FILTER) {
  options.include = new RegExp(process.env.FILTER + '.*\\.js$');
}

options.reporter = 'BashTapReporter';
options.verbose  = process.env.VERBOSE
  ? Boolean(JSON.parse(process.env.VERBOSE))
  : true;

selfsigned.generate([
  {name: 'commonName', value: 'localhost'}
], {
  algorithm    : 'sha256',
  keySize      : 2048,
  notAfterDate : notAfterDate,
  extensions   : [{
    name     : 'subjectAltName',
    altNames : [
      {type: 2, value: 'localhost'},
      {type: 7, ip: '127.0.0.1'}
    ]
  }]
}).then(function (pems) {
  fs.writeFileSync(path.join(tlsDirectory, 'server.crt'), pems.cert);
  fs.writeFileSync(path.join(tlsDirectory, 'server.key'), pems.private);
  process.env.NUBLOX_MYSQL_TEST_TLS_DIR = tlsDirectory;
  urun(__dirname, options);
}).catch(function (err) {
  process.nextTick(function () {
    throw err;
  });
});
