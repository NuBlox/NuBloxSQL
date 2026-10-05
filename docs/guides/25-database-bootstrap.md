# Database bootstrap foundation

NuBloxSQL database bootstrap is the first released slice of the **Establish** lifecycle phase.

It is deliberately narrower than infrastructure provisioning. NuBloxSQL assumes a reachable database server/service or SQLite database connection already exists. It plans and executes database-native bootstrap work from that boundary.

## Current scope

The first bootstrap contract supports:

- database/catalog creation intent;
- schema/namespace creation intent;
- dialect-aware SQL rendering for PostgreSQL, MySQL and SQL Server;
- explicit SQLite non-equivalence instead of inventing schemas;
- server-scoped versus database-scoped steps;
- precondition checks;
- dry-run planning;
- plan hashing;
- post-step verification;
- audit records;
- manual-step boundaries;
- PostgreSQL/SQL Server reconnect boundaries after database creation;
- client-level convenience methods;
- server/instance identity discovery;
- database/catalog enumeration;
- bootstrap prerequisite assessment;
- dialect-aware database creation options with fail-closed validation.

This release does **not** yet implement:

- operating-system or cloud provisioning;
- server installation;
- users/logins/roles;
- privileges;
- extensions;
- server/database configuration;
- backup configuration;
- maintenance configuration.

Those remain separate administration capabilities in the product roadmap.

## Discover the server first

```js
const discovery = await sql.discoverDatabaseServer(serverClient);
```

The discovery report gives a normalized server identity plus the visible database/catalog inventory while retaining the engine-native rows under `native`.

Normalized identity includes:

```text
product
version
edition
serverName
currentDatabase
currentUser
```

The inventory deliberately preserves engine differences. PostgreSQL template databases, MySQL schemas/databases, SQLite attached databases and SQL Server database state remain visible instead of being flattened into false equivalence.

A connected client can use the convenience form:

```js
const discovery = await client.discoverServer();
```

## Assess prerequisites

```js
const prerequisites = await sql.assessDatabaseBootstrapPrerequisites(
  serverClient,
  plan
);
```

The report combines discovery evidence with bootstrap-plan requirements. Its overall status is `ready`, `attention` or `blocked`.

`attention` is intentionally not failure. It is used for boundaries that need explicit operator handling, such as administrative privileges that cannot be proven portably in advance, manual steps, or a required reconnect/open-database callback.

A client can use:

```js
const prerequisites = await client.assessBootstrapPrerequisites(plan);
```

## Plan before execution

```js
const plan = sql.planDatabaseBootstrap({
  database: 'app',
  schemas: ['app', 'analytics']
}, {
  targetDialect: 'postgresql'
});
```

The plan is immutable and contains a SHA-256 `planHash`, scope information and explicit requirements.

Example step shape:

```text
id
phase
kind
action
scope
execution
sql
precondition
verification
requirements
notes
```

Execution modes are:

- `automatic` — NuBloxSQL can execute the step safely within the defined boundary;
- `manual` — the engine concept cannot be represented safely without caller input;
- `satisfied` — the requested intent is already fulfilled by the engine/runtime model.

## Database creation options

Database options are expressed as intent on the database specification. NuBloxSQL only accepts options it can render honestly for the selected engine.

PostgreSQL:

```js
const plan = sql.planDatabaseBootstrap({
  database: {
    name: 'app',
    options: {
      owner: 'app_owner',
      template: 'template0',
      encoding: 'UTF8',
      collation: 'en_GB.UTF-8',
      ctype: 'en_GB.UTF-8',
      tablespace: 'app_space'
    }
  }
}, { targetDialect: 'postgresql' });
```

MySQL:

```js
const plan = sql.planDatabaseBootstrap({
  database: {
    name: 'app',
    options: {
      characterSet: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci'
    }
  }
}, { targetDialect: 'mysql' });
```

SQL Server currently exposes database collation:

```js
const plan = sql.planDatabaseBootstrap({
  database: {
    name: 'app',
    options: {
      collation: 'Latin1_General_100_CI_AS_SC_UTF8'
    }
  }
}, { targetDialect: 'sqlserver' });
```

