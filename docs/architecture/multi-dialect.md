# NuBloxSQL Multi-Dialect Architecture

## Architectural decision

NuBloxSQL presents **one public developer entry point** over multiple SQL dialect runtimes.

The developer-facing dependency is `nubloxsql`. Dialect workspaces exist inside the repository to isolate implementation, testing and database-specific behaviour; they are not the intended installation model for application developers.

```text
                      application
                          │
                          ▼
                    require('nubloxsql')
                          │
                          ▼
                 public platform facade
                          │
                 dialect + capability routing
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
       MySQL          PostgreSQL         SQLite
    native runtime    native runtime   embedded runtime
```

## Public facade responsibility

The root facade owns the common developer entry points:

- `createConnection(...)`;
- `createPool(...)` where supported;
- `adapter(...)` for explicit native access;
- `descriptor(...)` and `supports(...)` for capability discovery;
- shared SQL contract access;
- dialect namespaces from the same installation.

Dialect selection is explicit. The facade does not guess silently when doing so could change semantics.

## Internal runtime responsibility

Each dialect runtime owns what is truly database-specific.

### MySQL

- classic MySQL protocol framing;
- authentication plugins and SHA-2 flows;
- server-side prepared-statement binary protocol;
- session state/reset;
- MySQL transaction and error behaviour;
- streaming/backpressure and pooling.

### PostgreSQL

- startup/TLS/authentication protocol;
- simple and extended query protocols;
- OID/type decoding;
- prepared statements;
- portals/cursors;
- native CancelRequest semantics;
- PostgreSQL transaction/error behaviour.

### SQLite

- embedded database lifecycle;
- synchronous `node:sqlite` execution;
- transaction modes and savepoints;
- locking/storage semantics;
- affinity/STRICT behaviour;
- embedded introspection and lifecycle operations.

Future SQL Server and Oracle runtimes must follow the same architectural boundary.

## Shared contracts

SQL Core contains only concepts that multiple dialects have proven portable, including:

- dialect identity;
- capability vocabulary;
- identifier/placeholder services;
- result and field metadata shapes;
- resource limits;
- transaction policy;
- error categories;
- object-name qualification;
- native extension points.

Shared core is a contract layer, not the developer entry point and not a replacement for native runtime semantics.

## One-install packaging rule

The published NuBloxSQL package must contain the supported dialect runtimes required by the public facade.

Developers should not need to install:

```text
@nublox/mysql
@nublox/postgresql
@nublox/sqlite
```

in order to use those dialects through NuBloxSQL.

Those names may continue to exist as repository/workspace boundaries and may remain useful for internal testing or specialist packaging decisions, but the default public integration contract is the root NuBloxSQL package.

## Native escape hatches

Uniform entry points must not become a lowest-common-denominator abstraction.

The same installation therefore exposes native runtime namespaces:

```js
const sql = require('nubloxsql');

sql.mysql;
sql.postgresql;
sql.sqlite;
```

This allows advanced features without requiring a second driver package.

## Capability model

Consumers must query capabilities rather than infer them from dialect names.

```js
sql.supports('postgresql', 'serverSideCursors');
sql.supports('sqlite', 'queryCancellation');
```

Unsupported semantics are reported explicitly. NuBloxSQL must not silently emulate features where doing so would change correctness, isolation, fidelity or operational behaviour.

## Evolution rule

Every new dialect has two obligations:

1. implement its native runtime correctly;
2. pressure-test the NuBloxSQL public and shared contracts.

If a new dialect exposes a weak abstraction, the abstraction should be revised rather than forcing the dialect into an existing MySQL- or PostgreSQL-shaped model.

## Target dialect family

```text
NuBloxSQL
├── MySQL
├── PostgreSQL
├── SQLite
├── SQL Server
├── Oracle
└── future SQL dialects
```

The target state is not several unrelated drivers. It is one SQL integration platform with first-class native implementations underneath one developer entry point.
