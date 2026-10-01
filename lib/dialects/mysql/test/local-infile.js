'use strict';

var assert = require('assert');
var mysql = require('..');

async function main() {
  assert.strictEqual(mysql.capabilities.localInfile, true);
  assert.strictEqual(typeof mysql.Connection.prototype.loadDataLocal, 'function');
  assert.strictEqual(typeof mysql.Pool.prototype.loadDataLocal, 'function');
  assert.strictEqual(mysql.DEFAULT_LOCAL_INFILE_MAX_BYTES, 64 * 1024 * 1024);
  assert.strictEqual(mysql.DEFAULT_LOCAL_INFILE_CHUNK_BYTES, 64 * 1024);

  var disabled = mysql.createConnection({ user: 'test' });
  await assert.rejects(
    disabled.loadDataLocal("LOAD DATA LOCAL INFILE 'x' INTO TABLE t", '1,a\n', { filename: 'x' }),
    /disabled/
  );

  var enabled = mysql.createConnection({ user: 'test', localInfile: true });
  await assert.rejects(
    enabled.loadDataLocal("LOAD DATA LOCAL INFILE 'x' INTO TABLE t", '1,a\n', { filename: 'x' }),
    /not ready/
  );

  console.log('ok - MySQL LOCAL INFILE contracts');
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
