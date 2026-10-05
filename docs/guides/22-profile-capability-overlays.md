# Dialect profile capability overlays

The canonical dialect registry answers **what a DBMS/product/profile is**. The profile capability overlay engine answers **how that profile differs from a capability baseline**.

The two layers deliberately remain separate.

```text
Canonical dialect capability model
        |
        v
Profile baseline selection
        |
        +-- verified additions
        +-- verified overrides
        +-- verified removals
        +-- version constraints
        +-- edition constraints
        +-- deployment constraints
        +-- protocol/deployment evidence
        |
        v
Resolved profile capability
```

## Fail-closed inheritance

A compatibility relationship is not capability evidence.

For example:

```js
const inherited = sql.profileCapabilities.status(
  'aurora-postgresql',
  'statements.select'
);

console.log(inherited.baseDialect); // postgresql
console.log(inherited.baseline.support); // native
console.log(inherited.resolution); // inherited-unverified
console.log(inherited.available); // null
```

NuBloxSQL knows which baseline is relevant, but it does **not** claim that the product supports the baseline capability until product/profile evidence qualifies it.

The exact base products remain qualified through their existing Tier-1 models:

```js
sql.profileCapabilities.status('postgresql', 'statements.select');
// resolution: base-qualified
// available: true
```

Profiles whose ancestry reaches a current Tier-1 model can use it as an evidence baseline. This includes first-class future dialect targets such as MariaDB, CockroachDB and YugabyteDB without pretending that their differences have already been modelled.

Profiles with no current capability baseline, including SQL Server until it is promoted into the common Tier-1 ontology, resolve as `baseline-unavailable`.

## Overlay operations

An overlay can declare three operations:

- `add` — a profile capability absent from the baseline;
- `override` — a different support/semantic classification for an existing baseline capability;
- `remove` — a baseline capability explicitly unavailable in the profile.

```js
const overlay = sql.profileCapabilities.compile('aurora-postgresql', {
  evidence: ['product-specific qualification evidence'],
  changes: [
    {
      path: 'extensions.exampleCapability',
      operation: 'add',
      support: 'native',
      evidence: 'qualified',
      references: ['internal/live qualification reference']
    },
    {
      path: 'queries.cte.search',
      operation: 'remove',
      evidence: 'documented',
      references: ['vendor documentation reference']
    }
  ]
});
```

`compile()` is pure. It does not mutate NuBloxSQL's official evidence register. It validates the change set and returns an immutable overlay that can be supplied to `status()`, `supports()`, `diff()` or `report()`.

Verified official profile overlays belong in `lib/capabilities/ProfileCapabilityOverlayData.js` and should only be added with product-specific evidence.

## Conditional differences

Changes can be scoped by:

- `since`;
- `until`;
- `editions`;
- `deployments`.

```js
const overlay = sql.profileCapabilities.compile('aurora-postgresql', {
  changes: [{
    path: 'statements.merge',
    operation: 'override',
    support: 'partial',
    evidence: 'qualified',
    since: '16',
    deployments: ['serverless']
  }]
});

const result = sql.profileCapabilities.status(
  'aurora-postgresql',
  'statements.merge',
  {
    overlay,
    context: {
      version: '16',
      deployment: 'serverless'
    }
  }
);
```

Conditional changes fail closed: if a change requires a version, edition or deployment and the caller does not provide that context, the change does not apply.

## Evidence levels

Overlay differences have one of three evidence classifications:

- `qualified` — runtime/contract evidence has qualified the profile difference;
- `documented` — product documentation supports the difference;
- `declared` — metadata has been declared but is not yet independently qualified.

These map to distinct resolution states instead of collapsing all overlay information into a boolean.

## Baseline selection

NuBloxSQL chooses a capability baseline without changing product identity.

Examples:

```text
aurora-postgresql -> PostgreSQL baseline
cockroachdb       -> PostgreSQL baseline
yugabytedb        -> PostgreSQL baseline

mariadb           -> MySQL baseline
tidb              -> MySQL baseline
aurora-mysql      -> MySQL baseline
```

The canonical product/dialect registry remains authoritative for identity. The overlay engine only discovers the nearest ancestor for which NuBloxSQL has an actual capability model.

## API

```js
sql.PROFILE_CAPABILITY_OVERLAY_SCHEMA_VERSION
sql.PROFILE_CAPABILITY_CHANGE_TYPES
sql.PROFILE_CAPABILITY_RESOLUTIONS

sql.profileCapabilities.definition(profileId)
sql.profileCapabilities.overlay(profileId)
sql.profileCapabilities.compile(profileId, specification)
sql.profileCapabilities.status(profileId, capabilityPath, options)
sql.profileCapabilities.supports(profileId, capabilityPath, options)
sql.profileCapabilities.diff(profileId, options)
sql.profileCapabilities.report(profileId, options)
sql.profileCapabilities.validate()
```

The same API is available as `sql.capabilityModel.profileCapabilities`.

## Architectural boundary

This layer does not:

- make a registry profile routable;
- alias one DBMS product to another;
- claim wire-protocol compatibility is complete driver compatibility;
- automatically certify inherited capabilities;
- create 100 independent parsers.

It is the controlled evidence layer between canonical dialect inheritance and future product-specific runtime/compiler qualification.
