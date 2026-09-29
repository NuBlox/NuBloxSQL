'use strict';

var assert = require('assert');
var fs = require('fs');
var nubloxsql = require('../../../..');

function findByName(values, name) {
  return values.find(function (value) { return value.name === name; });
}

async function main() {
  var password = process.env.MSSQL_SA_PASSWORD;
  var caPath = process.env.MSSQL_CA_PATH;
  if (!password) throw new Error('MSSQL_SA_PASSWORD is required');
  if (!caPath) throw new Error('MSSQL_CA_PATH is required');

  var host = process.env.MSSQL_HOST || '127.0.0.1';
  var serverName = process.env.MSSQL_SERVER_NAME || host;
  var port = Number(process.env.MSSQL_PORT || 1433);
  var db = nubloxsql.createClient({
    dialect: 'sqlserver',
    host: host,
    port: port,
    user: 'sa',
    password: password,
    database: 'master',
    serverName: serverName,
    ca: fs.readFileSync(caPath),
    rejectUnauthorized: true,
    connectTimeout: 5000,
    queryTimeout: 5000,
    pool: { max: 2 }
  });

  try {
    await db.execute('IF OBJECT_ID(N\'dbo.NuBloxMetadataChild\', N\'U\') IS NOT NULL DROP TABLE dbo.NuBloxMetadataChild');
    await db.execute('IF OBJECT_ID(N\'dbo.NuBloxMetadataParent\', N\'U\') IS NOT NULL DROP TABLE dbo.NuBloxMetadataParent');
    await db.execute('CREATE TABLE dbo.NuBloxMetadataParent (id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_NuBloxMetadataParent PRIMARY KEY, code nvarchar(100) NOT NULL CONSTRAINT UQ_NuBloxMetadataParent_Code UNIQUE, amount decimal(18,2) NULL, quantity int NOT NULL CONSTRAINT CK_NuBloxMetadataParent_Quantity CHECK (quantity > 0))');
    await db.execute('CREATE TABLE dbo.NuBloxMetadataChild (id int NOT NULL CONSTRAINT PK_NuBloxMetadataChild PRIMARY KEY, parent_id int NOT NULL, CONSTRAINT FK_NuBloxMetadataChild_Parent FOREIGN KEY (parent_id) REFERENCES dbo.NuBloxMetadataParent(id) ON DELETE CASCADE)');

    var databases = await db.metadata.databases();
    assert.ok(findByName(databases, 'master'));

    var schemas = await db.metadata.schemas();
    var dbo = findByName(schemas, 'dbo');
    assert.ok(dbo);
    assert.strictEqual(dbo.database, 'master');

    var tables = await db.metadata.tables({ schema: 'dbo' });
    assert.ok(findByName(tables, 'NuBloxMetadataParent'));
    assert.ok(findByName(tables, 'NuBloxMetadataChild'));

    var columns = await db.metadata.columns('NuBloxMetadataParent', { schema: 'dbo' });
    var id = findByName(columns, 'id');
    var code = findByName(columns, 'code');
    var amount = findByName(columns, 'amount');
    assert.ok(id && code && amount);
    assert.strictEqual(id.primaryKey, true);
    assert.strictEqual(id.identity, true);
    assert.strictEqual(code.nullable, false);
    assert.strictEqual(amount.dataType, 'decimal');
    assert.strictEqual(amount.numericPrecision, 18);
    assert.strictEqual(amount.numericScale, 2);

    var indexes = await db.metadata.indexes('NuBloxMetadataParent', { schema: 'dbo' });
    assert.ok(indexes.some(function (index) { return index.primary === true && index.columns.indexOf('id') >= 0; }));
    assert.ok(indexes.some(function (index) { return index.unique === true && index.columns.indexOf('code') >= 0; }));

    var foreignKeys = await db.metadata.foreignKeys('NuBloxMetadataChild', { schema: 'dbo' });
    var fk = findByName(foreignKeys, 'FK_NuBloxMetadataChild_Parent');
    assert.ok(fk);
    assert.deepStrictEqual(Array.from(fk.columns), ['parent_id']);
    assert.strictEqual(fk.referencedSchema, 'dbo');
    assert.strictEqual(fk.referencedTable, 'NuBloxMetadataParent');
    assert.deepStrictEqual(Array.from(fk.referencedColumns), ['id']);
    assert.strictEqual(String(fk.onDelete).toUpperCase(), 'CASCADE');

    var constraints = await db.metadata.constraints('NuBloxMetadataParent', { schema: 'dbo' });
    assert.ok(constraints.some(function (constraint) { return constraint.type === 'primary-key'; }));
    assert.ok(constraints.some(function (constraint) { return constraint.type === 'unique'; }));
    assert.ok(constraints.some(function (constraint) { return constraint.type === 'check' && constraint.definition; }));

    var table = await db.metadata.table('NuBloxMetadataParent', { schema: 'dbo' });
    assert.ok(table);
    assert.strictEqual(table.name, 'NuBloxMetadataParent');
    assert.ok(table.columns.length >= 4);
    assert.ok(table.indexes.length >= 2);
    assert.ok(table.constraints.length >= 3);

    assert.strictEqual(db.supports('catalogs'), true);
    assert.strictEqual(db.supports('schemas'), true);
    console.log('NuBloxSQL live SQL Server metadata contract passed');
  } finally {
    try { await db.execute('IF OBJECT_ID(N\'dbo.NuBloxMetadataChild\', N\'U\') IS NOT NULL DROP TABLE dbo.NuBloxMetadataChild'); } catch (_) {}
    try { await db.execute('IF OBJECT_ID(N\'dbo.NuBloxMetadataParent\', N\'U\') IS NOT NULL DROP TABLE dbo.NuBloxMetadataParent'); } catch (_) {}
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
