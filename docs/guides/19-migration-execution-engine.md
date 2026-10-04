# Migration execution engine

NuBloxSQL can execute a migration plan through the same unified client used for ordinary database operations.

```js
const result = await db.executeMigration(plan, {
  approval: 'risky'
});
```

## Safety first

The executor does not reinterpret planner safety. It enforces additional execution controls around the existing plan.

Default risky approval requires explicit approval for every step whose safety is not `safe`, including dependency-sensitive, manual-review, potentially-lossy and destructive changes.

```js
const result = await db.executeMigration(plan, {
  approve: async ({ step }) => {
    return step.safety !== 'destructive';
  }
});
```

## Dry run

`dryRun: true` traverses the complete plan without executing SQL, invoking approvals or invoking manual handlers.

```js
const preview = await db.executeMigration(plan, { dryRun: true });
```

Audit records are emitted with `planned` status.

## Manual steps

If a plan contains manual steps and no `manualHandler` is supplied, non-dry-run execution is blocked before any step runs. This prevents partial execution before an unresolved manual operation.

```js
await db.executeMigration(plan, {
  manualHandler: async ({ step }) => {
    // perform or coordinate the required manual/backfill operation
  }
});
```

## Checkpoints and resumability

A checkpoint records:

- target dialect;
- source and target semantic hashes;
- completed step IDs;
- failed step ID.

`onCheckpoint` is called after each successful step.

```js
const first = await db.executeMigration(plan, {
  onCheckpoint: async checkpoint => saveCheckpoint(checkpoint)
});

const resumed = await db.resumeMigration(plan, savedCheckpoint);
```

Resume rejects checkpoints whose plan version, target dialect, semantic hashes or step IDs do not match the supplied plan.

## Failure policy

The default `failurePolicy: 'stop'` stops on the first failure and preserves a resumable checkpoint.

`failurePolicy: 'compensate'` additionally runs available compensating rollback SQL in reverse order for successfully completed steps.

Compensation is best effort. It does not claim to restore data lost by destructive operations.

## Transactions

`transactionMode: 'single'` is opt-in and accepted only when the planner marks the target as `transactional-preferred`.

If a step fails or becomes blocked, the surrounding NuBloxSQL transaction is rolled back and the returned checkpoint contains no completed steps.

MySQL plans are intentionally not eligible for single-transaction mode because the planner marks them `autocommit-boundary`.

## Operation controls

`operation` is passed directly to `client.execute()` for every automatic step. This reuses NuBloxSQL portable timeout/deadline/cancellation controls rather than creating a migration-only execution stack.

```js
await db.executeMigration(plan, {
  operation: { timeout: 30000, signal },
  beforeStep: async ({ step }) => {
    // optional lock/session policy hook
  }
  afterStep: async ({ step, result }) => {
    // optional observability/policy hook
  }
});
```

## Audit events

`onEvent` receives lifecycle events such as:

- `migration-start`
- `step-start`
- `step-planned`
- `step-skipped`
- `step-succeeded`
- `step-blocked`
- `step-failed`
- `verification-failed`
- `migration-complete`

The returned result also contains immutable per-step audit records.

## Post-migration verification

Custom verification can be supplied with `verify`.

NuBloxSQL also supports built-in canonical schema verification:

```js
const result = await db.executeMigration(plan, {
  expectedSnapshot,
  snapshotOptions: { schema: 'public', deep: true }
});
```

After execution NuBloxSQL captures a live schema snapshot and verifies that its semantic hash equals the expected target snapshot.

## Current boundary

The execution engine does not persist checkpoints itself, schedule migrations, coordinate distributed locks, or provide a generic job queue. Those concerns belong to future automation/job infrastructure. The engine exposes hooks and immutable records so those layers can be built without changing migration semantics.
