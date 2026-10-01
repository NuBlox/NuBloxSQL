# Joins, CTEs and reporting

**Scope:** portable SQL pattern for PostgreSQL, MySQL and SQLite. SQL Server requires its own pagination syntax, so the final paginated query is intentionally Tier-1 only.

## Scenario

Assume three tables:

```sql
customers(id, name, region)
orders(id, customer_id, ordered_at, status)
order_lines(order_id, product_id, quantity, unit_price)
```

You need a report showing revenue and order count by customer over a date range.

```js
const { createClient, sql } = require('nubloxsql');

async function customerRevenue(db, options) {
  return db.all(sql`
    WITH order_totals AS (
      SELECT
        o.id,
        o.customer_id,
        SUM(ol.quantity * ol.unit_price) AS order_total
      FROM orders o
      JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.ordered_at >= ${options.from}
        AND o.ordered_at < ${options.to}
        AND o.status = ${'completed'}
      GROUP BY o.id, o.customer_id
    )
    SELECT
      c.id,
      c.name,
      c.region,
      COUNT(ot.id) AS order_count,
      COALESCE(SUM(ot.order_total), 0) AS revenue
    FROM customers c
    LEFT JOIN order_totals ot ON ot.customer_id = c.id
    WHERE (${options.region || null} IS NULL OR c.region = ${options.region || null})
    GROUP BY c.id, c.name, c.region
    ORDER BY revenue DESC, c.id
    LIMIT ${options.limit || 100}
  `);
}
```

## Why the CTE helps

The `order_totals` CTE establishes one row per order before joining to customers. That prevents line-level multiplicity from distorting the final order count.

This is an important reporting pattern:

1. aggregate at the lowest business grain you need;
2. join the aggregate to higher-level entities;
3. aggregate again only when the final report requires it.

## Multiple joins

A normal multi-table detail query can remain straightforward:

```js
const rows = await db.all(sql`
  SELECT
    o.id AS order_id,
    c.name AS customer_name,
    p.sku,
    ol.quantity,
    ol.unit_price,
    ol.quantity * ol.unit_price AS line_total
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN order_lines ol ON ol.order_id = o.id
  JOIN products p ON p.id = ol.product_id
  WHERE o.id = ${orderId}
  ORDER BY p.sku
`);
```

## Optional filters

Do not build optional filters by string concatenation. Prefer either a fixed predicate pattern or compose trusted SQL fragments.

```js
const filters = [sql`o.status = ${'completed'}`];
if (region) filters.push(sql`c.region = ${region}`);
if (minimumTotal != null) filters.push(sql`ot.order_total >= ${minimumTotal}`);

const where = sql.join(filters, ' AND ');
```

Then interpolate the fragment into a larger tagged statement.

## Reporting pagination

Offset pagination is simple but can become expensive and unstable on changing datasets. For large reports, prefer keyset pagination using a deterministic ordering key.

```js
const rows = await db.all(sql`
  SELECT id, ordered_at, customer_id
  FROM orders
  WHERE id > ${lastSeenId}
  ORDER BY id
  LIMIT ${pageSize}
`);
```

Keyset pagination avoids scanning and discarding an ever-growing offset.

## Data types and totals

Financial reporting requires deliberate numeric handling. Do not assume every dialect returns exact numeric values as JavaScript `number`. Use NuBloxSQL typed values/type codecs where exact decimal semantics matter, and define application-level decimal handling consistently.

See [SQL and typed values](../guides/03-sql-parameters-and-types.md), [type codecs](../guides/09-observability-and-type-codecs.md), and [capability analysis](../guides/11-capabilities-and-portability.md).
