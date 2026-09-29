# SQL Core

## Role inside NuBloxSQL

This workspace defines the shared contract vocabulary used internally by NuBloxSQL runtimes and by the public `nubloxsql` facade.

Application developers should normally install and import **NuBloxSQL once** rather than install SQL Core separately.

## Status

- Contract version: `1.0.0`
- Contract family: **1.0**
- Status: **Stable**
- Qualified Node.js: **22, 24, 26**

## What it implements

- dialect identity and capability metadata;
- identifier quoting and placeholder service contracts;
- object-name/catalog/schema vocabulary;
- cancellation and timeout vocabulary;
- bounded result policy;
- row/command result shapes;
- portable field metadata and native extension space;
- transaction policy;
- portable error categories and native diagnostic preservation.

SQL Core intentionally does **not** own database protocols, authentication, storage, locking, native type codecs or database-specific lifecycle behaviour.

## How NuBloxSQL reaches it

```js
const sql = require('nubloxsql');

console.log(sql.sqlCore.CONTRACT_VERSION);
```

SQL Core supports the facade and dialect runtimes. It is not the intended primary developer entry point.

## Native semantics

A concept belongs in SQL Core only when multiple real dialects prove that it is genuinely portable. Native behaviour stays inside the corresponding runtime and remains reachable through NuBloxSQL.

## Verification

```bash
npm run test:sql-core
npm run verify
```

The workspace declares no third-party npm runtime, development, optional or peer dependencies.

## Licence

Proprietary software. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
