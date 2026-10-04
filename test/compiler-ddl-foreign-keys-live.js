'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') return { dialect: 'postgresql', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, pool: { max: 2 } };
  if (dialect === 'mysql') return { dialect: 'mysql', host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, ssl: 'disable', getServerPublicKey: true, pool: { max: 2 } };
  if (dialect === 'sqlite') return { dialect: 'sqlite', filename: ':memory:', pool: false };
  throw new Error('Unsupported ddl-v7 live dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var model = nublox.capabilityModel;
  var parent = 'nublox_fk_v7_parent';
  var child = 'nublox_fk_v7_child';
  var deferredParent = 'nublox_fk_v7_deferred_parent';
  var deferredChild = 'nublox_fk_v7_deferred_child';
  var alterParent = 'nublox_fk_v7_alter_parent';
  var alterChild = 'nublox_fk_v7_alter_child';
  var matchParent = 'nublox_fk_v7_match_parent';
  var matchChild = 'nublox_fk_v7_match_child';

  async function drop(name) { try { await db.execute('DROP TABLE IF EXISTS ' + name); } catch (_) {} }
  try {
    await drop(matchChild); await drop(matchParent);
    await drop(alterChild); await drop(alterParent);
    await drop(deferredChild); await drop(deferredParent);
    await drop(child); await drop(parent);
    var qualification = await model.qualifyClient(db);
    function compile(source) {
      var options = { targetQualification: qualification };
      if (dialect === 'postgresql') options.sourceQualification = qualification;
      var result = model.transpileSql('postgresql', dialect, source, options);
      assert.strictEqual(result.certified, true);
      return result;
    }

    await db.execute(model.transpileSql('postgresql', dialect, 'CREATE TABLE ' + parent + ' (id INTEGER PRIMARY KEY)', { targetQualification: qualification }).sql);
    var childDdl = compile('CREATE TABLE ' + child + ' (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES ' + parent + ' (id) ON DELETE CASCADE ON UPDATE CASCADE)');
    assert.strictEqual(childDdl.scope, 'ddl-v7');
    await db.execute(childDdl.sql);
    await db.execute('INSERT INTO ' + parent + ' (id) VALUES (1)');
    await db.execute('INSERT INTO ' + child + ' (id, parent_id) VALUES (10, 1)');
    await db.execute('UPDATE ' + parent + ' SET id = 2 WHERE id = 1');
    var updated = await db.one('SELECT parent_id FROM ' + child + ' WHERE id = 10');
    assert.strictEqual(Number(updated.parent_id), 2);
    await db.execute('DELETE FROM ' + parent + ' WHERE id = 2');
    var cascaded = await db.one('SELECT COUNT(*) AS count FROM ' + child);
    assert.strictEqual(Number(cascaded.count), 0);

    if (dialect === 'postgresql' || dialect === 'sqlite') {
      await db.execute(model.transpileSql('postgresql', dialect, 'CREATE TABLE ' + deferredParent + ' (id INTEGER PRIMARY KEY)', { targetQualification: qualification }).sql);
      var deferredDdl = compile('CREATE TABLE ' + deferredChild + ' (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES ' + deferredParent + ' (id) DEFERRABLE INITIALLY DEFERRED)');
      await db.execute(deferredDdl.sql);
      await db.transaction(async function (tx) {
        await tx.execute('INSERT INTO ' + deferredChild + ' (id, parent_id) VALUES (1, 7)');
        await tx.execute('INSERT INTO ' + deferredParent + ' (id) VALUES (7)');
      });
      var deferredRow = await db.one('SELECT parent_id FROM ' + deferredChild + ' WHERE id = 1');
      assert.strictEqual(Number(deferredRow.parent_id), 7);
    }

    if (dialect === 'postgresql' || dialect === 'mysql') {
      await db.execute(model.transpileSql('postgresql', dialect, 'CREATE TABLE ' + alterParent + ' (id INTEGER PRIMARY KEY)', { targetQualification: qualification }).sql);
      await db.execute(model.transpileSql('postgresql', dialect, 'CREATE TABLE ' + alterChild + ' (id INTEGER PRIMARY KEY, parent_id INTEGER)', { targetQualification: qualification }).sql);
      var alter = compile('ALTER TABLE ' + alterChild + ' ADD CONSTRAINT nublox_fk_v7_added FOREIGN KEY (parent_id) REFERENCES ' + alterParent + ' (id) ON DELETE CASCADE');
      assert.ok(alter.capabilities.indexOf('schema.tableAlter.addForeignKey') !== -1);
      await db.execute(alter.sql);
      await db.execute('INSERT INTO ' + alterParent + ' (id) VALUES (1)');
      await db.execute('INSERT INTO ' + alterChild + ' (id, parent_id) VALUES (1, 1)');
      await db.execute('DELETE FROM ' + alterParent + ' WHERE id = 1');
      var altered = await db.one('SELECT COUNT(*) AS count FROM ' + alterChild);
      assert.strictEqual(Number(altered.count), 0);
    }

    if (dialect === 'postgresql') {
      await db.execute('CREATE TABLE ' + matchParent + ' (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
      await db.execute(compile('CREATE TABLE ' + matchChild + ' (a INTEGER, b INTEGER, FOREIGN KEY (a, b) REFERENCES ' + matchParent + ' (a, b) MATCH FULL)').sql);
      await assert.rejects(db.execute('INSERT INTO ' + matchChild + ' (a, b) VALUES (1, NULL)'), /foreign key|MATCH FULL|null/i);
    }
  } finally {
    await drop(matchChild); await drop(matchParent);
    await drop(alterChild); await drop(alterParent);
    await drop(deferredChild); await drop(deferredParent);
    await drop(child); await drop(parent);
    await db.close();
  }
  console.log('NuBloxSQL Wave 5g live foreign-key qualification: PASS for ' + dialect);
}

main().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