SQLite has no `CREATE DATABASE` statement, so creation options are rejected rather than translated into unrelated PRAGMAs or file-system behaviour.

Unsupported option/dialect combinations fail during planning. NuBloxSQL does not silently ignore them.

## Inspect first

```js
const inspection = await sql.inspectDatabaseBootstrap(serverClient, plan);
```

Inspection evaluates preconditions without performing changes.

Statuses include:

```text
needed
exists
satisfied
manual
deferred
```

A database-scoped check may be `deferred` when the plan first creates the target database and no target-database client exists yet.

## Dry run

```js
const result = await sql.executeDatabaseBootstrap(serverClient, plan, {
  dryRun: true
});
```

Dry-run mode produces audit records but does not execute SQL.

## PostgreSQL two-scope bootstrap

PostgreSQL `CREATE DATABASE` is server scoped and must run outside a transaction. Schema creation is then database scoped.

```js
const plan = sql.planDatabaseBootstrap({
  database: 'app',
  schemas: ['app']
}, {
  targetDialect: 'postgresql'
});

const result = await sql.executeDatabaseBootstrap(serverClient, plan, {
  openDatabaseClient: async ({ targetDatabase }) => {
    return sql.createClient({
      dialect: 'postgresql',
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: targetDatabase
    });
  }
});
```

NuBloxSQL does not silently reconnect with guessed credentials. If database-scoped work is required after database creation, the caller must provide `databaseClient` or `openDatabaseClient`.

## MySQL database/schema semantics

MySQL treats `CREATE SCHEMA` as a synonym for `CREATE DATABASE`.

Therefore:

```js
sql.planDatabaseBootstrap({
  database: 'app',
  schemas: ['app', 'analytics']
}, {
  targetDialect: 'mysql'
});
```

records the `app` schema request as already satisfied by database creation and treats `analytics` as another server-level database namespace.

NuBloxSQL does not pretend MySQL has PostgreSQL-style nested schemas.

## SQL Server batch boundary

SQL Server database creation is represented as:

```sql
CREATE DATABASE [app]
```

The plan records that this operation:

- is server scoped;
- requires an autocommit boundary;
- must be the only statement in its batch;
- requires an explicit target-database connection before later schema work.

## SQLite boundary

SQLite database creation is fundamentally a file/open-connection lifecycle operation, not `CREATE DATABASE`.

NuBloxSQL therefore marks the connected database as `satisfied`.

SQLite also does not expose independent schemas equivalent to PostgreSQL or SQL Server. `ATTACH` creates another connection-scoped database namespace and requires an explicit filename. A schema request is therefore represented as a manual boundary instead of being falsely translated.

## Client API

A connected NuBloxSQL client can use:

```js
const plan = client.planBootstrap({
  database: 'app'
});

const inspection = await client.inspectBootstrap(plan);

const result = await client.executeBootstrap(plan, {
  dryRun: true
});
```

The root API also exposes:

```text
discoverDatabaseServer()
assessDatabaseBootstrapPrerequisites()
planDatabaseBootstrap()
bootstrapAutomaticSteps()
bootstrapManualSteps()
inspectDatabaseBootstrap()
executeDatabaseBootstrap()
```

## Safety model

Bootstrap is intentionally conservative:

1. identifiers are quoted per dialect;
2. existence checks are separate from creation SQL;
3. PostgreSQL/SQL Server transaction restrictions are explicit plan metadata;
4. reconnect boundaries are explicit;
5. SQLite non-equivalence becomes a manual boundary;
6. dry-run is first-class;
7. every execution produces an audit trail;
8. callback context envelopes are immutable, but live client/runtime resources are never frozen or mutated by NuBloxSQL;
9. the plan is hashed so callers can identify exactly what was approved.

## Next bootstrap slices

The bootstrap capability remains **Partial**, not Established.

The next work should add, in order:

1. configuration discovery and change planning;
2. security administration for users/logins/roles/privileges;
3. extension/feature enablement;
4. live qualification of database creation/bootstrap across the supported engines.

The infrastructure boundary remains fixed: NuBloxSQL manages database lifecycle concerns, not generic cloud or VM provisioning.
