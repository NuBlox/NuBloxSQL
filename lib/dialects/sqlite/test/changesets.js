'use strict';

var assert = require('assert');
var sqlite = require('..');

function seedSchema(db) {
  db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER NOT NULL); CREATE TABLE ignored(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
}

(function qualifyChangesets() {
  var source = sqlite.createConnection();
  var target = sqlite.createConnection();
  seedSchema(source);
  seedSchema(target);

  var capabilities = source.changesetCapabilities();
  assert.strictEqual(typeof capabilities.sessions, 'boolean');
  assert.strictEqual(typeof capabilities.applyChangeset, 'boolean');

  if (!capabilities.sessions || !capabilities.applyChangeset) {
    assert.throws(function () { source.createChangeSession(); }, /does not support SQLite sessions and changesets/);
    source.close(); target.close();
    console.log('SQLite changeset qualification skipped: runtime capability unavailable');
    return;
  }

  var session = source.createChangeSession();
  assert.strictEqual(session.database, 'main');
  assert.strictEqual(session.table, null);
  source.run('INSERT INTO items(id, name, qty) VALUES (?, ?, ?)', [1, 'hammer', 2]);
  source.run('INSERT INTO ignored(id, value) VALUES (?, ?)', [1, 'skip-me']);
  source.run('UPDATE items SET qty = ? WHERE id = ?', [3, 1]);

  var changeset = session.changeset();
  var patchset = session.patchset();
  assert.ok(changeset instanceof Uint8Array && changeset.byteLength > 0);
  assert.ok(patchset instanceof Uint8Array && patchset.byteLength > 0);

  var applied = target.applyChangeset(changeset, {
    filter: function (table) { return table !== 'ignored'; }
  });
  assert.strictEqual(applied.applied, true);
  assert.deepStrictEqual(applied.filteredTables, ['ignored']);
  assert.strictEqual(target.query('SELECT name, qty FROM items WHERE id = 1').rows[0].name, 'hammer');
  assert.strictEqual(Number(target.query('SELECT qty FROM items WHERE id = 1').rows[0].qty), 3);
  assert.strictEqual(target.query('SELECT * FROM ignored').rowCount, 0);

  session.close();
  session.close();
  assert.strictEqual(session.closed, true);
  assert.throws(function () { session.changeset(); }, /change session is closed/);

  var tableSession = source.createChangeSession({ table: 'items' });
  source.run('INSERT INTO items(id, name, qty) VALUES (?, ?, ?)', [2, 'saw', 1]);
  source.run('INSERT INTO ignored(id, value) VALUES (?, ?)', [2, 'not-tracked']);
  var tableChanges = tableSession.changeset();
  var tableTarget = sqlite.createConnection();
  seedSchema(tableTarget);
  var tableApplied = tableTarget.applyChangeset(tableChanges);
  assert.strictEqual(tableApplied.applied, true);
  assert.strictEqual(tableTarget.query('SELECT * FROM items').rowCount, 1);
  assert.strictEqual(tableTarget.query('SELECT * FROM ignored').rowCount, 0);
  tableSession.close();

  if (capabilities.conflictConstants) {
    var conflictSource = sqlite.createConnection();
    var conflictTarget = sqlite.createConnection();
    seedSchema(conflictSource); seedSchema(conflictTarget);
    conflictTarget.run('INSERT INTO items(id, name, qty) VALUES (1, ?, 9)', ['existing']);
    var conflictSession = conflictSource.createChangeSession({ table: 'items' });
    conflictSource.run('INSERT INTO items(id, name, qty) VALUES (1, ?, 1)', ['incoming']);
    var conflictChanges = conflictSession.changeset();
    var seenConflict = null;
    var conflictResult = conflictTarget.applyChangeset(conflictChanges, {
      onConflict: function (conflict) { seenConflict = conflict; return 'omit'; }
    });
    assert.strictEqual(conflictResult.applied, true);
    assert.ok(seenConflict && typeof seenConflict.code === 'number');
    assert.strictEqual(seenConflict.name, 'conflict');
    assert.strictEqual(conflictResult.conflicts[0].resolution, 'omit');
    assert.strictEqual(conflictTarget.query('SELECT name FROM items WHERE id = 1').rows[0].name, 'existing');
    conflictSession.close(); conflictSource.close(); conflictTarget.close();
  }

  var attached = sqlite.createConnection();
  attached.attach(':memory:', 'archive');
  attached.exec('CREATE TABLE archive.events(id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
  var archiveSession = attached.createChangeSession({ database: 'archive', table: 'events' });
  attached.run('INSERT INTO archive.events(id, note) VALUES (?, ?)', [1, 'archived']);
  assert.ok(archiveSession.changeset().byteLength > 0);
  archiveSession.close(); attached.close();

  tableTarget.close(); source.close(); target.close();
  console.log('SQLite session changeset and controlled replication qualification passed');
}());
