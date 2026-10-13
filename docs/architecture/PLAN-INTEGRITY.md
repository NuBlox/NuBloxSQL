# Lifecycle Plan and Migration Checkpoint Integrity

**Audit remediation — 13 October 2026.** This document records implemented
execution-boundary safeguards prompted by the repository security audit.

## Immutable plan execution boundary

Configuration, database bootstrap, engine installation and engine
initialization planners already issue SHA-256 plan hashes. Their validators
now re-hash the **entire plan payload** excluding the `planHash` property
and reject a mismatch **before** preflight or execution. The validation
result is a deep-frozen JSON snapshot so an embedding application's mutable
input or callback cannot replace approved SQL, target data or step requirements
after verification. All corresponding executors use the validated snapshot.

The hash preserves the original plan's JSON serialization and field order,
so existing valid plans do not require re-planning merely because validation
has been tightened. Changed or extra fields, removed fields and a mismatched
hash fail closed. Serialized valid plans remain supported. This covers
previously unvalidated fields such as step SQL, actions, requirements,
target IDs, target-inspection fingerprints, source discoveries, summary and
provider metadata.

**Security boundary:** a plain SHA-256 hash is NOT a digital signature,
authorization proof, authenticated principal or target-side fencing token.
An attacker who can replace both the plan and the approved hash can still
reconstruct an internally consistent pair. Trusted caller authorization,
independent target verification, target-side reconciliation and durable
approval records remain separate gates; this increment does not claim to
qualify unattended mutations.

## Migration resume and transaction checkpoints

Migration checkpoint serialization has been advanced from **v1 to v2**,
adding a SHA-256 `planHash` covering the **complete migration plan**, not
merely the source/target semantic hashes. All execution paths, including
`executeMigration(client, plan, { resumeFrom: checkpoint })`, validate
the checkpoint before any step can be skipped. The validator checks schema
version, full plan hash, source/target identity hashes, dialect, bounded known
step IDs, duplicate IDs and a valid failed-step reference.

Legacy v1 checkpoints no longer qualify for automatic resume: because they
never bound the complete plan, they cannot justify skipping SQL steps.
Operators must inspect the actual database state and create a newly
verified plan rather than relabelling a v1 checkpoint.

For `transactionMode: 'single'` the executor buffers the tentative
step-success events and completion checkpoint while the transaction is
uncommitted. It only delivers the final checkpoint and success events after
successful commit. On a rolled-back transaction it publishes no successful
step checkpoints, and returns a checkpoint without completed steps.
A post-commit checkpoint-sink error is reported explicitly as
**committed but publication failed**; callers must inspect database state
and must not assume a rollback occurred.

### Limitations and next controls

- Plan and checkpoint hashes are unkeyed **integrity bindings**, not proof
  that a checkpoint was issued by a trusted checkpoint store. Malicious
  callers able to mint arbitrary checkpoint values can still forge hashes.
  Production resume authorization should bind to a trusted issuer or durable
  state, and operators should verify actual completed work before resuming
  mutations.
- Migration checkpoint `planHash` binds the entire supplied plan, including
  its source/target snapshot metadata. Independent verification of the
  actual connected database identity requires a trusted target attestation
  before resuming; this is not yet delivered.
- Nontransactional migrations still have unavoidable execute/checkpoint
  interruption windows. The downstream app must persist checkpoints
  durably and reconcile ambiguous results before retrying.
- This change does **not** resolve the separate data-movement offset
  idempotency problem, engine-native TLS defaults or main-branch protection.
  These remain priority hardening work.

Contract tests cover tampered SQL and target fields in all four plan
families, serialized plan acceptance, direct checkpoint bypass attempts,
malformed/duplicate/foreign checkpoint steps, mismatched migration SQL,
and commit-versus-rollback callback ordering.

See the [product roadmap](../product/ROADMAP.md) and
[database job architecture](DATABASE-JOBS.md) for the wider approval,
target fencing, recovery and governance programme.
