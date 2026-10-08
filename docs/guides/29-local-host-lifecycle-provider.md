# Local host lifecycle inspection provider

NuBloxSQL now includes a read-only local-host installation provider for the lifecycle work that happens before a database endpoint exists.

The provider is intentionally inspection-only:

```text
createLocalHostInstallationProvider()
        ↓
inspectEngineTarget()
        ↓
platform + tooling + installed runtime + hinted resource evidence
```

It does not expose `executeAction()` and therefore cannot install, initialize, upgrade or uninstall software.

## Create the provider

```js
const provider = sql.createLocalHostInstallationProvider();

const target = await sql.inspectEngineTarget(provider);
```

The provider reports:

- operating-system/runtime family;
- architecture;
- OS release;
- local target identity;
- elevation evidence where Node can determine it safely;
- available package-management tools;
- available container runtimes;
- PATH-visible database runtime evidence;
- explicitly hinted initialized resources;
- normalized prerequisites.

## Read-only command probes

The default provider uses `spawnSync()` with `shell: false` and a fixed internal probe catalogue. It never accepts a caller-supplied command string for execution.

Current read-only probes include:

- PostgreSQL server version via `postgres --version`, with `pg_config --bindir` used only to locate the server executable when appropriate;
- MySQL Server version via `mysqld --version`;
- SQLite CLI/runtime evidence via `sqlite3 -version`;
- SQL Server executable version evidence via `sqlservr -v` where that executable supports the probe;
- package tool version checks such as Homebrew/MacPorts, apt/dnf/yum/zypper/apk, winget/Chocolatey/Scoop;
- Docker/Podman version checks.

A failed/missing probe is evidence of **not discovered**, not proof that software is absent from the machine.

## Version normalization

The provider normalizes versions to the lifecycle families already used by NuBloxSQL:

| Engine | Raw example | Lifecycle version |
| --- | --- | --- |
| PostgreSQL | 18.1 | 18 |
| MySQL | 8.4.11 | 8.4 |
| SQLite CLI | 3.53.0 | 3.53.0 |
| SQL Server | 17.0.4085.5 | 2025 |

The full detected build remains under `native.buildVersion`.

This keeps local inspection compatible with selections such as PostgreSQL `18`, MySQL `8.4`, and SQL Server `2025`.

## SQLite evidence

Finding the `sqlite3` command-line program proves only CLI/runtime evidence. It is reported with:

```text
components: ['cli']
distribution: 'sqlite-cli'
```

It does not claim that an application's embedded SQLite library has been discovered.

For an embedded runtime known by the application, use an explicit `installedHints` entry:

```js
const provider = sql.createLocalHostInstallationProvider({
  installedHints: [{
    engine: 'sqlite',
    version: '3.53.0',
    distribution: 'embedded',
    components: ['library']
  }]
});
```

Hints become auditable target evidence and participate in the target `inspectionHash`.

## Explicit resource hints

NuBloxSQL deliberately does **not** crawl the local filesystem looking for databases.

Initialized resources are inspected only when their location/identity is explicitly supplied:

```js
const provider = sql.createLocalHostInstallationProvider({
  resourceHints: [
    {
      engine: 'postgresql',
      kind: 'cluster',
      path: '/var/lib/postgresql/18/main'
    },
    {
      engine: 'mysql',
      kind: 'data-directory',
      path: '/var/lib/mysql'
    },
    {
      engine: 'sqlite',
      kind: 'database-file',
      path: './app.db'
    },
    {
      engine: 'sqlserver',
      kind: 'instance',
      name: 'MSSQLSERVER'
    }
  ]
});
```

Resource checks remain read-only:

- PostgreSQL verifies the hinted directory and `PG_VERSION`;
- MySQL verifies the hinted data directory and system-schema directory;
- SQLite verifies the standard database-file header;
- SQL Server checks the explicitly identified service/instance state using platform service inspection.

A hinted resource that exists but is incomplete is returned as `incomplete`, not `ready`.

## Prerequisite evidence

Stable target facts include:

```js
target.facts.prerequisites
```

with evidence such as:

- whether the platform family is recognized;
- architecture;
- whether a package manager was discovered;
- whether Docker/Podman was discovered;
- whether elevation state is known;
- the fact that this provider supports no mutation actions.

Volatile metrics such as free memory or free disk are deliberately excluded from the hash-relevant inspection report. Those belong in a future prerequisite/capacity assessment where volatility can be modeled explicitly rather than causing every lifecycle plan to drift.

## Security boundaries

The local-host provider enforces these rules:

1. no `executeAction()`;
2. no arbitrary shell strings;
3. fixed read-only executable probes;
4. `shell: false` for default subprocess calls;
5. bounded probe output;
6. explicit resource hints rather than filesystem crawling;
7. sanitized SQL Server service identifiers;
8. secret-like fields are rejected from installed/resource hints;
9. deterministic target evidence feeds the existing SHA-256 `inspectionHash`.

## Installation prerequisite assessment

Use the inspected target and immutable engine selection to produce a first-class prerequisite assessment:

```js
const selection = sql.selectDatabaseEngine({
  engine: 'postgresql',
  targetVersion: '18',
  installationStrategy: 'package'
});

const target = await sql.inspectEngineTarget(provider);

const prerequisites = sql.assessEngineInstallationPrerequisites(
  selection,
  target
);
```

The immutable assessment carries an `assessmentHash` and one of:

- `ready`;
- `attention`;
- `blocked`.

Current checks cover:

- platform/architecture evidence;
- existing exact, incomplete or conflicting engine versions;
- package-manager availability for package strategy;
- Docker/Podman availability for container strategy;
- SQL Server Setup requiring Windows;
- source/manual strategy attention boundaries;
- likely elevation boundary for server package/setup installs;
- whether the inspected provider can perform installation;
- SQL Server license-acceptance attention;
- explicit vendor-support certification boundary.

The last check is intentionally `attention`: local host inspection does not certify a live vendor support matrix. A future support-catalogue capability can replace that uncertainty with versioned vendor evidence.

## Planning integration

The returned target is a normal NuBloxSQL installation-provider report:

```js
const target = await sql.inspectEngineTarget(provider);

const selection = sql.selectDatabaseEngine({
  engine: 'postgresql',
  targetVersion: '18'
});

const plan = sql.planEngineInstallation(selection, target);
```

If PostgreSQL 18 is already proven installed, the plan can be satisfied.

If PostgreSQL 17 is discovered while 18 is requested, the existing upgrade boundary remains in force.

If PostgreSQL is not discovered, installation remains `external` because the read-only local provider has no mutation action.

## Test/embedding hooks

For deterministic qualification and advanced embedding, the provider accepts injectable:

- `system` facts;
- `commandRunner`;
- `filesystem`.

These do not widen NuBloxSQL's command surface: the provider still chooses every executable and argument set itself.

## What remains

The next provider slice should build on this inspection evidence rather than replacing it:

1. platform-specific prerequisite assessment;
2. installation media/source provenance;
3. explicit package-manager/provider mutation contracts;
4. macOS package provider;
5. Linux package provider;
6. Windows/SQL Server Setup provider;
7. live disposable-host installation/initialization qualification.

The read-only local provider should remain useful even after mutation providers exist because planning and drift verification need an independent evidence layer.
