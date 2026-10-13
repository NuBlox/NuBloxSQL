# Lifecycle Plan and Migration Checkpoint Integrity

**Status:** October 2026 hardening. This is a **serialized-content integrity** boundary,
not proof of who approved a plan, who supplied it, or whether its target is the
same physical database instance. Those trust and target-attestation controls
still require additional qualification before unattended mutations.

## Fixed integrity defects

Previously, the following planners emitted SHA-256 `planHash` fields but their
`validate()` methods accepted plans whose SQL, step requirements or target
details had changed without checking the original hash:

- `DatabaseConfigurationPlanner`;
- `DatabaseBootstrapPlanner`;
- `EngineInstallationPlanner`;
- `EngineInitializationPlanner`.

Each validator now builds a **single JSON snapshot**, verifies its full SHA-256
hash against the declared `planHash`, and returns the deeply immutable
validated copy. Configuration, bootstrap and engine-lifecycle executors already
invoke these validators before side effects; their helper methods now use the
validated snapshot as well. This blocks modifications **under the original
plan hash**, including edits to `step.sql`, `execution`, privilege requirements,
target and approval-bound metadata. It also prevents a caller mutating the
original plan object during asynchronous executor callbacks.

The hashing model intentionally retains the planners' existing serialization
format; it is not a new plan schema or a replacement for independent target
identity verification. A party able to change **both** a plan and its hash can
still create a different internally consistent plan: plan hashes are not
digital signatures and must not be treated as authentication or authorization.

## Migration checkpoint replay

`executeMigration(..., { resumeFrom })` previously skipped completed steps
without invoking `validateCheckpoint`, even though `resumeMigration()`
validated checkpoints. The common execution path now validates the checkpoint
before any step is skipped and before connecting to a database executor.

All newly emitted v1 checkpoints additionally include `planFingerprint`, a
SHA-256 over the **complete immutable migration plan**, including SQL steps,
rollback descriptions and schema snapshot data. Validation rejects:

- missing/incorrect fingerprints (including old checkpoints without one);
- source/target semantic-hash or dialect mismatches;
- unknown, repeated or malformed completed-step IDs;
- failed-step IDs that are unknown or already marked completed.

**Compatibility note:** previous v1 checkpoints that do not contain a
`planFingerprint` can no longer resume without rebuilding/requalifying the
migration and deriving trustworthy completion evidence. This is a deliberate
fail-closed change; do not invent a fingerprint for an unverified checkpoint.

Migration plans are snapshotted and frozen on execution. However, fingerprints
are **not** an origin signature or an anti-forgery credential; do not accept
resumption claims from untrusted clients without authenticated principal
identity, reliable live target-instance binding and trusted durable checkpoint
storage.

## Single-transaction completion reporting

For `transactionMode: 'single'`, per-step `onCheckpoint` notifications and
`onEvent` events are now **buffered** until the enclosing
`client.transaction()` resolves successfully. A failed/rolled-back
transaction emits no durable per-step completion notification and produces a
rolled-back result with no completed step IDs. Successful commits publish the
buffered checkpoints and events after commit. A database-driver commit failure
propagates without publishing successful step checkpoints.

The execution dispatcher also validates and freezes direct `resumeFrom`
input **before beginning any transaction**. An invalid checkpoint therefore
cannot trigger a `BEGIN` or enter the executor.

A failure in an external `onCheckpoint` or `onEvent` callback **after a
successful commit** now rejects with a structured
`MIGRATION_POST_COMMIT_NOTIFICATION_FAILED` error,
`migrationCommitted: true`, `migrationResult` containing the committed
migration result, and `cause` identifying the failed notification sink.
This exception is **not** reclassified as rollback. The caller must inspect
the committed result and reconcile checkpoint persistence before retrying;
blind re-execution could duplicate side effects.

This does not establish exactly-once guarantees for all non-transactional
migrations or external clients. In particular, the caller still controls the
`approve()` callback for the generic migration API, and host/database identity
binding, isolation of approval principals, replay resistance in external
checkpoint storage and physical rollback qualification remain outstanding.

## Testing

`test/plan-integrity-hardening.js` is part of `npm run test:platform`.
It checks tampered SQL, forged target metadata, changed execution requirements,
approval-hash reuse, mutated installation/initialization plans, direct-resume
checkpoint bypass, duplicate/unknown step IDs, cross-plan fingerprints,
rollback suppression of checkpoint callbacks and driver commit failures.

The existing engine-specific CI and clean-installed release consumer must pass
as well. Real databases and independent approval authorities require further
end-to-end testing.

## Next safety gates

1. Bind every approved plan to a **verified runtime target identity**, not
   just an opaque caller-supplied ID or dialect.
2. Use trusted authenticated authorization independent of the request's
   `approvedPlanHash` or `approve()` callback when integrating durable
   mutation jobs; fence and reconcile native side effects.
3. Complete durable checkpoint storage, idempotent transfer recovery, and
   pre-/post-commit fault injection using live engine workloads.
4. Enforce repository rulesets requiring independently reviewed PRs and CI
   checks on `main` (repository administrator configuration).

The [Product Blueprint](../product/BLUEPRINT.md) remains authoritative.
