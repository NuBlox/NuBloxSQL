'use strict';

var assert = require('assert');
var nublox = require('../../../..');

function config() {
  return {
    dialect: 'postgresql', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'postgres', pool: { max: 2 }
  };
}

async function main() {
  var db = nublox.createClient(config());
  var schema = 'public';
  var parent = 'nublox_catalog_parent';
  var child = 'nublox_catalog_child';
  var typeName = 'nublox_catalog_status';
  var domainName = 'nublox_positive_int';
  var sequenceName = 'nublox_catalog_seq';
  var functionName = 'nublox_catalog_fn';

  try {
    await db.execute('DROP TABLE IF EXISTS ' + child + ' CASCADE');
    await db.execute('DROP TABLE IF EXISTS ' + parent + ' CASCADE');
    await db.execute('DROP FUNCTION IF EXISTS ' + functionName + '(integer) CASCADE');
    await db.execute('DROP SEQUENCE IF EXISTS ' + sequenceName + ' CASCADE');
    await db.execute('DROP DOMAIN IF EXISTS ' + domainName + ' CASCADE');
    await db.execute('DROP TYPE IF EXISTS ' + typeName + ' CASCADE');

    await db.execute("CREATE TYPE " + typeName + " AS ENUM ('active','disabled')");
    await db.execute('CREATE DOMAIN ' + domainName + ' AS integer CHECK (VALUE > 0)');
    await db.execute('CREATE SEQUENCE ' + sequenceName + ' START WITH 10 INCREMENT BY 5');
    await db.execute(
      'CREATE TABLE ' + parent + ' (' +
      'id integer GENERATED ALWAYS AS IDENTITY, tenant_id integer NOT NULL, value integer NOT NULL, ' +
      'doubled integer GENERATED ALWAYS AS (value * 2) STORED, status ' + typeName + " NOT NULL DEFAULT 'active', " +
      'positive_value ' + domainName + ', CONSTRAINT ' + parent + '_pk PRIMARY KEY (tenant_id, id), ' +
      'CONSTRAINT ' + parent + '_value_unique UNIQUE (tenant_id, value) DEFERRABLE INITIALLY DEFERRED, ' +
      'CONSTRAINT ' + parent + '_value_chk CHECK (value >= 0)) PARTITION BY RANGE (tenant_id)'
    );
    await db.execute('CREATE TABLE ' + child + ' PARTITION OF ' + parent + ' FOR VALUES FROM (0) TO (1000)');
    await db.execute('CREATE INDEX ' + parent + '_expr_idx ON ' + parent + ' ((tenant_id + value)) WHERE value > 0');
    await db.execute('ALTER TABLE ' + parent + ' ENABLE ROW LEVEL SECURITY');
    await db.execute('CREATE POLICY nublox_catalog_policy ON ' + parent + ' USING (tenant_id > 0) WITH CHECK (tenant_id > 0)');
    await db.execute("CREATE FUNCTION " + functionName + "(integer) RETURNS integer LANGUAGE SQL IMMUTABLE AS 'SELECT $1 + 1'");
    await db.execute('GRANT SELECT ON ' + parent + ' TO PUBLIC');

    var table = await db.metadata.tableDetails(parent, { schema: schema });
    assert.ok(table && table.kind === 'partitioned-table');
    assert.strictEqual(table.rowSecurity, true);
    assert.ok(table.partitionKey);

    var columns = await db.metadata.columnDetails(parent, { schema: schema });
    var id = columns.find(function (entry) { return entry.name === 'id'; });
    var doubled = columns.find(function (entry) { return entry.name === 'doubled'; });
    assert.ok(id && id.identity && id.sequence);
    assert.ok(doubled && doubled.generated === 'stored' && doubled.expression);

    var indexes = await db.metadata.indexDetails(parent, { schema: schema });
    assert.ok(indexes.some(function (entry) { return entry.name === parent + '_expr_idx' && entry.predicate; }));

    var constraints = await db.metadata.constraintDetails(parent, { schema: schema });
    assert.ok(constraints.some(function (entry) { return entry.type === 'primary-key'; }));
    assert.ok(constraints.some(function (entry) { return entry.type === 'check' && entry.validated === true; }));
    assert.ok(constraints.some(function (entry) { return entry.name === parent + '_value_unique' && entry.deferrable === true && entry.initiallyDeferred === true; }));

    var partitions = await db.metadata.partitions({ schema: schema });
    assert.ok(partitions.some(function (entry) { return entry.parent === parent && entry.name === child && entry.bound; }));

    var policies = await db.metadata.policies({ schema: schema });
    assert.ok(policies.some(function (entry) { return entry.table === parent && entry.name === 'nublox_catalog_policy'; }));

    var routines = await db.metadata.routines({ schema: schema });
    assert.ok(routines.some(function (entry) { return entry.name === functionName && entry.kind === 'function' && entry.volatility === 'immutable'; }));

    var types = await db.metadata.types({ schema: schema });
    var enumType = types.find(function (entry) { return entry.name === typeName; });
    var domainType = types.find(function (entry) { return entry.name === domainName; });
    assert.ok(enumType && enumType.kind === 'enum');
    assert.deepStrictEqual(enumType.enumValues.map(function (entry) { return entry.label; }), ['active', 'disabled']);
    assert.ok(domainType && domainType.kind === 'domain' && domainType.domainConstraints.length > 0);

    var sequences = await db.metadata.sequences({ schema: schema });
    assert.ok(sequences.some(function (entry) { return entry.name === sequenceName; }));

    var privileges = await db.metadata.privileges({ schema: schema });
    assert.ok(privileges.some(function (entry) { return entry.object === parent && entry.grantee === 'PUBLIC' && entry.privilege === 'SELECT'; }));

    var deep = await db.metadata.deepCatalog({ schema: schema });
    assert.strictEqual(deep.dialect, 'postgresql');
    assert.ok(deep.partitions.length && deep.policies.length && deep.routines.length && deep.types.length && deep.sequences.length && deep.privileges.length);
    assert.ok(Object.isFrozen(deep));

    console.log('ok - PostgreSQL deep catalog introspection qualification');
  } finally {
    try { await db.execute('DROP TABLE IF EXISTS ' + child + ' CASCADE'); } catch (_) {}
    try { await db.execute('DROP TABLE IF EXISTS ' + parent + ' CASCADE'); } catch (_) {}
    try { await db.execute('DROP FUNCTION IF EXISTS ' + functionName + '(integer) CASCADE'); } catch (_) {}
    try { await db.execute('DROP SEQUENCE IF EXISTS ' + sequenceName + ' CASCADE'); } catch (_) {}
    try { await db.execute('DROP DOMAIN IF EXISTS ' + domainName + ' CASCADE'); } catch (_) {}
    try { await db.execute('DROP TYPE IF EXISTS ' + typeName + ' CASCADE'); } catch (_) {}
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
