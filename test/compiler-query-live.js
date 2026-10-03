'use strict';

var assert = require('assert');
var nublox = require('..');

function configFor(dialect) {
  if (dialect === 'postgresql') {
    return {
      dialect: 'postgresql',
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      pool: { max: 2 }
    };
  }
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
      pool: { max: 2 }
    };
  }
  if (dialect === 'sqlite') return { dialect: 'sqlite', filename: ':memory:', pool: false };
  throw new Error('Unsupported compiler live dialect: ' + dialect);
}

function compileFrom(sourceDialect, dialect, source, expectedScope, targetQualification) {
  var options = targetQualification ? { targetQualification: targetQualification } : undefined;
  var result = nublox.capabilityModel.transpileSql(sourceDialect, dialect, source, options);
  assert.strictEqual(result.scope, expectedScope || 'select-query-v2');
  assert.strictEqual(result.certified, true);
  return result.sql;
}

function compile(dialect, source, expectedScope, targetQualification) {
  return compileFrom('postgresql', dialect, source, expectedScope, targetQualification);
}

async function main() {
  var dialect = process.env.NUBLOX_DIALECT || 'sqlite';
  var db = nublox.createClient(configFor(dialect));
  var table = 'nublox_compiler_query_wave';
  var mergeSource = 'nublox_compiler_merge_source';
  try {
    await db.execute('DROP TABLE IF EXISTS ' + mergeSource);
    await db.execute('DROP TABLE IF EXISTS ' + table);
    await db.execute('CREATE TABLE ' + table + ' (id INTEGER PRIMARY KEY, parent_id INTEGER, name VARCHAR(100) NOT NULL)');
    await db.execute("INSERT INTO " + table + " (id, parent_id, name) VALUES (1, NULL, 'root')");
    await db.execute("INSERT INTO " + table + " (id, parent_id, name) VALUES (2, 1, 'child')");

    var qualification = await nublox.capabilityModel.qualifyClient(db);

    var cteSql = compile(dialect,
      'WITH scoped AS (SELECT id, parent_id FROM ' + table + ' WHERE id > 0) ' +
      'SELECT s.id FROM scoped s WHERE EXISTS (SELECT 1 FROM ' + table + ' x WHERE x.id = s.id) ' +
      'AND s.id IN (SELECT y.id FROM ' + table + ' y) ORDER BY s.id',
      'select-query-v2', qualification
    );
    var cteRows = await db.all(cteSql);
    assert.deepStrictEqual(cteRows.map(function (row) { return Number(row.id); }), [1, 2]);

    var derivedSql = compile(dialect,
      'SELECT d.id, (SELECT max(x.id) FROM ' + table + ' x) AS max_id ' +
      'FROM (SELECT id FROM ' + table + ' WHERE id > 0) d ORDER BY d.id',
      'select-query-v2', qualification
    );
    var derivedRows = await db.all(derivedSql);
    assert.strictEqual(derivedRows.length, 2);
    assert.strictEqual(Number(derivedRows[0].max_id), 2);
    assert.strictEqual(Number(derivedRows[1].max_id), 2);

    var recursiveDeclarationSql = compile(dialect,
      'WITH RECURSIVE scoped(id) AS (SELECT id FROM ' + table + ' WHERE id = 1) SELECT id FROM scoped',
      'select-query-v2', qualification
    );
    var recursiveRows = await db.all(recursiveDeclarationSql);
    assert.strictEqual(recursiveRows.length, 1);
    assert.strictEqual(Number(recursiveRows[0].id), 1);

    var unionSql = compile(dialect,
      'SELECT id FROM ' + table + ' WHERE id = 1 UNION ALL SELECT id FROM ' + table + ' WHERE id = 2 ORDER BY id',
      'select-query-v3', qualification
    );
    var unionRows = await db.all(unionSql);
    assert.deepStrictEqual(unionRows.map(function (row) { return Number(row.id); }), [1, 2]);

    var intersectSql = compile(dialect,
      'SELECT 1 AS n UNION SELECT 2 INTERSECT SELECT 2 ORDER BY n',
      'select-query-v3', qualification
    );
    var intersectRows = await db.all(intersectSql);
    assert.deepStrictEqual(intersectRows.map(function (row) { return Number(row.n); }), [1, 2]);

    var exceptSql = compile(dialect,
      'SELECT id FROM ' + table + ' EXCEPT SELECT id FROM ' + table + ' WHERE id = 2 ORDER BY id',
      'select-query-v3', qualification
    );
    var exceptRows = await db.all(exceptSql);
    assert.deepStrictEqual(exceptRows.map(function (row) { return Number(row.id); }), [1]);

    var cteSetSql = compile(dialect,
      'WITH combined AS (SELECT id FROM ' + table + ' WHERE id = 1 UNION ALL SELECT id FROM ' + table + ' WHERE id = 2) ' +
      'SELECT id FROM combined ORDER BY id',
      'select-query-v3', qualification
    );
    var cteSetRows = await db.all(cteSetSql);
    assert.deepStrictEqual(cteSetRows.map(function (row) { return Number(row.id); }), [1, 2]);

    var trueRecursiveSql = compile(dialect,
      'WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 3) SELECT n FROM seq ORDER BY n',
      'select-query-v3', qualification
    );
    var trueRecursiveRows = await db.all(trueRecursiveSql);
    assert.deepStrictEqual(trueRecursiveRows.map(function (row) { return Number(row.n); }), [1, 2, 3]);

    if (dialect !== 'sqlite') {
      var intersectAllSql = compile(dialect, 'SELECT 1 AS n INTERSECT ALL SELECT 1', 'select-query-v3', qualification);
      var intersectAllRows = await db.all(intersectAllSql);
      assert.deepStrictEqual(intersectAllRows.map(function (row) { return Number(row.n); }), [1]);

      var exceptAllSql = compile(dialect, 'SELECT 1 AS n EXCEPT ALL SELECT 2', 'select-query-v3', qualification);
      var exceptAllRows = await db.all(exceptAllSql);
      assert.deepStrictEqual(exceptAllRows.map(function (row) { return Number(row.n); }), [1]);
    }

    var expressionSql = compile(dialect,
      'SELECT id, CASE WHEN id BETWEEN 1 AND 1 THEN CAST(id AS DECIMAL(10,2)) ELSE 0 END AS classified ' +
      'FROM ' + table + " WHERE name NOT LIKE 'missing%' ORDER BY id",
      'select-query-v4', qualification
    );
    var expressionRows = await db.all(expressionSql);
    assert.strictEqual(expressionRows.length, 2);
    assert.strictEqual(Number(expressionRows[0].classified), 1);
    assert.strictEqual(Number(expressionRows[1].classified), 0);

    var windowSql = compile(dialect,
      'SELECT id, sum(id) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running ' +
      'FROM ' + table + ' ORDER BY id',
      'select-query-v4', qualification
    );
    var windowRows = await db.all(windowSql);
    assert.deepStrictEqual(windowRows.map(function (row) { return Number(row.running); }), [1, 3]);

    var namedWindowSql = compile(dialect,
      'SELECT id, sum(id) OVER w AS running FROM ' + table +
      ' WINDOW w AS (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) ORDER BY id',
      'select-query-v4', qualification
    );
    var namedWindowRows = await db.all(namedWindowSql);
    assert.deepStrictEqual(namedWindowRows.map(function (row) { return Number(row.running); }), [1, 3]);

    var insertSql = compile(dialect,
      "INSERT INTO " + table + " (id, parent_id, name) VALUES (3, 2, 'leaf')",
      'dml-v1', qualification
    );
    await db.execute(insertSql);
    var inserted = await db.one('SELECT id, parent_id, name FROM ' + table + ' WHERE id = 3');
    assert.strictEqual(Number(inserted.id), 3);
    assert.strictEqual(Number(inserted.parent_id), 2);
    assert.strictEqual(inserted.name, 'leaf');

    var insertSelectSql = compile(dialect,
      "INSERT INTO " + table + " (id, parent_id, name) SELECT 4, id, 'copy' FROM " + table + ' WHERE id = 1',
      'dml-v1', qualification
    );
    await db.execute(insertSelectSql);
    var insertedSelect = await db.one('SELECT id, parent_id, name FROM ' + table + ' WHERE id = 4');
    assert.strictEqual(Number(insertedSelect.id), 4);
    assert.strictEqual(Number(insertedSelect.parent_id), 1);
    assert.strictEqual(insertedSelect.name, 'copy');

    var updateSql = compile(dialect,
      "UPDATE " + table + " SET parent_id = 1, name = CASE WHEN id = 3 THEN 'updated' ELSE name END WHERE id = 3",
      'dml-v1', qualification
    );
    await db.execute(updateSql);
    var updated = await db.one('SELECT parent_id, name FROM ' + table + ' WHERE id = 3');
    assert.strictEqual(Number(updated.parent_id), 1);
    assert.strictEqual(updated.name, 'updated');

    if (dialect !== 'mysql') {
      var returningUpdateSql = compile(dialect,
        "UPDATE " + table + " SET name = 'returned' WHERE id = 3 RETURNING id, name",
        'dml-v1', qualification
      );
      var returnedUpdate = await db.all(returningUpdateSql);
      assert.strictEqual(returnedUpdate.length, 1);
      assert.strictEqual(Number(returnedUpdate[0].id), 3);
      assert.strictEqual(returnedUpdate[0].name, 'returned');

      var returningDeleteSql = compile(dialect,
        'DELETE FROM ' + table + ' WHERE id = 3 RETURNING id',
        'dml-v1', qualification
      );
      var returnedDelete = await db.all(returningDeleteSql);
      assert.strictEqual(returnedDelete.length, 1);
      assert.strictEqual(Number(returnedDelete[0].id), 3);
    } else {
      var deleteSql = compile(dialect, 'DELETE FROM ' + table + ' WHERE id = 3', 'dml-v1', qualification);
      await db.execute(deleteSql);
    }

    var deleteSelectInsertSql = compile(dialect, 'DELETE FROM ' + table + ' WHERE id = 4', 'dml-v1', qualification);
    await db.execute(deleteSelectInsertSql);
    var remaining = await db.all('SELECT id FROM ' + table + ' WHERE id IN (3, 4) ORDER BY id');
    assert.strictEqual(remaining.length, 0);

    await db.execute("INSERT INTO " + table + " (id, parent_id, name) VALUES (5, NULL, 'initial')");
    var upsertSql;
    if (dialect === 'mysql') {
      upsertSql = compileFrom('mysql', 'mysql',
        "INSERT INTO " + table + " (id, parent_id, name) VALUES (5, NULL, 'ignored') ON DUPLICATE KEY UPDATE name = 'upserted'",
        'dml-v2', qualification
      );
    } else {
      upsertSql = compile(dialect,
        "INSERT INTO " + table + " (id, parent_id, name) VALUES (5, NULL, 'upserted') ON CONFLICT (id) DO UPDATE SET name = excluded.name",
        'dml-v2', qualification
      );
    }
    await db.execute(upsertSql);
    var upserted = await db.one('SELECT name FROM ' + table + ' WHERE id = 5');
    assert.strictEqual(upserted.name, 'upserted');

    if (dialect === 'postgresql') {
      await db.execute('CREATE TABLE ' + mergeSource + ' (id INTEGER PRIMARY KEY, parent_id INTEGER, name VARCHAR(100) NOT NULL)');
      await db.execute("INSERT INTO " + mergeSource + " (id, parent_id, name) VALUES (6, NULL, 'merge-one')");
      var mergeSql = compileFrom('postgresql', 'postgresql',
        'MERGE INTO ' + table + ' AS t USING ' + mergeSource + ' AS s ON t.id = s.id ' +
        'WHEN MATCHED THEN UPDATE SET name = s.name ' +
        'WHEN NOT MATCHED THEN INSERT (id, parent_id, name) VALUES (s.id, s.parent_id, s.name)',
        'dml-v2', qualification
      );
      await db.execute(mergeSql);
      var mergedInsert = await db.one('SELECT name FROM ' + table + ' WHERE id = 6');
      assert.strictEqual(mergedInsert.name, 'merge-one');
      await db.execute("UPDATE " + mergeSource + " SET name = 'merge-two' WHERE id = 6");
      await db.execute(mergeSql);
      var mergedUpdate = await db.one('SELECT name FROM ' + table + ' WHERE id = 6');
      assert.strictEqual(mergedUpdate.name, 'merge-two');
    }

    await db.execute('DELETE FROM ' + table + ' WHERE id IN (5, 6)');
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS ' + mergeSource); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + table); } catch (_) {}
    await db.close();
  }

  console.log('NuBloxSQL live compiler query and DML waves: PASS for ' + dialect);
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});