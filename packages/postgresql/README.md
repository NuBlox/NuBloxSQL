# @nublox/postgresql

PostgreSQL dialect foundation for NuBloxSQL.

This package currently defines PostgreSQL identity, capabilities, identifier quoting, positional placeholders, and catalog/schema/object naming semantics. It deliberately does **not** implement PostgreSQL wire-protocol connectivity yet.

## Current surface

```js
const postgresql = require('@nublox/postgresql');

postgresql.services.quoteIdentifier('order'); // "order"
postgresql.services.placeholder(1);            // $1
postgresql.descriptor.supports('schemas');     // true
```

The descriptor is validated against the vendor-neutral contracts in `@nublox/sql-core` by repository contract tests while remaining runtime-independent during this foundation phase.

## Scope boundary

Protocol framing, authentication, connections, pooling, query execution and replication are future implementation waves. They will be added only after the shared contracts have been pressure-tested against both MySQL and PostgreSQL semantics.
