# Controlled engine lifecycle execution

NuBloxSQL can now execute approved engine installation and initialization plans through explicit installation providers.

The executor preserves the same safety pattern used elsewhere in NuBloxSQL:

```text
intent
  -> target inspection
     -> immutable plan
        -> exact plan-hash approval
           -> target reinspection / drift check
              -> constrained provider action
                 -> target reinspection / verification
                    -> audit result
```

The executor does not expose arbitrary shell access.

## Provider action boundary

A provider may implement:

```js
async executeAction(request) {
  // request.action is constrained to a NuBlox lifecycle action
}
```

For v0.2 the executable mutation actions are:

- `install`;
- `initialize`.

The request contains lifecycle intent and approved plan evidence, not an arbitrary command string.

## Approval

Execution requires the exact immutable plan hash by default:

```js
const result = await sql.executeEngineInstallation(provider, plan, {
  approvedPlanHash: plan.planHash
});
```

`approvalMode: 'none'` is an explicit opt-out.

Dry-run does not require approval and never executes a provider mutation.

## Drift detection

Before mutation, NuBloxSQL reinspects the target through `inspectTarget()`.

If the current `inspectionHash` differs from the hash captured by the plan, execution returns:

```text
drifted
```

and performs no mutation.

This deliberately makes the provider target report part of the execution contract. Providers should return stable target facts and avoid transient timestamps/counters in hash-relevant evidence.

## Verification

A provider action result cannot self-certify success.

After a successful install or initialization action, NuBloxSQL reinspects the target and independently verifies normalized state:

- installation requires the requested engine/version to be reported `ready` and required components to be present;
- initialization requires the expected engine-specific resource key to be reported `ready`, and the selected runtime must still be ready.

Verification failures return `failed`.

## Restart and reboot boundaries

Provider actions may return:

- `pending-restart`;
- `pending-reboot`;
- `pending-verification`.

NuBloxSQL stops execution at that boundary.

The caller should complete the required external action, reinspect the target, and create a fresh plan. The old plan is intentionally not resumed across a target-state change.

An engine/runtime or initialized resource reported in a non-ready state becomes a blocked `installation-incomplete` or `initialization-incomplete` plan rather than being treated as satisfied.

## SQL Server license acceptance

SQL Server installation plans carry `licenseAcceptance: true` as a requirement.

Execution requires explicit acceptance evidence:

```js
const result = await sql.executeEngineInstallation(provider, plan, {
  approvedPlanHash: plan.planHash,
  licenseAcceptance: {
    accepted: true,
    reference: 'approved-install-request-123'
  }
});
```

NuBloxSQL records only the acceptance flag/reference; it does not embed license text in the plan.

## Runtime secrets

Secrets must not be stored in lifecycle plans.

Initialization planning rejects secret-like option names such as passwords, tokens, credentials and private/encryption keys.

Runtime-only values are supplied through `resolveInputs`:

```js
const result = await sql.executeEngineInitialization(provider, plan, {
  approvedPlanHash: plan.planHash,

  resolveInputs() {
    return {
      password: process.env.DB_BOOTSTRAP_PASSWORD
    };
  }
});
```

These inputs are passed only to the selected mutation handler/provider call. They are not copied into execution audit results.

Provider-returned audit evidence is rejected if it contains secret-like fields.

## External and manual steps

If a plan contains an `external` or `manual` mutation step, execution blocks unless the corresponding handler is provided:

```js
externalHandler(context)
manualHandler(context)
```

Handlers return the same constrained lifecycle action result shape as providers.

After the handler reports `succeeded`, NuBloxSQL still performs its own target reinspection verification.

## Inspection APIs

Plans can be inspected without mutation:

```js
await sql.inspectEngineInstallationPlan(provider, installPlan);
await sql.inspectEngineInitializationPlan(provider, initializePlan);
```

The result includes the planned/current inspection hashes and drift evidence.

## Result statuses

Execution can return:

- `dry-run`;
- `succeeded`;
- `failed`;
- `blocked`;
- `drifted`;
- `pending-restart`;
- `pending-reboot`;
- `pending-verification`.

A result is only `succeeded` after post-action target reinspection proves the requested state.

## What remains

The generic executor is not the same thing as qualified installation support.

The next lifecycle slice is concrete provider work:

1. local-host inspection/execution boundary;
2. package-manager integration where appropriate;
3. SQL Server Setup integration;
4. SQLite runtime acquisition/file lifecycle;
5. provider-specific prerequisites and media/source provenance;
6. live install/init qualification in disposable environments.

Until those exist, lifecycle installation/initialization coverage remains **partial**.
