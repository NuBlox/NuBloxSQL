'use strict';

var assert = require('assert');
var nublox = require('..');
var sql = nublox.sql;

function configFor(dialect) {
  if (dialect === 'mysql') {
    return {
      dialect: 'mysql',
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: 'disable',
      getServerPublicKey: true,
      pool: { max: 4 }
    };
  }
  if (dialect === 'postgresql') {
    return {
      dialect: 'postgresql',
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      pool: { max: 4 }
    };
  }
  throw new Error('Unsupported live client dialect: ' + dialect);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT;
  if (!dialect) throw new Error('NUBLOX_DIALECT is required');

  var db = nublox.createClient(configFor(dialect));
  var tableName = 'nublox_client_conformance';
  var roleTableName = 'nublox_client_roles';
  var table = sql.identifier(tableName);
  var roleTable = sql.identifier(roleTableName);
  var exactDecimal = '12345678901234567890.123456';
  var typedUuid = '00112233-4455-6677-8899-aabbccddeeff';
  var decimalSpec = { type: 'decimal', precision: 26, scale: 6 };

  try {
    await db.execute(sql`DROP TABLE IF EXISTS ${table}`);
    await db.execute(sql`DROP TABLE IF EXISTS ${roleTable}`);
    await db.execute(sql`CREATE TABLE ${roleTable} (id INTEGER PRIMARY KEY, label VARCHAR(100) NOT NULL UNIQUE)`);
    await db.execute(sql`
      CREATE TABLE ${table} (
        id INTEGER PRIMARY KEY,
        role_id INTEGER,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(200),
        CONSTRAINT uq_nublox_client_email UNIQUE (email),
        CONSTRAINT fk_nublox_client_role FOREIGN KEY (role_id) REFERENCES nublox_client_roles(id) ON DELETE SET NULL
      )
    `);
    await db.execute(sql`CREATE INDEX ${sql.identifier('idx_nublox_client_name')} ON ${table} (name)`);

    var databases = await db.metadata.databases();
    assert.ok(databases.length > 0);
    var schemas = await db.metadata.schemas();
    assert.ok(schemas.length > 0);
    var tables = await db.metadata.tables();
    assert.ok(tables.some(function (entry) { return entry.name === tableName && entry.type === 'table'; }));
    var columns = await db.metadata.columns(tableName);
    assert.strictEqual(columns.find(function (entry) { return entry.name === 'id'; }).primaryKey, true);
    assert.strictEqual(columns.find(function (entry) { return entry.name === 'name'; }).nullable, false);
    var indexes = await db.metadata.indexes(tableName);
    assert.ok(indexes.some(function (entry) { return entry.name === 'idx_nublox_client_name' && entry.columns.indexOf('name') >= 0; }));
    assert.ok(indexes.some(function (entry) { return entry.unique === true && entry.columns.indexOf('email') >= 0; }));
    var foreignKeys = await db.metadata.foreignKeys(tableName);
    assert.strictEqual(foreignKeys.length, 1);
    assert.deepStrictEqual(Array.from(foreignKeys[0].columns), ['role_id']);
    assert.strictEqual(foreignKeys[0].referencedTable, roleTableName);
    assert.deepStrictEqual(Array.from(foreignKeys[0].referencedColumns), ['id']);
    assert.strictEqual(foreignKeys[0].onDelete, 'SET NULL');
    var constraints = await db.metadata.constraints(tableName);
    assert.ok(constraints.some(function (entry) { return entry.type === 'primary-key'; }));
    assert.ok(constraints.some(function (entry) { return entry.type === 'unique' && entry.columns.indexOf('email') >= 0; }));
    assert.ok(constraints.some(function (entry) { return entry.type === 'foreign-key'; }));
    var tableMetadata = await db.metadata.table(tableName);
    assert.strictEqual(tableMetadata.name, tableName);
    assert.ok(tableMetadata.columns.length >= 4);
    assert.ok(tableMetadata.indexes.length >= 2);
    assert.strictEqual(await db.metadata.table('nublox_missing_table'), null);

    await db.execute(sql`INSERT INTO ${table} (id, name) VALUES (${1}, ${'portable'})`);
    var rows = await db.all(sql`SELECT id, name FROM ${table} WHERE id = ${1}`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, 'portable');

    var typedDirect = await db.one(sql`
      SELECT
        ${sql.typed(exactDecimal, decimalSpec)} AS exact_decimal,
        ${sql.typed(typedUuid, 'uuid')} AS typed_uuid
    `);
    assert.strictEqual(String(typedDirect.exact_decimal), exactDecimal);
    assert.strictEqual(String(typedDirect.typed_uuid).toLowerCase(), typedUuid);

    var typedStream = [];
    for await (var typedStreamRow of db.stream(sql`
      SELECT ${sql.typed(exactDecimal, decimalSpec)} AS exact_decimal
    `, { batchSize: 1, highWaterMark: 1 })) typedStream.push(typedStreamRow);
    assert.strictEqual(typedStream.length, 1);
    assert.strictEqual(String(typedStream[0].exact_decimal), exactDecimal);

    await assert.rejects(
      function () { return db.execute(sql`INSERT INTO ${table} (id, name) VALUES (${1}, ${'duplicate'})`); },
      function (error) {
        assert.ok(error instanceof nublox.NuBloxSqlError);
        assert.strictEqual(error.category, 'unique_violation');
        assert.strictEqual(error.code, 'NUBLOXSQL_UNIQUE_VIOLATION');
        assert.strictEqual(error.dialect, dialect);
        assert.ok(error.native);
        if (dialect === 'mysql') assert.strictEqual(Number(error.nativeCode), 1062);
        if (dialect === 'postgresql') assert.strictEqual(error.sqlState, '23505');
        return true;
      }
    );

    await assert.rejects(
      function () { return db.query('SELEC definitely_invalid_syntax'); },
      function (error) {
        assert.ok(error instanceof nublox.NuBloxSqlError);
        assert.strictEqual(error.category, 'syntax');
        assert.strictEqual(error.dialect, dialect);
        return true;
      }
    );

    var insertPrepared = await db.prepare(sql`
      INSERT INTO ${table} (id, name)
      VALUES (${sql.parameter('id')}, ${sql.parameter('name')})
    `);
    await insertPrepared.execute({ id: 10, name: 'prepared-one' });
    await insertPrepared.execute({ id: 11, name: 'prepared-two' });
    await insertPrepared.close();

    var selectPrepared = await db.prepare(sql`
      SELECT id, name FROM ${table} WHERE id = ${sql.parameter('id')}
    `);
    assert.strictEqual((await selectPrepared.one({ id: 10 })).name, 'prepared-one');
    assert.strictEqual((await selectPrepared.one({ id: 11 })).name, 'prepared-two');
    await selectPrepared.close();

    var typedPrepared = await db.prepare(sql`
      SELECT
        ${sql.parameter('amount', decimalSpec)} AS exact_decimal,
        ${sql.parameter('id', 'uuid')} AS typed_uuid
    `);
    var typedPreparedRow = await typedPrepared.one({ amount: exactDecimal, id: typedUuid });
    assert.strictEqual(String(typedPreparedRow.exact_decimal), exactDecimal);
    assert.strictEqual(String(typedPreparedRow.typed_uuid).toLowerCase(), typedUuid);
    await typedPrepared.close();

    var streamed = [];
    var rowStream = db.stream(sql`
      SELECT id, name FROM ${table}
      WHERE id >= ${10}
      ORDER BY id
    `, { batchSize: 1, highWaterMark: 1 });
    for await (var streamedRow of rowStream) streamed.push(streamedRow);
    assert.deepStrictEqual(streamed.map(function (row) { return row.name; }), ['prepared-one', 'prepared-two']);
    assert.strictEqual(rowStream.closed, true);

    var earlyStream = db.stream(sql`SELECT id, name FROM ${table} ORDER BY id`, { batchSize: 1, highWaterMark: 1 });
    var firstStreamed = await earlyStream.next();
    assert.strictEqual(firstStreamed.done, false);
    await earlyStream.close();
    assert.strictEqual(earlyStream.closed, true);

    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO ${table} (id, name) VALUES (${2}, ${'committed'})`);
      var txPrepared = await tx.prepare(sql`SELECT name FROM ${table} WHERE id = ${sql.parameter('id')}`);
      assert.strictEqual((await txPrepared.one({ id: 2 })).name, 'committed');
    });

    await db.transaction(async function (tx) {
      await tx.execute(sql`INSERT INTO ${table} (id, name) VALUES (${20}, ${'savepoint-kept'})`);
      await tx.savepoint('before_optional');
      await tx.execute(sql`INSERT INTO ${table} (id, name) VALUES (${21}, ${'savepoint-removed'})`);
      await tx.rollbackTo('before_optional');
      await tx.releaseSavepoint('before_optional');
    }, { isolationLevel: 'read-committed', readOnly: false });

    assert.strictEqual((await db.one(sql`SELECT name FROM ${table} WHERE id = ${20}`)).name, 'savepoint-kept');
    assert.strictEqual((await db.all(sql`SELECT id FROM ${table} WHERE id = ${21}`)).length, 0);

    try {
      await db.transaction(async function (tx) {
        await tx.execute(sql`INSERT INTO ${table} (id, name) VALUES (${3}, ${'rolled-back'})`);
        throw new Error('rollback sentinel');
      });
      assert.fail('transaction should have rolled back');
    } catch (error) {
      assert.strictEqual(error.message, 'rollback sentinel');
      assert.strictEqual(error instanceof nublox.NuBloxSqlError, false);
    }

    var committed = await db.one(sql`SELECT id, name FROM ${table} WHERE id = ${2}`);
    assert.strictEqual(committed.name, 'committed');
    var rolledBack = await db.all(sql`SELECT id FROM ${table} WHERE id = ${3}`);
    assert.strictEqual(rolledBack.length, 0);

    console.log('NuBloxSQL live unified client and portable typed-bind contract passed for ' + dialect);
  } finally {
    try { await db.execute(sql`DROP TABLE IF EXISTS ${table}`); } catch (_) {}
    try { await db.execute(sql`DROP TABLE IF EXISTS ${roleTable}`); } catch (_) {}
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
