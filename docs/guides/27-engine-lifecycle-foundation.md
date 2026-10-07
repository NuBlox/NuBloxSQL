# Engine lifecycle foundation

NuBloxSQL now exposes the first public contracts for the lifecycle that exists **before a database connection is available**.

This release covers:

- engine/runtime selection;
- engine lifecycle profiles;
- installation-provider validation;
- target-environment inspection through a provider;
- immutable engine installation plans;
- immutable engine initialization plans.

It does **not** yet execute installation or initialization actions.

## Terminology

A **dialect** is NuBloxSQL's semantic/runtime model for a database family.

An **engine/runtime** is the software that is installed or embedded:

- PostgreSQL;
- MySQL Server;
- SQL Server Database Engine;
- SQLite runtime/library.

An **installation provider** is the explicit boundary between NuBloxSQL lifecycle intent and host/infrastructure mutation.

## Select an engine

```js
const selection = sql.selectDatabaseEngine({
  engine: 'postgresql',
  targetVersion: '18',
  distribution: 'community',
  installationStrategy: 'package',
  components: ['server']
});
```

Selections are immutable and carry a SHA-256 `selectionHash`.

NuBloxSQL does not hard-code a current package repository or host command into this object. It records the database intent that later provider-specific planning/execution must satisfy.

Supported initial strategies are intentionally broad:

| Engine | Strategies |
| --- | --- |
| PostgreSQL | package, binary, source, container, manual |
| MySQL | package, binary, source, container, manual |
| SQL Server | setup, package, container, manual |
| SQLite | embedded, cli, package, source, manual |

These describe installation approaches, not claims that every strategy is available on every operating system.

## Installation providers

A provider must expose target inspection:

```js
const provider = {
  id: 'local-host',
  kind: 'local',

  actions: [
    'inspect-target',
    'install',
    'verify-install',
    'initialize',
    'verify-initialize'
  ],

  async inspectTarget(request) {
    return {
      targetId: 'development-machine',
      platform: {
        os: 'linux',
        family: 'debian',
        version: '13',
        architecture: 'arm64'
      },

      installed: [],
      resources: [],
      facts: {}
    };
  }
};
```

The provider may represent local execution, remote execution, SQL Server Setup integration, a package-manager adapter, a container runtime, or a manual/external workflow.

NuBloxSQL core does not obtain an arbitrary shell merely because a provider exists.

## Inspect a target

```js
const target = await sql.inspectEngineTarget(provider);
```

The returned report is immutable, carries an SHA-256 `inspectionHash`, and normalizes:

- provider identity and declared actions;
- target identity;
- operating-system/platform evidence;
- elevation evidence;
- installed engine/runtime evidence;
- initialized resource evidence;
- provider-native facts.

Installed engine entries contain normalized engine/version/component evidence.

Initialized resources use engine-specific keys such as:

```text
cluster:/var/lib/postgresql/18/main
data-directory:/var/lib/mysql
instance:MSSQLSERVER
database-file:app.db
```

## Plan installation

```js
const plan = sql.planEngineInstallation(selection, target);
```

Plan steps are classified as:

- `provider` — the provider declares the required lifecycle action;
- `external` — NuBloxSQL can model the required action but this provider cannot execute it;
- `manual` — explicitly manual strategy;
- `satisfied` — provider evidence proves the requested state already exists;
- `blocked` — proceeding as an install would violate the lifecycle boundary.

A key safety rule is that an already-installed **different version** is not treated as another fresh install:

```text
installed PostgreSQL 17
requested PostgreSQL 18
        ↓
upgrade-required / blocked
```

The caller must use a future engine-upgrade plan or explicitly request a side-by-side installation plan.

No installation command is executed in this release.

## Plan initialization

Initialization is separate from installation because the engines have materially different first-run semantics.

### PostgreSQL

```js
const plan = sql.planEngineInitialization(
  selection,
  target,
  {
    dataDirectory: '/var/lib/postgresql/18/main'
  }
);
```

The resource model is a PostgreSQL **cluster**.

### MySQL

```js
const plan = sql.planEngineInitialization(
  selection,
  target,
  {
    dataDirectory: '/var/lib/mysql'
  }
);
```

The resource model is a MySQL **data directory**.

`secureBootstrap` defaults to the secure lifecycle expectation. An explicit `secureBootstrap: false` is retained in the plan as insecure intent; NuBloxSQL does not silently reinterpret it as safe.

### SQL Server

```js
const plan = sql.planEngineInitialization(
  selection,
  target,
  {
    instanceName: 'MSSQLSERVER'
  }
);
```

The resource model is an SQL Server **instance**. Actual Setup/instance behavior remains provider-specific.

### SQLite

```js
const plan = sql.planEngineInitialization(
  selection,
  target,
  {
    filename: 'app.db'
  }
);
```

The resource model is the SQLite **database file**, not a fictional server instance.

## Safety rules

The current foundation enforces these boundaries:

1. installation and initialization are planning-only;
2. a provider must explicitly declare lifecycle actions;
3. missing provider capability becomes `external`, not invented shell execution;
4. an existing different engine version becomes an upgrade boundary;
5. initialization is blocked until the selected engine version is reported installed;
6. already initialized resources become `satisfied`;
7. host mutation, elevation, license acceptance, possible reboot and service lifecycle requirements remain explicit plan metadata;
8. selections, target inspections and plans are immutable and SHA-256 hashed;
9. installation/initialization plans are bound to the exact `targetInspectionHash`, providing the future executor with a drift-detection anchor.

## Why execution is not included yet

Host mutation is qualitatively different from executing SQL against an already-running database.

Before NuBloxSQL executes provider actions, the next slice must define:

- exact plan-hash approval;
- pre-execution target reinspection and drift detection;
- provider action request/response schemas;
- privilege/elevation handling;
- license acceptance evidence;
- command/media provenance;
- reboot/restart boundaries;
- secure secret passing;
- cancellation;
- audit;
- post-install verification;
- failure recovery and idempotency.

This follows the same pattern already used successfully for migrations and configuration changes: **intent → immutable plan → controlled execution → verification → audit**.
