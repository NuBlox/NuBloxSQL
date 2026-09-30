'use strict';

var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var sqlite = require('..');

async function main() {
  var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-sqlite-'));
  var mainFile = path.join(temp, 'main.db');
  var attachedFile = path.join(temp, 'attached.db');
  var backupFile = path.join(temp, 'backup.db');

  try {
    assert.throws(function () {
      sqlite.createConnection({ filename: path.join(temp, 'missing.db'), mode: 'readwrite' });
    }, function (error) { return error && error.category === 'connection'; });

    var deferred = sqlite.createConnection({ filename: mainFile, open: false });
    assert.strictEqual(deferred.closed, true);
    assert.throws(function () { deferred.query('SELECT 1'); }, function (error) { return error && error.category === 'state'; });
    deferred.open();
    assert.strictEqual(deferred.closed, false);
    deferred.exec('CREATE TABLE item(id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    deferred.run('INSERT INTO item(name) VALUES(?)', ['alpha']);

    var attached = deferred.attach(attachedFile, 'archive');
    assert.strictEqual(attached.name, 'archive');
    assert.ok(deferred.listDatabases().some(function (entry) { return entry.name === 'archive'; }));
    deferred.exec('CREATE TABLE archive.audit(id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
    deferred.run('INSERT INTO archive.audit(note) VALUES(?)', ['attached']);
    assert.strictEqual(deferred.query('SELECT note FROM archive.audit').rows[0].note, 'attached');

    var pages = await deferred.backup(backupFile, { source: 'main', rate: 1 });
    assert.ok(Number(pages) >= 0);
    assert.ok(fs.existsSync(backupFile));

    var lifecycle = deferred.lifecycleCapabilities();
    assert.strictEqual(lifecycle.backup, true);
    assert.strictEqual(lifecycle.attach, true);
    assert.strictEqual(lifecycle.detach, true);

    if (lifecycle.serialize) {
      var image = deferred.serialize('main');
      assert.ok(image instanceof Uint8Array);
      var clone = sqlite.createConnection();
      clone.deserialize(image);
      assert.strictEqual(clone.query('SELECT name FROM item').rows[0].name, 'alpha');
      clone.close();
    } else {
      assert.throws(function () { deferred.serialize('main'); }, function (error) {
        return error && error.category === 'unsupported' && error.code === 'NUBLOXSQL_UNSUPPORTED';
      });
    }

    deferred.detach('archive');
    assert.ok(!deferred.listDatabases().some(function (entry) { return entry.name === 'archive'; }));
    assert.throws(function () { deferred.detach('main'); }, function (error) { return error && error.category === 'state'; });
    deferred.close();

    var rw = sqlite.createConnection({ filename: mainFile, mode: 'readwrite' });
    assert.strictEqual(rw.query('SELECT name FROM item').rows[0].name, 'alpha');
    rw.close();

    var ro = sqlite.createConnection({ filename: mainFile, mode: 'readonly' });
    assert.strictEqual(ro.query('SELECT name FROM item').rows[0].name, 'alpha');
    assert.throws(function () { ro.exec("INSERT INTO item(name) VALUES('blocked')"); });
    ro.close();

    var backup = sqlite.createConnection({ filename: backupFile, mode: 'readonly' });
    assert.strictEqual(backup.query('SELECT name FROM item').rows[0].name, 'alpha');
    backup.close();

    console.log('ok - SQLite lifecycle, backup, serialization capability and attached database contracts');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
