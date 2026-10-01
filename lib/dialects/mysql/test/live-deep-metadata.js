'use strict';

var assert = require('assert');
var nublox = require('../../../..');
var mysql = require('..');

function config() {
  return {
    dialect: 'mysql', host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'nublox', password: process.env.MYSQL_PASSWORD || 'nublox_ci_password',
    database: process.env.MYSQL_DATABASE || 'nublox_ci', pool: { max: 2 }, ssl: false
  };
}

async function allowFixtureTriggers() {
  var root = mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: 'root', password: process.env.MYSQL_ROOT_PASSWORD || 'nublox_root_password',
    database: process.env.MYSQL_DATABASE || 'nublox_ci', ssl: false, getServerPublicKey: true
  });
  await root.connect();
  try { await root.query('SET GLOBAL log_bin_trust_function_creators = 1'); }
  finally { await root.end(); }
}

async function main() {
  await allowFixtureTriggers();
  var db = nublox.createClient(config());
  var schema = process.env.MYSQL_DATABASE || 'nublox_ci';
  var table = 'nublox_deep_metadata';
  var searchTable = 'nublox_deep_metadata_search';
  var trigger = 'nublox_deep_metadata_bi';
  var procedure = 'nublox_deep_metadata_proc';
  var event = 'nublox_deep_metadata_event';
  try {
    await db.query('DROP EVENT IF EXISTS ' + event);
    await db.query('DROP PROCEDURE IF EXISTS ' + procedure);
    await db.query('DROP TRIGGER IF EXISTS ' + trigger);
    await db.query('DROP TABLE IF EXISTS ' + searchTable);
    await db.query('DROP TABLE IF EXISTS ' + table);
    await db.query(
      'CREATE TABLE ' + table + ' (' +
      'id INT NOT NULL, category VARCHAR(32) NOT NULL, amount INT NOT NULL, ' +
      'doubled INT GENERATED ALWAYS AS (amount * 2) STORED, note TEXT, ' +
      'CONSTRAINT ' + table + '_pk PRIMARY KEY (id), CONSTRAINT ' + table + '_amount_chk CHECK (amount >= 0)' +
      ') ENGINE=InnoDB COMMENT="NuBlox deep metadata" PARTITION BY RANGE (id) (' +
      'PARTITION p0 VALUES LESS THAN (100), PARTITION pmax VALUES LESS THAN MAXVALUE)'
    );
    await db.query('CREATE TABLE ' + searchTable + ' (id INT PRIMARY KEY, note TEXT NOT NULL) ENGINE=InnoDB');
    await db.query('CREATE INDEX ' + table + '_category_idx ON ' + table + ' (category) INVISIBLE');
    await db.query('CREATE FULLTEXT INDEX ' + searchTable + '_note_ft ON ' + searchTable + ' (note)');
    await db.query('CREATE TRIGGER ' + trigger + ' BEFORE INSERT ON ' + table + ' FOR EACH ROW SET NEW.category = UPPER(NEW.category)');
    await db.query('CREATE PROCEDURE ' + procedure + '(IN p_id INT) SELECT p_id AS id');
    try {
      await db.query('CREATE EVENT ' + event + ' ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 DAY DO DELETE FROM ' + table + ' WHERE id < 0');
    } catch (error) {
      if (!/EVENT|privilege|denied/i.test(String(error && error.message))) throw error;
    }

    var detail = await db.metadata.tableDetails(table, { schema: schema });
    assert.ok(detail && detail.engine === 'InnoDB');
    assert.strictEqual(detail.comment, 'NuBlox deep metadata');

    var columns = await db.metadata.columnDetails(table, { schema: schema });
    var doubled = columns.find(function (entry) { return entry.name === 'doubled'; });
    assert.ok(doubled && doubled.generated && doubled.generatedKind === 'stored' && doubled.generationExpression);

    var indexes = await db.metadata.indexDetails(table, { schema: schema });
    assert.ok(indexes.some(function (entry) { return entry.name === table + '_category_idx' && entry.visible === false; }));
    var searchIndexes = await db.metadata.indexDetails(searchTable, { schema: schema });
    assert.ok(searchIndexes.some(function (entry) { return entry.name === searchTable + '_note_ft' && entry.type === 'FULLTEXT'; }));

    var constraints = await db.metadata.constraintDetails(table, { schema: schema });
    assert.ok(constraints.some(function (entry) { return entry.type === 'primary-key'; }));
    assert.ok(constraints.some(function (entry) { return entry.type === 'check' && entry.enforced === true; }));

    var partitions = await db.metadata.partitions({ schema: schema });
    assert.ok(partitions.some(function (entry) { return entry.table === table && entry.name === 'p0' && entry.method === 'RANGE'; }));

    var routines = await db.metadata.routines({ schema: schema });
    assert.ok(routines.some(function (entry) { return entry.name === procedure && entry.kind === 'procedure'; }));

    var triggers = await db.metadata.triggers({ schema: schema });
    assert.ok(triggers.some(function (entry) { return entry.name === trigger && entry.table === table && entry.timing === 'BEFORE'; }));

    var events = await db.metadata.events({ schema: schema });
    assert.ok(Array.isArray(events));

    var privileges = await db.metadata.privileges({ schema: schema });
    assert.ok(privileges.length > 0);

    var deep = await db.metadata.deepCatalog({ schema: schema });
    assert.strictEqual(deep.dialect, 'mysql');
    assert.ok(deep.partitions.length > 0 && deep.routines.length > 0 && deep.triggers.length > 0 && deep.privileges.length > 0);
    assert.ok(Object.isFrozen(deep));

    console.log('ok - MySQL deep metadata qualification');
  } finally {
    try { await db.query('DROP EVENT IF EXISTS ' + event); } catch (_) {}
    try { await db.query('DROP PROCEDURE IF EXISTS ' + procedure); } catch (_) {}
    try { await db.query('DROP TRIGGER IF EXISTS ' + trigger); } catch (_) {}
    try { await db.query('DROP TABLE IF EXISTS ' + searchTable); } catch (_) {}
    try { await db.query('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
