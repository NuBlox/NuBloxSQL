# Public API

NuBloxSQL exposes one package entry point:

```js
const sql = require('nubloxsql');
```

For detailed, task-oriented usage see the [NuBloxSQL User Guides](guides/README.md).

## Primary entry points

- `createClient()` — create the unified client for a configured dialect.
- `createConnection()` — create a native dialect connection.
- `createPool()` — create a native pool where the dialect supports pooling.
- `sql` — tagged SQL, identifiers, named parameters and portable typed values.
- `introspect()` — one-shot metadata/schema introspection.
- `capabilityReport()` — static platform capability report.
- `transactionPolicy()` — portable transaction-policy description.
- `capabilityModel` — Tier-1 SQL compatibility, rewrite and compiler/transpilation surfaces.
- `capabilityOntology` — versioned atomic SQL capability definitions, engine observations and NuBlox implementation coverage.

## Capability ontology

`capabilityOntology` (`SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION === 1`) projects the existing exhaustive Tier-1 feature inventory into a formal registry without breaking the legacy capability API.

Every capability has a stable ID and definition. Engine observations keep separate axes for:

- support: `native`, `partial`, `emulated`, `unsupported`, `unknown` or `not-applicable`;
- availability: unconditional, version-, edition-, deployment-, engine-, connector-, extension-, component- or configuration-dependent;
- maturity: stable, preview, experimental, deprecated or removed;
- evidence: source documentation and legacy classification retained from the dialect profile.

NuBlox implementation coverage is separate from engine support and reports parser, AST, validator, renderer, rewrite and runtime stages. This prevents a database feature from being treated as compiler support merely because the target engine implements it.

```js
const { capabilityOntology } = require('nubloxsql');

const definition = capabilityOntology.definition('queries.cte.recursive');
const engine = capabilityOntology.observation('postgresql', 'queries.cte.recursive');
const nublox = capabilityOntology.implementation('queries.cte.recursive');
const resolved = capabilityOntology.resolve(
  'sqlite',
  'queries.joins.right',
  { version: '3.39.0' }
);
```

`profile(dialect)` returns the complete engine inventory. `inventory({ dialect, family, kind })` supports tooling and filtered capability browsers. `validate()` checks referential and state integrity of the generated ontology.

The original `capabilityModel.status()`, `compare()`, compatibility, runtime qualification, rewrite and compiler APIs remain supported. The ontology is an additive control-plane layer above them.

## Query diagnostics

Unified Tier-1 clients expose `client.diagnose(statement, options)` for PostgreSQL, MySQL and SQLite.

```js
const report = await db.diagnose(
  sql`SELECT id, name FROM users WHERE id = ${42}`,
  { analyze: false }
);

console.log(report.summary);
console.log(report.native);
```

The versioned report (`QUERY_DIAGNOSTICS_SCHEMA_VERSION === 1`) provides a deliberately small common summary: plan node count/depth, estimated and actual rows, estimated cost, planning time and execution time where the engine supplies semantically compatible evidence. Unsupported values remain `null` rather than being invented.

`report.native` retains the complete engine-native diagnostics payload. SQLite planner warnings are also exposed through the portable `warnings` array. Passing `analyze: true` uses native EXPLAIN ANALYZE semantics on PostgreSQL and MySQL; this executes the target statement. SQLite does not expose an EXPLAIN ANALYZE equivalent through this contract. SQL Server is not yet part of the qualified portable diagnostics surface and returns an explicit unsupported error.

Engine-specific diagnostic options remain available through the options object, including PostgreSQL EXPLAIN options, MySQL `allowMutation`, and SQLite `includeOpcodes`/statement-metadata options.

## Metadata

Metadata snapshots retain the native-rich database, schema, table, column, index, foreign-key and constraint evidence supplied by each dialect.

Snapshots also expose `snapshot.portable`, an immutable **portable metadata vocabulary v1**. It normalizes common object kinds, nullability, identity/auto-increment, generated columns, index key parts, referential actions and common constraint types while retaining native payloads. Engine-specific metadata remains authoritative where semantics cannot be represented portably.

## Public classes and contracts

The public surface also includes `Client`, `ClientRowStream`, `MetadataCatalog`, `NuBloxSqlError`, `Observer`, `TypeRegistry`, dialect adapters and SQL Core.

Client operations cover queries, execution, prepared statements, streaming, transactions, savepoints, operation control, query diagnostics, type codecs, metadata and observability. Native diagnostic information is retained when NuBloxSQL supplies a portable representation.

## Dialects

Canonical runtime dialect names are `mysql`, `postgresql`, `sqlite` and `sqlserver`. The current exhaustive ontology observations are generated from the Tier-1 PostgreSQL, MySQL and SQLite capability profiles; additional dialect profiles can be added without changing the ontology schema.

## Exact release contract

The exact exported JavaScript surface, package files, version and Node.js floor are machine-defined in `docs/releases/public-api-v1.json`.

The TypeScript package entry point is `types/root.d.ts`; portable metadata is declared in `types/portable-metadata.d.ts`, portable query diagnostics in `types/diagnostics.d.ts`, and the SQL capability ontology in `types/capability-ontology.d.ts`.

Release qualification checks both JavaScript and strict TypeScript consumer installation from the packed npm artifact.
