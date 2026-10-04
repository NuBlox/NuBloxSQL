# Canonical schema diff

NuBloxSQL compares canonical schema snapshots using dialect-neutral logical keys and canonical schema semantics.

```js
const before = await dbA.schemaSnapshot({ deep: true });
const after = await dbB.schemaSnapshot({ deep: true });
const diff = sql.diffSchemas(before, after);
```

## Change states

Object changes are classified as:

- `added`
- `removed`
- `modified`

Objects that are present and semantically identical are counted as unchanged.

## Safety classes

Each changed object receives a conservative safety class:

- `safe` — the current model can justify the change as non-destructive.
- `dependency-sensitive` — the change affects relationships, keys, constraints or dependent objects.
- `manual-review` — NuBloxSQL cannot prove the change is safe without data/application context.
- `potentially-lossy` — canonical value semantics or range may be reduced.
- `destructive` — an object is removed.

`schemaDiffHighestSafety(diff)` returns the highest-severity class present.

## Examples

Adding a nullable column is currently classified as `safe`.

Adding a non-null column without a default, identity or generated value is `manual-review` because existing rows may not satisfy the new requirement.

Removing an object is `destructive`.

Changing a signed 32-bit integer to a signed 64-bit integer is recognized as safe widening. Reversing that change is `potentially-lossy`.

Tightening nullable to not-null is `manual-review`.

Foreign-key and constraint changes are `dependency-sensitive`.

## Property deltas

Modified objects contain explicit `deltas` with property name, before value and after value.

```js
for (const change of diff.changes) {
  console.log(change.logicalKey, change.status, change.safety);
  for (const delta of change.deltas) {
    console.log(delta.property, delta.before, delta.after);
  }
}
```

## Dependency changes

Relationship changes are also reported separately as `dependencyChanges.added` and `dependencyChanges.removed`.

## Deliberate boundaries

The released diff does not yet infer renames. A rename is represented conservatively as removal plus addition until a later identity/rename inference layer can prove correspondence.

The diff also does not generate DDL or migration execution steps. Those belong to the migration planner that consumes this safety-classified change model.
