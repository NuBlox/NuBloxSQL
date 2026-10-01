# NuBloxSQL Multi-Dialect Architecture

## Architectural decision

NuBloxSQL presents **one public developer entry point** over multiple SQL dialect runtimes.

The developer-facing dependency is `nubloxsql`. Internally, shared contracts and native dialect runtimes live in one consolidated runtime tree; they are implementation modules, not separate packages that application developers install or manage.

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

## Runtime layout

```text
lib/
├── core/
└── dialects/
    ├── mysql/
    ├── postgresql/
    └── sqlite/
```

`lib/core` contains only portable contracts proven across dialects. `lib/dialects/*` contains database-native runtime behavior. There are no nested npm package boundaries inside this runtime tree.

## Public facade responsibility

The root facade owns the common developer entry points:

- `createConnection(...)`;
- `createPool(...)` where supported;
- `adapter(...)` for explicit native access;
- `descriptor(...)` and `supports(...)` for capability discovery;
- shared SQL contract access;
- dialect namespaces from the same installation.

Dialect runtimes are lazy-loaded. Importing `nubloxsql` does not initialize every supported database runtime; a dialect is loaded when it is selected or explicitly accessed.

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

The published NuBloxSQL package contains the supported runtimes required by the public facade.

Developers install only:

```text
nubloxsql
```

They do not install separate MySQL, PostgreSQL, SQLite or SQL Core NuBlox packages to use those capabilities.

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
