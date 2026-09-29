# @nublox/sql-core

`@nublox/sql-core` is the **portable contract layer of the NuBloxSQL platform**.

## Role in NuBloxSQL

SQL Core defines the concepts that consumers and adapters can rely on across database families without pretending those families are identical.

It is not a database driver, ORM, parser or proxy. It is the platform's stable semantic vocabulary.

## Status

| Item | Value |
| --- | --- |
| Package | `@nublox/sql-core` |
| Version | `1.0.0` |
| Status | **Stable** |
| Contract family | `1.0` |
| Stable baseline | NuBloxSQL `v1.0.0` |
| Node.js | 22, 24, 26 |

## Platform contract

Contract family `1.0` covers:

- dialect identity;
- capability metadata;
- identifier quoting and placeholder services;
- object-name hierarchy;
- cancellation/timeout vocabulary;
- bounded result policy;
- positional execution parameters;
- row/command result shapes;
- portable field metadata with native extension space;
- transaction isolation/read-only policy;
- portable error categories with native diagnostic preservation.

## Native semantics remain native

SQL Core deliberately does not flatten database-specific behaviour. Examples include:

- MySQL `?` versus PostgreSQL `$1` placeholders;
- PostgreSQL schema semantics versus MySQL catalog/database semantics;
- PostgreSQL CancelRequest versus MySQL connection-aborting cancellation behaviour;
- SQLite embedded locking/storage semantics;
- vendor-native cursor, portal, type and replication models.

## Quick start

```js
const sql = require('@nublox/sql-core');

console.log(sql.CONTRACT_VERSION); // 1.0
console.log(sql.CAPABILITIES.PREPARED_STATEMENTS);
console.log(sql.ERROR_CATEGORIES.RESOURCE_LIMIT);
```

## Evolution rule

Portable contracts are earned from real adapters. A new abstraction should enter SQL Core only when multiple adapters prove it can be expressed honestly without erasing native semantics.

Breaking changes to contract family `1.0` require a new major package version.

## Verification and dependency boundary

The package declares no third-party npm runtime, development, optional or peer dependencies.

```bash
npm run test --workspace @nublox/sql-core
```

## Related documentation

- [NuBloxSQL overview](../../README.md)
- [Design intent](../../docs/architecture/design-intent.md)
- [Multi-dialect architecture](../../docs/architecture/multi-dialect.md)
- [Frozen SQL Core v1 contract](../../docs/v1/SQL-CORE-V1-CONTRACT.md)

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
