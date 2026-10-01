# NuBloxSQL Design Intent

## Product objective

NuBloxSQL is designed to become the **single developer-facing SQL integration layer for multiple database dialects**.

A developer should not need to choose, install and wire together a different package for MySQL, PostgreSQL, SQLite, SQL Server, Oracle and future dialects. The intended experience is:

```bash
npm install nubloxsql
```

followed by one import:

```js
const sql = require('nubloxsql');
```

and one platform API that selects the appropriate dialect runtime from configuration.

## Core promise

**One install. One import. One coherent platform. Multiple SQL dialects.**

NuBloxSQL must make multi-dialect integration simpler for application developers without lying about the differences between database engines.

That means the platform should unify:

- connection creation;
- pooling where supported;
- execution/result vocabulary;
- transaction entry points;
- capability discovery;
- error categorisation;
- resource-limit policy;
- metadata access patterns;
- access to native extensions.

It must not erase real differences in:

- wire protocols;
- authentication;
- storage models;
- locking;
- type systems;
- schemas/catalogs/databases;
- cancellation;
- cursors/streaming;
- replication/CDC;
- vendor-specific SQL features.

## Architecture

NuBloxSQL has three internal layers.

### 1. Public platform facade

The root `nubloxsql` package is the canonical developer surface.

It is responsible for:

- accepting the selected dialect;
- routing connection/pool creation to the correct runtime;
- exposing capability discovery;
- exposing the shared SQL contract vocabulary;
- providing access to dialect-native functionality through the same installation.

Application code should normally enter NuBloxSQL here.

### 2. Shared SQL contracts

The SQL Core workspace contains portable vocabulary proven useful across multiple real dialects.

These contracts exist to keep behaviour coherent, not to force every engine into the same shape.

A concept belongs in shared core only when it can be represented honestly across multiple database families.

### 3. Native dialect runtimes

Each dialect runtime owns its real database behaviour.

Examples include:

- MySQL protocol/authentication/session behaviour;
- PostgreSQL protocol/OIDs/portals/CancelRequest semantics;
- SQLite embedded storage/locking/transaction behaviour;
- future SQL Server and Oracle native semantics.

Internal workspace boundaries are an engineering implementation detail. They are not intended to require multiple developer installations.

## Public API direction

The canonical API is dialect-selected:

```js
const sql = require('nubloxsql');

const db = sql.createConnection({
  dialect: 'mysql',
  host: '127.0.0.1',
  user: 'app',
  database: 'app'
});
```

The same shape applies to other dialects:

```js
sql.createConnection({ dialect: 'postgresql', ...config });
sql.createConnection({ dialect: 'sqlite', filename: './app.db' });
```

Native access remains available from the same package:

```js
sql.mysql
sql.postgresql
sql.sqlite
```

Developers should not need another installation merely to reach native behaviour.

## Design invariants

### One entry point is mandatory

The long-term public product is NuBloxSQL itself, not a shopping list of driver packages.

### Internal packages are implementation boundaries

Dialect workspaces may be independently tested and versioned internally, but the normal developer installation path is the NuBloxSQL facade.

### No lowest-common-denominator design

The platform must not remove valuable native semantics just to make all engines look identical.

### Capability discovery over pretending

If an engine does not support a capability, NuBloxSQL should report that explicitly.

### Native extensions remain first-class

A developer must be able to use dialect-specific power without leaving NuBloxSQL or installing another driver.

### Data fidelity before convenience

Precision, timezone meaning, binary fidelity and vendor-specific diagnostics must not be silently discarded.

### Portable contracts are earned

Shared abstractions are promoted only after real dialect implementations prove them useful and semantically honest.

### Evidence defines support

Stable support claims require executable tests, live-server qualification where applicable, security validation and documented release evidence.

## What NuBloxSQL is not

NuBloxSQL is not:

- an ORM;
- a universal SQL transpiler;
- a lowest-common-denominator abstraction;
- a wrapper requiring developers to install separate database drivers themselves;
- a collection of unrelated products sharing a repository.

## Success condition

NuBloxSQL succeeds when a developer can adopt one dependency and use it confidently across SQL database families while still retaining direct access to the strengths and semantics of each database engine.
