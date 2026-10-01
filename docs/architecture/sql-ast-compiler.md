# NuBloxSQL Tier-1 SQL AST/compiler foundation

M8 introduces a conservative dialect-neutral SQL AST and compiler pipeline for PostgreSQL, MySQL and SQLite.

## Purpose

The AST is the structural boundary between dialect SQL text and future semantic transformations. It allows NuBloxSQL to reason about a statement before rewriting it, instead of applying regex-based substitutions to arbitrary SQL.

## Public API

```js
const ast = sql.capabilityModel.parseSql('postgresql', sourceSql);
const analysis = sql.capabilityModel.analyzeAst(ast);
const compiled = sql.capabilityModel.compileAst('mysql', ast);
const result = sql.capabilityModel.transpileSql('postgresql', 'mysql', sourceSql, options);
```

`transpileSql()` connects the M8 AST to the M5/M6/M7 capability stack:

1. parse source SQL into a structural AST;
2. extract the capability paths required by that AST;
3. apply static and optional runtime-qualified rewrite policy;
4. reject unsupported or unresolved target semantics by default;
5. compile the AST using target-dialect identifier and parameter syntax.

## Foundation grammar

The v1 foundation deliberately supports a bounded `SELECT` grammar:

- `SELECT` and `DISTINCT`;
- projection expressions and aliases;
- qualified/unqualified identifiers and wildcards;
- string, numeric, boolean and NULL literals;
- PostgreSQL `$n`, MySQL `?`, and SQLite positional/named parameters;
- scalar function calls;
- unary `NOT`, `+`, `-`;
- arithmetic, concatenation, comparison, boolean, `LIKE`, `IS [NOT]`, and `IN` expressions;
- one base table;
- `INNER`, `LEFT`, `RIGHT`, `FULL`, and `CROSS` joins;
- `WHERE`;
- `GROUP BY` and `HAVING`;
- `ORDER BY ASC|DESC`;
- `LIMIT` and `OFFSET`.

Anything outside the grammar fails closed with a `SyntaxError`. This includes CTEs, subqueries, set operators, windows, vendor-specific operators, DML, and DDL until their AST nodes and semantic rules are implemented.

## Dialect compilation

The compiler emits:

- PostgreSQL/SQLite identifiers with double quotes;
- MySQL identifiers with backticks;
- PostgreSQL parameters as `$n`;
- SQLite parameters as numbered `?n` markers;
- MySQL parameters as occurrence-based `?` markers.

The compiler also returns `targetToSource`, an explicit binding map. Repeated SQLite named parameters and repeated PostgreSQL numbered parameters therefore remain deterministic when compiled to another marker model.

## Capability extraction

The foundation extracts structural capabilities such as:

- `statements.select`;
- `queries.distinct.standard`;
- join kind paths;
- grouping/HAVING;
- ordering;
- LIMIT/OFFSET pagination.

`transpileSql()` feeds these paths to the M7 rewrite planner. For example, PostgreSQL `FULL JOIN` is rejected for MySQL, while SQLite `RIGHT JOIN` requires M6 runtime qualification because its support is version-dependent.

## Certification boundary

A result can report `certified: true` only for the grammar that M8 actually parsed and structurally compiled, and only when its capability plan is safe and lossless. It does not certify unmodelled database semantics such as collation, implicit casts, function equivalence, or vendor-specific execution behavior.

This boundary is intentional. Future M8 increments should add AST nodes first, semantic capability extraction second, and compiler transformations last.

## Next increments

The natural expansion order is:

1. CTEs and recursive CTEs;
2. derived tables and subqueries;
3. set operators;
4. window specifications and functions;
5. CASE/casts and richer expressions;
6. INSERT/UPDATE/DELETE and RETURNING;
7. UPSERT/MERGE semantic nodes;
8. DDL and schema AST;
9. vendor-extension nodes and rewrite strategies.
