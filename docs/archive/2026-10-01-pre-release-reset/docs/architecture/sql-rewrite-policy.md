# Tier-1 SQL rewrite policy

NuBloxSQL M7 turns the Tier-1 PostgreSQL, MySQL and SQLite capability model into a conservative rewrite policy.

## Scope

M7 has two layers:

1. **Capability-aware planning** — classify each requested semantic capability as `preserve`, `rewrite`, `emulate`, `qualify`, or `reject`.
2. **Executable lexical rewrites** — apply only transformations that can be proven without a full SQL parser. The first executable rule is parameter-marker translation.

M7 does **not** claim that an arbitrary SQL string has been fully translated between dialects. Whole-statement certification is deferred to the parser/AST/compiler architecture in M8.

## Planning API

```js
const plan = sql.capabilityModel.planRewrite(
  'postgresql',
  'sqlite',
  [
    'queries.joins.inner',
    'queries.joins.right',
    'queries.joins.lateral'
  ],
  { targetQualification }
);
```

A plan contains a decision per capability and summary flags:

- `blocked` — at least one requested capability cannot be represented safely.
- `requiresQualification` — runtime evidence is still required.
- `requiresTransformation` — an explicit rewrite or emulation is required.
- `safeToProceed` — there are no rejected or unresolved capabilities.

### Decision actions

- `preserve` — native semantics can be retained without a documented syntax rewrite.
- `rewrite` — the target provides the capability but requires an explicit syntax/equivalent transformation.
- `emulate` — a NuBloxSQL/application strategy is required.
- `qualify` — static knowledge is insufficient; M6 runtime evidence is required.
- `reject` — the target is unsupported, not applicable, partial, or otherwise unsafe for automatic transfer.

`partial` support is deliberately rejected by default. M7 does not convert partial support into a misleading success result.

## Runtime-aware planning

`rewriteDecision()` and `planRewrite()` accept M6 source and target qualification reports:

```js
const targetQualification = await sql.capabilityModel.qualifyClient(sqliteClient);

const decision = sql.capabilityModel.rewriteDecision(
  'postgresql',
  'sqlite',
  'queries.joins.right',
  { targetQualification }
);
```

For example, SQLite `RIGHT JOIN` is version-dependent. A qualified SQLite runtime before 3.39 resolves the decision to `reject`; a qualifying runtime can resolve it to `preserve`.

## Parameter-marker rewrite

```js
const result = sql.capabilityModel.rewriteSql(
  'postgresql',
  'mysql',
  'SELECT * FROM users WHERE tenant_id = $2 AND id = $1'
);
```

The result contains rewritten SQL plus a binding map:

```js
{
  sql: 'SELECT * FROM users WHERE tenant_id = ? AND id = ?',
  parameters: {
    targetToSource: [2, 1]
  }
}
```

The binding map is critical: PostgreSQL numbered parameters may appear out of order or repeatedly, while MySQL uses positional `?` markers by occurrence.

The lexical rewriter ignores marker-like text inside:

- single-quoted strings,
- quoted identifiers,
- MySQL backtick identifiers,
- line comments,
- block comments,
- PostgreSQL dollar-quoted bodies.

SQLite native `?NNN`, bare `?`, and simple named `:name`, `@name`, `$name` bindings are mapped explicitly when targeting another Tier-1 dialect.

## Safety boundary

`rewriteSql()` currently guarantees only the transformations listed in `result.rules`. `lossless: true` means those applied rules preserve their own binding semantics; it is **not** a declaration that every construct in the SQL statement is portable.

Until M8 parses the SQL into an AST, M7 intentionally does not automatically rewrite constructs such as:

- PostgreSQL `ILIKE`,
- `SERIAL` / identity definitions,
- `ON CONFLICT` to MySQL `INSERT IGNORE` or `ON DUPLICATE KEY`,
- vendor-specific casts,
- JSON operators,
- DDL object definitions,
- procedural SQL,
- vendor-specific functions or operators.

Those transformations can differ in collation, error handling, constraint behavior, type semantics, side effects, or evaluation rules. NuBloxSQL should reject or require explicit transformation rather than silently producing SQL that merely looks plausible.

## Direction to M8

M7 supplies the policy engine that M8 will consume:

```text
SQL text
  -> parser
  -> AST capability inventory
  -> M6 runtime qualification
  -> M7 rewrite decisions
  -> AST transformation rules
  -> target compiler
  -> target SQL + diagnostics
```

This separation keeps capability knowledge, runtime evidence, rewrite policy, parsing, transformation, and compilation independently testable.
