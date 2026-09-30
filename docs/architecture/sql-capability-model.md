# NuBloxSQL SQL Capability Model

## Purpose

The SQL Capability Model is the machine-readable semantic layer above NuBloxSQL dialect drivers. It describes what a database can express, how it expresses it, and whether the capability is native, equivalent, emulated, partial, runtime-dependent, unsupported, unknown, or not applicable.

The first-class Tier-1 dialects are PostgreSQL, MySQL and SQLite. SQL Server remains a supported NuBloxSQL runtime dialect but is intentionally outside the exhaustive Tier-1 capability programme at this stage.

## Model categories

Every Tier-1 model has the same required categories:

- `statements`
- `queries`
- `schema`
- `expressions`
- `integrity`
- `physical`
- `security`
- `transactions`
- `programmability`
- `administration`
- `dataMovement`
- `extensions`
- `types`
- `functions`
- `operators`
- `keywords`
- `syntax`
- `limits`

A category may be sparse during foundation work, but it may not be absent. This makes the shape stable while coverage deepens.

## Capability entries

A leaf capability is not a boolean. Its stable foundation shape is:

```js
{
  supported: true | false | null,
  support: 'native' | 'equivalent' | 'emulated' | 'partial' |
           'runtime-dependent' | 'unsupported' | 'unknown' | 'not-applicable',
  nativeName: null,
  since: null,
  syntax: null,
  evidence: 'documented',
  restrictions: [],
  aliases: [],
  equivalentTo: [],
  notes: null
}
```

`null` support means the answer cannot be determined statically and must be established from runtime/server evidence.

## Public API

```js
const sql = require('nubloxsql');

const pg = sql.capabilityModel.dialect('postgresql');
const lateral = sql.capabilityModel.status('postgresql', 'queries.joins.lateral');
const supported = sql.capabilityModel.supports('mysql', 'queries.joins.lateral');
const comparison = sql.capabilityModel.compare('queries.joins.lateral');
```

`compare()` defaults to all Tier-1 dialects and returns both `portable` and `determinate` flags. A runtime-dependent capability is not treated as portable until runtime evidence resolves it.

## Foundation versus exhaustive coverage

Schema version 1 begins with `coverage: "foundation"`. This milestone defines and release-qualifies the semantic contract and seeds representative capabilities across every category. It does **not** claim exhaustive dialect coverage.

The planned sequence is:

1. M1 — model schema and public API.
2. M2 — exhaustive PostgreSQL map.
3. M3 — exhaustive MySQL map.
4. M4 — exhaustive SQLite map, including runtime/compile probes.
5. M5 — comparison and compatibility analysis.
6. M6 — version-aware runtime qualification.
7. M7 — rewrite/compatibility engine.
8. M8 — AST/parser/compiler architecture.

## Design rules

1. Preserve native semantics. Do not mark a capability unsupported merely because another dialect uses different syntax.
2. Keep static knowledge separate from runtime evidence.
3. Prefer `equivalent` over pretending two different native constructs are identical.
4. Prefer `partial` when a construct has material semantic restrictions.
5. Use `not-applicable` for server concepts SQLite intentionally does not have, such as database users and grants.
6. Unknown is preferable to an unverified claim.
7. Capability data is deeply frozen and safe for shared use.
8. Legacy `descriptor.supports()` remains intact. The SQL Capability Model is a richer layer, not a breaking replacement.

## Initial authoritative references

The foundation map is based on vendor documentation, including:

- PostgreSQL 18 `SELECT` / CTE / LATERAL documentation: https://www.postgresql.org/docs/18/sql-select.html
- PostgreSQL materialized views: https://www.postgresql.org/docs/18/rules-materializedviews.html
- PostgreSQL `COPY`: https://www.postgresql.org/docs/18/sql-copy.html
- MySQL 9.7 common table expressions: https://dev.mysql.com/doc/refman/9.7/en/with.html
- MySQL lateral derived tables: https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html
- MySQL window functions: https://dev.mysql.com/doc/refman/9.7/en/window-function-descriptions.html
- SQLite common table expressions: https://www.sqlite.org/lang_with.html
- SQLite generated columns: https://www.sqlite.org/gencol.html

Each exhaustive dialect milestone must expand the evidence register and tests rather than relying only on the foundation references above.
