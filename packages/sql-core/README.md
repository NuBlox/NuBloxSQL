# @nublox/sql-core

Portable contract and dialect vocabulary for NuBloxSQL adapters.

## Status

- Package: `@nublox/sql-core`
- Version: `1.0.0`
- Status: **Stable**
- Contract family: **1.0**
- NuBloxSQL baseline: **v1.0.0**
- Node.js: **22, 24, 26**

## Purpose

SQL Core defines the vendor-neutral contracts that real adapters have proven portable. It is intentionally transport-free: protocols, authentication, native type codecs, replication, storage and vendor-specific lifecycle behaviour remain inside adapters.

## Stable contract surface

Contract family `1.0` covers:

- dialect identity and capability metadata;
- identifier quoting and placeholder services;
- catalog/schema/object-name vocabulary without pretending those concepts are identical;
- structural cancellation signals and relative timeout policy;
- bounded result policy: `maxRows`, `maxResultBytes`, `maxRowBytes`;
- positional execution parameters;
- row and command result shapes;
- portable field metadata with adapter extension space;
- transaction isolation/read-only policy;
- error categories, native diagnostic preservation, retryability and resource-limit evidence.

## Deliberately adapter-specific

SQL Core does not freeze vendor details merely to make adapters look uniform. Examples include:

- MySQL `?` versus PostgreSQL `$1` placeholders;
- PostgreSQL schemas versus MySQL database/catalog semantics;
- PostgreSQL native CancelRequest versus MySQL connection-aborting cancellation behaviour;
- vendor-native cursor/portal packet models;
- vendor-native type codecs;
- absolute deadline extensions that are not genuinely portable.

## Quick start

```js
const sql = require('@nublox/sql-core');

console.log(sql.CONTRACT_VERSION); // 1.0
console.log(sql.CAPABILITIES.PREPARED_STATEMENTS);
console.log(sql.ERROR_CATEGORIES.RESOURCE_LIMIT);
```

Adapters expose their own runtime APIs directly. SQL Core is contract vocabulary, not a wrapper driver.

## Compatibility policy

Breaking changes to contract family `1.0` require a new major package version. Adapter-specific features do not require SQL Core changes unless multiple adapters demonstrate a genuinely portable contract.

## Dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies.

## Related documentation

- `../../README.md`
- `../../docs/architecture/multi-dialect.md`
- `../../docs/v1/SQL-CORE-V1-CONTRACT.md`
- `../../docs/v1/V1-SUPPORT-MATRIX.md`

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
