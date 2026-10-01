# MySQL Structured Query Diagnostics

## Purpose

NuBloxSQL exposes MySQL-native `EXPLAIN FORMAT=JSON` and `EXPLAIN ANALYZE` through a structured, immutable JavaScript contract. The API remains MySQL-specific: NuBloxSQL preserves the native plan document and only adds conservative factual summary fields.

## Public API

```js
const report = await connection.explain(
  'SELECT amount FROM invoice WHERE customer_id = ?',
  [42]
);
```

```js
const report = await connection.explainAnalyze(
  'SELECT SUM(amount) FROM invoice WHERE amount >= ?',
  [100]
);
```

The same methods are available on the MySQL pool:

- `pool.explain(...)`
- `pool.explainAnalyze(...)`
- `pool.diagnoseQuery(...)`

`diagnoseQuery(...)` is the non-executing `explain(...)` alias.

## Result contract

Each report contains:

- `format: 'json'`;
- `analyzed`;
- `statementExecuted`;
- `jsonFormatVersion`;
- `plan` — the complete native MySQL JSON document;
- `root` — the best available native root (`query_plan`, `query_block`, or the document itself);
- `summary` — conservative fields such as node count, depth, tables, access types, operations and native estimated/actual values when directly present.

NuBloxSQL does not generate tuning recommendations or reinterpret plan semantics as portable SQL facts.

## JSON format versions

MySQL 8.4 and MySQL 9.7 differ in their JSON-format defaults. NuBloxSQL therefore treats the server setting as session state rather than assuming one global format.

For ordinary `explain()` calls, the server's current JSON format is retained and reported.

For `explainAnalyze()`, NuBloxSQL temporarily sets `SESSION explain_json_format_version = 2`, because JSON v2 exposes iterator-based actual execution metrics in machine-readable form. The previous session value is restored in `finally` cleanup. If restoration cannot be guaranteed, the physical connection is destroyed rather than returned to application or pool use with leaked session state.

## Execution safety

`EXPLAIN ANALYZE` executes the statement. NuBloxSQL therefore permits leading `SELECT` and `TABLE` statements by default and rejects other statement forms unless the caller explicitly sets:

```js
{ allowMutation: true }
```

This is intentionally stricter than raw MySQL. Ambiguous forms such as leading `WITH` require explicit opt-in because a CTE can precede a mutating statement.

The report always exposes `statementExecuted: true` for analyze operations and `false` for ordinary explain operations.

## Parameters and operation control

Parameterized diagnostics use NuBloxSQL's prepared-statement path rather than interpolating values into SQL text.

Diagnostics propagate the normal operation controls:

- timeout;
- deadline;
- abort signal;
- result row/byte limits.

Pool calls also accept the standard acquisition options.

## Qualification

The contract is qualified across:

- Node.js 22, 24 and 26;
- MySQL 8.4 LTS;
- MySQL 9.7;
- parameterized `EXPLAIN FORMAT=JSON`;
- JSON-v2 `EXPLAIN ANALYZE`;
- session-format restoration;
- mutation-safety rejection;
- pooled diagnostics and connection reuse;
- full NuBloxSQL regression/security/release gates.
