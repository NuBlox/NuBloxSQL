# @nublox/sql-core

`@nublox/sql-core` defines the stable vendor-neutral contracts and small runtime vocabularies shared by NuBloxSQL database adapters.

It is intentionally transport-free. Database protocols, authentication, wire formats, native type codecs, replication/change-data-capture implementations and server-specific behaviour belong in dialect adapters.

## v1 contract philosophy

SQL Core does **not** make MySQL and PostgreSQL look identical. It freezes only concepts that the canonical adapters have both proved, or cross-dialect policy vocabulary that consumers genuinely need.

Vendor-specific behavior remains first class in each adapter. For example:

- MySQL placeholders are `?`; PostgreSQL placeholders are `$1`, `$2`, ...;
- PostgreSQL exposes schemas while the MySQL adapter does not claim PostgreSQL-style schema semantics;
- PostgreSQL implements native server cancellation with CancelRequest; MySQL v1 treats cancellation as connection-aborting behavior and therefore reports `queryCancellation: false` as a dialect capability;
- MySQL may expose absolute deadlines as an adapter extension, while the portable v1 operation contract freezes the relative `timeout` and cancellation-signal concepts both adapters implement.

The runtime constant `CONTRACT_VERSION` is `1.0` for this contract family.

## Frozen v1 portable surface

The v1 contract covers:

- dialect identity, capabilities, identifier quoting and placeholders;
- catalog/schema/name object identity without pretending those database concepts are equivalent;
- structural abort signals and relative operation timeout policy;
- bounded result policy: `maxRows`, `maxResultBytes`, `maxRowBytes`;
- positional execution parameters;
- row-result and command-result shapes;
- portable field metadata with explicit vendor extension space;
- transaction isolation and read-only policy;
- error categorisation, native code/SQLSTATE preservation, retryability and resource-limit evidence;
- explicit native adapter extension points.

## Deliberately not frozen in v1

SQL Core v1 does not freeze abstractions that are not proven by both production adapters:

- generic named-parameter maps;
- generic multi-result-set containers;
- a universal absolute-deadline option;
- CDC/replication contracts;
- multiple-active-result semantics;
- vendor-specific cursor/portal packet models;
- vendor-specific type codecs.

Those can be added in a later contract version when multiple adapters demonstrate a genuinely portable need.

## Example

```js
const sql = require('@nublox/sql-core');

console.log(sql.CONTRACT_VERSION); // 1.0
console.log(sql.CAPABILITIES.PREPARED_STATEMENTS); // preparedStatements
console.log(sql.ERROR_CATEGORIES.RESOURCE_LIMIT); // resource-limit
```

Adapters expose their native APIs directly. SQL Core is a shared contract vocabulary, not an extra driver wrapper layer.

## Independence

This package is part of NuBloxSQL and has no dependency on any other NuBlox project or third-party npm package. It remains independently testable, versionable and publishable.

## Stability

`@nublox/sql-core@1.0.0` is the stable contract-family 1.0 release. Breaking changes to the frozen contract require a new major version; adapter-specific additions do not require SQL Core changes unless they become genuinely portable concepts.

## Licence

Proprietary. Copyright (c) 2026 Stephen J T Spittal. See `LICENSE`.
