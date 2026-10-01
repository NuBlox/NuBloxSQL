# Bulk data movement

**Scope:** engine-aware bulk ingestion/export patterns. There is no single fastest bulk primitive shared by every SQL engine, so NuBloxSQL exposes native-depth features rather than hiding them.

## PostgreSQL COPY

```js
const { createConnection } = require('nubloxsql');

async function importPostgres(config, csvChunks) {
  const db = createConnection('postgresql', config);
  await db.connect();

  try {
    return await db.copyFrom(
      'COPY staging_orders (id, customer_id, total) FROM STDIN WITH (FORMAT csv)',
      csvChunks,
      { maxBytes: 1024 * 1024 * 1024, timeout: 300_000 }
    );
  } finally {
    await db.end();
  }
}
```

For exports, `copyTo()` can return a buffer or stream into a sink depending on the options you supply.

## MySQL LOCAL INFILE

```js
const { createConnection } = require('nubloxsql');

async function importMySql(config, csvText) {
  const db = createConnection('mysql', {
    ...config,
    localInfile: true,
    localInfileMaxBytes: 256 * 1024 * 1024
  });
  await db.connect();

  try {
    return await db.loadDataLocal(
      "LOAD DATA LOCAL INFILE 'orders.csv' " +
      "INTO TABLE staging_orders " +
      "FIELDS TERMINATED BY ',' LINES TERMINATED BY '\\n' " +
      '(id, customer_id, total)',
      csvText,
      {
        filename: 'orders.csv',
        maxBytes: 256 * 1024 * 1024,
        timeout: 300_000
      }
    );
  } finally {
    await db.end();
  }
}
```

Enable LOCAL INFILE only on clients that need it. Keep source size and filename checks explicit.

## SQLite transactional batch

SQLite does not need a network bulk-loader for normal embedded use. A prepared statement inside one transaction avoids per-row commit overhead.

```js
const { createConnection } = require('nubloxsql');

const db = createConnection('sqlite', { filename: 'app.db' });
const insert = db.prepare(
  'INSERT INTO staging_orders (id, customer_id, total) VALUES (?, ?, ?)'
);

db.begin('immediate');
try {
  for (const row of rows) {
    insert.run([row.id, row.customerId, row.total]);
  }
  db.commit();
} catch (error) {
  db.rollback();
  throw error;
} finally {
  db.close();
}
```

Chunk extremely large jobs into bounded transactions when one giant transaction would create unacceptable WAL/journal growth or recovery time.

## SQL Server prepared transaction batch

```js
const { createPool } = require('nubloxsql');

const pool = createPool('sqlserver', config);

await pool.withTransaction(async (connection) => {
  const statement = connection.prepare(
    'INSERT INTO staging_orders (id, customer_id, total) VALUES (@p1, @p2, @p3)'
  );

  try {
    for (const row of rows) {
      await statement.execute([row.id, row.customerId, row.total]);
    }
  } finally {
    await statement.close();
  }
});

await pool.end();
```

This is a safe current runtime pattern, not a claim that repeated prepared RPC is the fastest SQL Server bulk-loader available in the wider SQL Server ecosystem.

## Staging-table pattern

For imports that can partially fail, load into a staging table first:

1. create/import a batch identifier;
2. ingest source records into staging;
3. validate counts/types/referential rules;
4. move valid rows into production tables inside a transaction;
5. record rejected rows separately;
6. delete or archive the staging batch.

This separates transport success from business-data validity.

## Backpressure and bounds

Bulk ingestion must have explicit operational limits:

- maximum source bytes;
- maximum rows per batch;
- timeout/deadline;
- bounded producer queue;
- transaction size policy;
- disk/WAL/log capacity monitoring;
- failure/restart strategy.

Do not read a multi-gigabyte source fully into memory merely because an API accepts a string or Buffer; use iterable/streaming forms where available.

See [streaming](../guides/06-streaming-and-operation-control.md), [dialect behaviour](../guides/10-dialects.md), and [production operation](../guides/13-production-and-troubleshooting.md).
