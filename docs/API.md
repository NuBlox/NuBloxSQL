# Public API

NuBloxSQL exposes one package entry point:

```js
const sql = require('nubloxsql');
```

## Primary entry points

- `createClient()` — create the unified client for a configured dialect.
- `createConnection()` — create a native dialect connection.
- `createPool()` — create a native pool where the dialect supports pooling.
- `sql` — tagged SQL, identifiers, named parameters and portable typed values.
- `introspect()` — one-shot metadata/schema introspection.
- `capabilityReport()` — static platform capability report.
- `transactionPolicy()` — portable transaction-policy description.
- `capabilityModel` — Tier-1 SQL capability, compatibility, rewrite and current compiler/transpilation surfaces.

## Public classes and contracts

The public surface also includes `Client`, `ClientRowStream`, `MetadataCatalog`, `NuBloxSqlError`, `Observer`, `TypeRegistry`, dialect adapters and SQL Core.

Client operations cover queries, execution, prepared statements, streaming, transactions, savepoints, operation control, type codecs, metadata and observability. Native diagnostic information is retained when NuBloxSQL supplies a portable representation.

## Dialects

Canonical dialect names are `mysql`, `postgresql`, `sqlite` and `sqlserver`. Supported aliases are defined by the public type declarations and routing implementation.

## Exact release contract

This guide is intentionally concise. The exact exported JavaScript surface, package files, version and Node.js floor are machine-defined in `docs/releases/public-api-v1.json`.

The TypeScript source of truth is `types/public.d.ts`.

Release qualification checks both JavaScript and strict TypeScript consumer installation from the packed npm artifact.
