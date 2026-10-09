# Database Job Architecture

This document defines the canonical job model for NuBloxSQL across the complete database lifecycle.

It exists to prevent each lifecycle capability from inventing its own scheduling, retry, checkpoint, approval, logging and execution semantics.

NuBloxSQL should expose one durable job architecture that can orchestrate database work from engine selection and installation through operation, change, upgrade and retirement while preserving native database job systems where they exist.

## Scope

The job architecture applies to work that is:

- durable;
- scheduled;
- asynchronous from the caller's point of view;
- multi-step;
- approval-gated;
- checkpointed;
- retryable;
- resumable;
- long-running;
- resource-locking;
- dependent on other work;
- capable of outliving a client connection or process;
- required to produce durable audit/evidence.

The architecture spans the canonical lifecycle:

```text
Select
  -> Install
     -> Initialize
        -> Discover
           -> Establish
              -> Build
                 -> Use
                    -> Understand
                       -> Operate
                          -> Change
                             -> Retire
```

Not every SQL request is a job. NuBloxSQL must keep immediate database operations separate from durable orchestration.

## Core distinction

NuBloxSQL should model three execution levels.

### Operation

An **operation** is a bounded invocation expected to execute inside the current request/session/process boundary.

Examples:

- run a query;
- prepare a statement;
- inspect metadata;
- request a query plan;
- fetch a configuration report;
- create a schema when execution is immediate and bounded;
- cancel a running statement.

An operation may produce observability events, but it does not require durable job identity.

### Job

A **job** is a durable unit of database work with identity, lifecycle state, execution policy and auditable outcomes.

Examples:

- install PostgreSQL 18;
- initialize a cluster;
- back up a database;
- restore a database;
- rebuild indexes;
- run a migration;
- move 800 GB of data;
- perform a scheduled integrity check;
- assess upgrade readiness;
- execute an engine upgrade;
- retire a database.

A job may contain steps, checkpoints and provider/native actions.

### Workflow

A **workflow** coordinates multiple jobs and gates as a dependency graph.

Examples:

```text
Upgrade workflow
  prerequisite inspection
      ↓
  compatibility assessment
      ↓
  backup job
      ↓
  backup verification
      ↓
  approval gate
      ↓
  engine upgrade job
      ↓
  configuration reconciliation
      ↓
  schema/database post-upgrade job
      ↓
  validation
      ↓
  closeout
```

A workflow is not merely a large job. It owns dependencies and orchestration between independently durable jobs.

## Two job planes

NuBloxSQL must distinguish two fundamentally different job planes.

### Plane A — NuBlox orchestration jobs

These are owned by NuBloxSQL.

They provide the portable execution model for:

- job identity;
- immutable plans;
- workflow dependencies;
- approvals;
- schedules;
- leases;
- locks;
- checkpoints;
- retry;
- resumability;
- cancellation;
- audit;
- artifacts;
- verification;
- events.

A NuBlox job can execute work directly through NuBloxSQL, through a lifecycle provider, or through a native database job adapter.

### Plane B — Engine-native jobs and schedulers

Some engines expose their own persistent scheduling/execution mechanisms.

These must remain native objects rather than being flattened into a fake universal scheduler.

Examples include:

- SQL Server Agent jobs, steps and schedules;
- MySQL scheduled events;
- PostgreSQL scheduler extensions or external scheduler integrations where explicitly supported;
- application/host schedulers around SQLite, because SQLite is embedded and has no server process that NuBloxSQL should pretend is a common job agent.

NuBloxSQL should be able to:

- discover native job objects;
- describe them canonically;
- retain native metadata;
- create/update/drop native jobs where a qualified adapter exists;
- start/stop native jobs where supported;
- inspect history/state;
- correlate native execution with a NuBlox job/workflow;
- import an existing native schedule into the NuBlox view;
- leave native semantics visible.

A NuBlox orchestration job may delegate one step to a native scheduler without becoming the same object as that native scheduler job.

## Canonical job flow

Every durable NuBlox job follows one common control flow.

```text
Intent
  ↓
Discovery / current-state evidence
  ↓
Prerequisite assessment
  ↓
Immutable plan
  ↓
Policy / risk classification
  ↓
Approval gate (when required)
  ↓
Queue
  ↓
Lease + concurrency lock
  ↓
Pre-execution drift check
  ↓
Execute step
  ↓
Checkpoint / evidence
  ↓
More steps?
  ├── yes → continue / wait / retry / approval / external boundary
  └── no
       ↓
Post-execution verification
       ↓
Outcome + artifacts + audit
       ↓
Release lock / close run
```

The same pattern should be reused for installation, backup, maintenance, migration, upgrade and retirement rather than creating domain-specific execution engines.

## Canonical job entities

The job subsystem should separate definition, plan and execution.

### JobDefinition

A reusable description of work.

Suggested shape:

```text
JobDefinition
- jobDefinitionId
- kind
- name
- description
- owner
- lifecyclePhase
- targetSelector
- defaultPolicy
- parameterSchema
- scheduleId?
- enabled
- tags
- createdAt
- updatedAt
```

A definition is reusable and editable.

### JobPlan

An immutable executable plan produced from a definition or direct intent.

```text
JobPlan
- schemaVersion
- planId
- planHash
- jobKind
- lifecyclePhase
- targetIdentity
- targetEvidenceHash
- prerequisiteEvidence
- risk
- requirements
- steps[]
- dependencies[]
- rollbackOrRecovery
- verification
- createdAt
```

The plan is the approval boundary.

### JobRun

One durable execution attempt against one plan.

```text
JobRun
- runId
- planHash
- jobDefinitionId?
- workflowRunId?
- trigger
- status
- attempt
- priority
- queuedAt
- startedAt
- completedAt
- lease
- targetIdentity
- checkpoint
- outcome
- error
- auditReference
```

### JobStepRun

Execution evidence for one plan step.

```text
JobStepRun
- stepRunId
- runId
- stepId
- sequence
- executionMode
- status
- attempt
- startedAt
- completedAt
- checkpointBefore
- checkpointAfter
- result
- verification
- error
```

### JobCheckpoint

A durable continuation point.

A checkpoint must contain only enough information to prove what has completed and how to continue safely.

It must not contain plaintext secrets.

### JobArtifact

A durable output/reference produced by a job.

Examples:

- backup manifest;
- backup checksum;
- migration report;
- schema snapshot;
- diagnostic report;
- upgrade-readiness report;
- exported data manifest;
- verification report;
- retirement evidence package.

Large payloads should be referenced rather than embedded directly in the job row.

### JobEvent

Append-only execution/audit events.

Examples:

- planned;
- approved;
- queued;
- leased;
- started;
- step-started;
- checkpoint-written;
- retry-scheduled;
- waiting-for-external-action;
- cancelled;
- verification-failed;
- completed.

## Job state machine

The canonical run state should be explicit.

```text
planned
   ↓
awaiting-approval
   ↓
queued
   ↓
leased
   ↓
running
   ├── waiting
   ├── retry-scheduled
   ├── paused
   ├── blocked
   ├── cancelling
   └── running
        ↓
verifying
   ├── succeeded
   ├── failed
   ├── cancelled
   └── blocked
```

Recommended terminal states:

- `succeeded`;
- `failed`;
- `cancelled`;
- `blocked`.

Recommended non-terminal states:

- `planned`;
- `awaiting-approval`;
- `queued`;
- `leased`;
- `running`;
- `waiting`;
- `retry-scheduled`;
- `paused`;
- `cancelling`;
- `verifying`.

A restart/reboot/manual boundary should normally move the run to `waiting` with an explicit wait reason rather than fabricating success.

For plans intentionally invalidated by environmental drift, the run should terminate `blocked` and require a new plan rather than resuming a stale immutable plan.

## Trigger model

Jobs may be triggered by:

- manual invocation;
- one-time schedule;
- recurring schedule;
- workflow dependency completion;
- database/native event;
- threshold/condition;
- alert;
- API request;
- policy;
- retry;
- recovery/resume.

Every run should record its trigger.

Example:

```text
trigger
- type: schedule
- scheduleId
- scheduledFor
- initiatedAt
- requestedBy
- parentRunId?
- sourceEventId?
```

## Scheduling model

Scheduling and execution must remain separate.

A schedule produces job runs. It is not itself a run.

Canonical schedule concerns:

- timezone;
- start/end;
- recurrence;
- calendar exclusions;
- misfire policy;
- overlap policy;
- enabled/disabled;
- jitter where explicitly permitted;
- catch-up policy;
- target selection;
- schedule ownership.

Recommended overlap policies:

- `allow`;
- `forbid`;
- `replace`;
- `queue`;
- `skip`.

Recommended misfire policies:

- `run-now`;
- `skip`;
- `catch-up`;
- `fail`.

Database-native schedules should retain their native semantics even when represented through a canonical schedule descriptor.

## Workflow model

Workflows should be directed acyclic graphs unless a future explicit loop construct is introduced.

Node types:

- job;
- approval gate;
- condition gate;
- manual/external gate;
- wait/timer;
- verification gate;
- branch/fan-out;
- join/fan-in.

Example:

```text
                  ┌─ health snapshot ─┐
pre-upgrade check ├─ capacity check ──┼─ join
                  └─ backup check ────┘
                                   ↓
                              approval
                                   ↓
                               upgrade
                                   ↓
                 ┌─ config verify ────┐
                 ├─ schema verify ────┼─ join
                 └─ application probe ┘
                                   ↓
                                close
```

A workflow run should have its own identity and should not be inferred only from child-job metadata.

## Dependency semantics

A job dependency should declare the required predecessor outcome.

Examples:

- `on-success`;
- `on-complete`;
- `on-failure`;
- `always`;
- condition expression over predecessor evidence.

No dependent job should start merely because a predecessor emitted an event unless the dependency contract is satisfied.

## Concurrency and locks

Jobs must use durable concurrency control.

Lock scopes may include:

- host;
- engine installation;
- instance/cluster;
- database;
- schema;
- object;
- resource group;
- logical application key.

Examples:

```text
engine-install:host-123:postgresql
cluster:host-123:/var/lib/postgresql/18/main
database:server-42:finance
backup:server-42:finance
migration:server-42:finance
retirement:server-42:finance
```

The job engine should support:

- shared/read locks;
- exclusive/write locks;
- lease expiry;
- lease renewal;
- owner/run identity;
- fencing token/version.

A lease expiry must not automatically allow two writers to continue. Execution providers should use fencing/checkpoint evidence where practical.

## Idempotency

Every job kind must define its idempotency model.

Possible classifications:

- naturally idempotent;
- verify-before-repeat;
- checkpoint-resumable;
- compensatable;
- non-repeatable/destructive.

Examples:

- metadata inspection: naturally idempotent;
- backup: repeatable but produces a new artifact;
- migration: checkpoint/plan dependent;
- restore: destructive and approval-gated;
- drop database: non-repeatable/destructive;
- engine install: verify-before-repeat;
- initialization: verify-before-repeat.

Retries must be based on job semantics, not a global “retry three times” default.

## Retry policy

A retry policy should describe:

- maximum attempts;
- retryable error categories;
- non-retryable errors;
- delay/backoff;
- jitter;
- maximum delay;
- checkpoint reuse policy;
- whether reinspection is mandatory before retry;
- whether approval remains valid.

Examples of normally non-retryable conditions:

- plan drift;
- approval mismatch;
- unsupported feature;
- incompatible version;
- destructive-precondition failure;
- authentication/authorization policy denial.

Examples that may be retryable:

- transient network failure;
- temporary lock contention;
- failover interruption;
- rate/resource throttling;
- temporary provider unavailability.

## Cancellation

Cancellation should be cooperative and state-aware.

Cancellation flow:

```text
cancel requested
   ↓
cancelling
   ↓
stop accepting new steps
   ↓
attempt operation/provider cancellation
   ↓
checkpoint safe state
   ↓
verify target consistency
   ↓
cancelled
```

A destructive operation already committed cannot be “cancelled” by changing a status field.

The run must report what actually occurred.

## Secrets and identities

Secrets must never be embedded in:

- JobDefinition;
- JobPlan;
- checkpoint;
- audit event;
- log;
- artifact manifest.

Plans should carry secret references/requirements only.

Secrets should be resolved at execution time and scoped to the individual step.

Execution identity should be explicit:

- requested by;
- approved by;
- execution principal;
- database principal;
- provider identity;
- native scheduler owner/definer/proxy where applicable.

## Approval model

Approval requirements derive from risk and policy.

Typical approval classes:

- none;
- operational;
- privileged;
- destructive;
- security-sensitive;
- license;
- recovery/restore;
- production-change;
- retirement.

Approval should bind to the immutable plan hash.

Material plan drift invalidates approval.

Multi-party approval should be representable without forcing every installation to require it.

## Risk model

Every plan should classify:

- data loss risk;
- availability impact;
- security impact;
- host mutation;
- database mutation;
- restart/service interruption;
- reboot;
- irreversible action;
- recovery dependency;
- backup requirement;
- external/manual action.

This provides one common policy surface across migrations, restores, upgrades and retirement.

## Verification model

A job is not successful merely because the command/API invocation returned success.

Each job kind should define independent postconditions.

Examples:

- install → requested runtime/version/components discovered ready;
- initialize → expected cluster/instance/data directory/file exists and is ready;
- backup → artifact exists and verification policy passes;
- restore → restored database opens and required validation succeeds;
- migration → schema fingerprint/expected migration state matches;
- configuration → rediscovered configuration matches desired value;
- maintenance → engine-native completion/result evidence;
- upgrade → exact target version + post-upgrade checks;
- retirement → expected resource/service absence plus retained evidence.

## Artifact and evidence retention

Job history should separate:

1. operational logs;
2. structured audit events;
3. checkpoints;
4. verification evidence;
5. large artifacts.

Retention policy may differ for each.

For example:

- detailed debug logs: short retention;
- security/destructive audit: long retention;
- backup manifests: tied to backup retention;
- retirement evidence: policy/legal retention.

## Full lifecycle job map

The following map defines the expected job families.

### Select

Mostly assessment jobs rather than mutation jobs.

Job families:

- engine compatibility assessment;
- version/edition/distribution selection assessment;
- vendor-support assessment;
- feature/capability fit assessment;
- target topology assessment;
- support-horizon/deprecation assessment.

Typical flow:

```text
requirements
 → inspect target/application requirements
 → compare engine/version capabilities
 → assess support/compatibility
 → produce selection evidence
```

### Install

Job families:

- inspect installation target;
- assess installation prerequisites;
- resolve installation source/media;
- verify package/media provenance;
- install runtime;
- verify installation;
- repair installation;
- uninstall runtime.

Typical flow:

```text
selection
 → target inspection
 → prerequisite assessment
 → source/provenance resolution
 → immutable install plan
 → approval/license gate
 → install
 → restart/reboot wait if needed
 → reinspect
 → verify runtime/components
```

### Initialize

Job families:

- initialize PostgreSQL cluster;
- initialize MySQL data directory;
- initialize SQL Server instance/first-run configuration;
- create/initialize SQLite database file;
- initial service start/readiness;
- secure bootstrap;
- initial integrity verification.

Typical flow:

```text
installed runtime
 → initialization prerequisite check
 → initialization plan
 → secure input resolution
 → initialize
 → service/start boundary
 → readiness verification
```

### Discover

Job families:

- server/instance discovery;
- database/catalog inventory;
- feature/extension inventory;
- configuration snapshot;
- security snapshot;
- topology discovery;
- storage inventory;
- capability discovery.

These are usually idempotent observation jobs and excellent scheduled inputs to drift detection.

### Establish

Job families:

- database/catalog bootstrap;
- schema/namespace bootstrap;
- configuration baseline;
- security baseline;
- extension/feature enablement;
- database-owned storage setup;
- monitoring baseline;
- backup-policy bootstrap.

Typical flow:

```text
discover
 → desired baseline
 → diff
 → plan
 → approval if privileged
 → apply
 → rediscover
 → verify baseline
```

### Build

Job families:

- schema creation;
- migration;
- seed/reference-data load;
- initial data import;
- index build;
- materialized-object build;
- dependency validation;
- baseline snapshot.

Large build activity should use checkpoints.

### Use

Most ordinary queries remain operations, not jobs.

Use becomes job-oriented for:

- bulk import/export;
- long-running analytical query;
- batch processing;
- data transformation;
- asynchronous stored procedure/task execution;
- durable report/export generation.

### Understand

Job families:

- metadata snapshot;
- schema snapshot;
- dependency graph generation;
- statistics collection;
- query-plan capture;
- diagnostic capture;
- drift assessment;
- compatibility assessment;
- configuration/security evidence capture;
- estate inventory.

These jobs are primarily observational and can feed later workflows.

### Operate

#### Health and sessions

- health snapshot;
- session inventory;
- long-running work detection;
- lock/blocking analysis;
- deadlock evidence collection;
- transaction-state assessment.

#### Maintenance

- analyze/statistics update;
- vacuum/optimize;
- index/reindex/rebuild;
- integrity check;
- database consistency check;
- cleanup/purge job;
- native maintenance operation.

#### Backup and recovery

- backup;
- backup verification;
- backup catalogue reconciliation;
- restore test;
- restore;
- point-in-time recovery preparation/execution;
- recovery verification;
- retention cleanup.

#### Capacity

- storage-size collection;
- growth snapshot;
- threshold evaluation;
- capacity forecast;
- resource-limit assessment.

#### Replication / HA

- topology discovery;
- role/primary/replica assessment;
- lag collection;
- health assessment;
- failover-readiness check;
- switchover/failover plan and execution where explicitly supported.

#### Security operations

- account/role review;
- privilege drift assessment;
- credential-expiry assessment where engine exposes it;
- security change;
- access-revocation job;
- audit collection.

### Change

#### Database/resource change

- configuration change;
- security change;
- schema migration;
- data migration;
- data movement/backfill;
- storage/layout change;
- compatibility-level change;
- topology change.

#### Engine/runtime change

- patch readiness;
- patch/update;
- upgrade readiness;
- major upgrade;
- side-by-side upgrade;
- logical migration;
- replication-assisted migration;
- edition change;
- post-upgrade validation.

Engine upgrades should normally be workflows rather than a single job.

### Retire

Job families:

- consumer/dependency inventory;
- retirement readiness;
- final backup/export;
- final backup verification;
- write freeze;
- access revocation;
- scheduler/job disablement;
- integration shutdown evidence;
- archive;
- database detach/drop;
- instance/cluster decommission;
- engine uninstall;
- data-directory/file destruction;
- post-retirement absence verification;
- retirement evidence package.

Typical flow:

```text
retirement intent
 → dependency inventory
 → approval
 → freeze/cutover
 → final backup/export
 → restore/backup verification
 → revoke access
 → disable schedules/integrations
 → destructive approval
 → drop/decommission
 → absence verification
 → retain evidence
```

## Native job-system integration

Native job systems belong under a dedicated adapter layer.

### SQL Server

SQL Server Agent has persistent jobs containing steps and schedules and can execute jobs on schedules, in response to alerts or on demand.

NuBloxSQL should preserve:

- job identity;
- owner;
- enabled state;
- job steps;
- step subsystem;
- schedule links;
- alerts;
- operators/notifications;
- proxy/security context;
- target-server semantics where relevant;
- execution history;
- current activity.

A NuBlox job may create or start a SQL Server Agent job, then correlate the Agent execution/history with the NuBlox run.

NuBlox must not represent every SQL Server Agent step as generic SQL because Agent supports non-T-SQL subsystems.

### MySQL

MySQL Event Scheduler executes database events according to one-time or recurring schedules.

NuBloxSQL should preserve:

- event schema/name;
- definer;
- status;
- one-time/recurring schedule;
- starts/ends;
- completion preservation;
- event body;
- event-scheduler server state;
- EVENT privilege requirement;
- execution/security context.

MySQL Events are database objects and are not equivalent to SQL Server Agent multi-step jobs.

### PostgreSQL

PostgreSQL scheduling must be adapter-driven.

NuBloxSQL must not invent a PostgreSQL-core job object if scheduling is actually supplied by:

- an extension;
- an external scheduler;
- a managed-service facility;
- the NuBlox scheduler itself.

Each supported integration should declare its native capabilities.

### SQLite

SQLite should normally use the NuBlox scheduler/worker or an application/host scheduler.

NuBloxSQL must not fabricate a server-side SQLite job agent.

Scheduled SQLite work still uses the same NuBlox JobDefinition/JobRun model.

## Internal database-engine tasks

Database engines also perform internal/background work that is not user-defined scheduling.

Examples include maintenance/background writers/checkpoints and other engine-specific tasks.

These should be represented as operational activity/diagnostic evidence when visible, not imported as editable NuBlox JobDefinitions unless the engine exposes them as manageable job objects.

## Job discovery and reconciliation

NuBloxSQL should support a canonical job inventory:

```text
discoverJobs(target)
  → NuBlox schedules/jobs
  → native database jobs/events
  → status/history
  → correlation
  → drift report
```

Each discovered job object should state:

- `source = nublox | native | external`;
- engine/provider;
- native object identity;
- canonical schedule if one can be represented honestly;
- native schedule payload;
- enabled state;
- owner/security context;
- last/next execution evidence if available;
- manageability level.

Recommended manageability levels:

- `observe`;
- `start-stop`;
- `manage`;
- `external`.

## Job history

NuBlox history must not overwrite native job history.

A correlated run should retain both:

```text
NuBlox JobRun
  ├── NuBlox audit/checkpoints
  └── nativeExecution
       ├── engine
       ├── nativeJobId
       ├── nativeRunId/historyId
       ├── nativeStatus
       └── nativeHistoryEvidence
```

This makes troubleshooting possible without pretending the two systems are identical.

## Notification and alert integration

Notification is an output of job policy, not the job itself.

Job results/events may feed:

- logs;
- observability;
- email/notification providers;
- webhook/event bus;
- native database operators/alerts;
- higher-level products.

NuBloxSQL core should publish structured events and not require one notification vendor.

## Job policy

A JobPolicy should be independently reusable.

Candidate fields:

```text
JobPolicy
- retryPolicy
- timeout
- overlapPolicy
- cancellationPolicy
- approvalPolicy
- lockPolicy
- failurePolicy
- retentionPolicy
- observabilityPolicy
- secretPolicy
- verificationPolicy
```

## Failure policy

A workflow should be explicit about what happens after child failure.

Options include:

- fail workflow;
- pause for operator;
- retry child;
- run recovery job;
- continue degraded;
- execute compensation;
- branch to incident workflow.

No generic “continue on error” should exist without structured evidence.

## Recovery and compensation

Rollback is not universally possible.

The job model should distinguish:

- rollback;
- restore/recovery;
- compensation;
- forward-fix;
- manual intervention.

For example:

- failed configuration change may be reversible;
- failed schema migration may require forward-fix or restore;
- failed major engine upgrade may require recovery/side-by-side rollback;
- destructive retirement may be irreversible after retention gates expire.

## Observability

Every job should emit structured events with:

- timestamp;
- runId;
- workflowRunId;
- job kind;
- stepId;
- target identity;
- lifecycle phase;
- status transition;
- duration;
- attempt;
- error category/code;
- verification result;
- correlation/trace id.

Job logs should remain distinct from SQL query telemetry but share correlation identifiers.

## Multi-target jobs

Some operations act over an estate.

Examples:

- health collection across 200 servers;
- backup verification across all production databases;
- capacity collection;
- security review;
- upgrade-readiness campaign.

The preferred model is fan-out child jobs:

```text
Estate workflow
   ↓
target resolution
   ↓
┌─ child job DB1
├─ child job DB2
├─ child job DB3
└─ ...
   ↓
aggregate result
```

This avoids a monolithic run with one checkpoint representing hundreds of independent targets.

## Fleet and tenant boundaries

A job must always execute within an explicit ownership/security boundary.

Target resolution must not silently expand between planning and execution.

For fleet jobs:

1. resolve targets;
2. freeze the target set or target-selection policy according to workflow semantics;
3. plan;
4. approve;
5. fan out.

Tenant/product-level concerns should remain outside NuBloxSQL unless needed to identify permitted database targets; NuBloxSQL itself should not assume a downstream NuBlox application.

## Persistence abstraction

The job engine needs durable storage but should not bind the package to one application database.

Recommended abstraction:

```text
JobStore
- createDefinition
- getDefinition
- savePlan
- getPlan
- enqueueRun
- leaseNextRun
- renewLease
- appendEvent
- writeCheckpoint
- completeStep
- completeRun
- listRuns
- listEvents
- recoverExpiredLeases
```

A default local store can come later.

The public contract should allow applications to supply their own durable store.

## Worker abstraction

The worker should execute jobs, not define them.

```text
JobWorker
  poll/receive
    ↓
  lease
    ↓
  load immutable plan
    ↓
  resolve executor by job kind
    ↓
  revalidate target/policy
    ↓
  execute/checkpoint
    ↓
  verify
    ↓
  persist outcome
```

Workers should support graceful shutdown and lease handoff/recovery.

## Executor registry

Job kinds should resolve through an explicit executor registry.

Directional shape:

```text
registerJobExecutor('lifecycle.install', ...)
registerJobExecutor('lifecycle.initialize', ...)
registerJobExecutor('administration.bootstrap', ...)
registerJobExecutor('administration.configuration', ...)
registerJobExecutor('change.migration', ...)
registerJobExecutor('operations.backup', ...)
...
```

The registry must use public/stable job contracts rather than importing UI/Shell-specific logic.

## Proposed canonical job kinds

Directional namespace:

```text
selection.assess
selection.vendor-support

lifecycle.install.inspect
lifecycle.install.assess
lifecycle.install
lifecycle.install.verify
lifecycle.initialize
lifecycle.initialize.verify
lifecycle.repair
lifecycle.uninstall

discovery.server
discovery.database
discovery.configuration
discovery.security
discovery.topology

administration.bootstrap
administration.configuration
administration.security
administration.extension

build.schema
build.migration
build.seed
build.import
build.index

use.batch
use.export
use.import
use.transform

understand.metadata
understand.schema-snapshot
understand.dependencies
understand.diagnostics
understand.drift
understand.compatibility

operations.health
operations.sessions
operations.maintenance
operations.integrity
operations.backup
operations.backup-verify
operations.restore
operations.recovery
operations.capacity
operations.replication-health
operations.failover-readiness
operations.security-review

change.configuration
change.security
change.migration
change.data
change.storage
change.upgrade-readiness
change.engine-upgrade
change.edition

retirement.assess
retirement.final-backup
retirement.revoke-access
retirement.disable-jobs
retirement.drop-resource
retirement.decommission
retirement.uninstall
retirement.verify
```

This namespace is directional until the public automation API is implemented.

## Existing NuBloxSQL capability integration

The job system should wrap existing public capabilities rather than duplicate them.

Examples:

```text
DatabaseBootstrapPlanner/Executor
        ↓
administration.bootstrap job executor

DatabaseConfiguration Planner/Executor
        ↓
administration.configuration job executor

MigrationPlanner/Executor
        ↓
build.migration / change.migration job executor

DataMovement
        ↓
use.import / use.export / change.data job executor

EngineInstallationPlanner/Executor
        ↓
lifecycle.install job executor

EngineInitializationPlanner/Executor
        ↓
lifecycle.initialize job executor
```

The first job-engine implementation should prove reuse of these existing immutable-plan/executor patterns.

## Implementation sequence

Recommended development order:

### Wave 1 — Durable job kernel

Implement:

- JobDefinition;
- JobPlan envelope;
- JobRun;
- JobStepRun;
- JobEvent;
- JobCheckpoint;
- JobPolicy;
- JobStore interface;
- executor registry;
- state machine;
- lease/concurrency primitives;
- cancellation;
- retry;
- event emission.

No scheduler is required to prove the kernel.

### Wave 2 — Existing executor adapters

Wrap already-existing NuBloxSQL executors:

1. engine installation;
2. engine initialization;
3. database bootstrap;
4. database configuration;
5. migration;
6. data movement.

This proves that the job engine coordinates rather than replaces domain semantics.

### Wave 3 — Scheduler

Add:

- one-time schedule;
- recurring schedule;
- timezone;
- overlap/misfire policy;
- next-run calculation;
- schedule enable/disable;
- durable enqueue.

### Wave 4 — Workflow DAG

Add:

- parent workflow run;
- dependencies;
- parallel fan-out;
- joins;
- gates;
- manual/external waits;
- child recovery;
- aggregate status.

### Wave 5 — Native job discovery

Implement read-only native adapters first:

- SQL Server Agent job/schedule/history discovery;
- MySQL Event Scheduler discovery;
- PostgreSQL scheduler integration discovery only where a specific adapter exists;
- SQLite reports no native server scheduler.

### Wave 6 — Native job management

Only after read-only discovery is stable:

- create/update/drop;
- enable/disable;
- start;
- stop/cancel where genuinely supported;
- schedule management;
- security/owner semantics.

### Wave 7 — Operations jobs

Use the durable kernel for:

- health collection;
- maintenance;
- backup/restore;
- capacity;
- replication;
- security review.

### Wave 8 — Upgrade and retirement workflows

Build the highest-risk orchestration only after:

- backup/recovery;
- durable checkpoints;
- approvals;
- workflow DAG;
- recovery branches

are mature.

## Product boundary

NuBloxSQL owns database job semantics and orchestration.

It does not become:

- a generic operating-system task scheduler;
- a generic CI/CD server;
- a generic Kubernetes controller;
- a generic cloud workflow platform;
- a replacement for every native DB scheduler.

Its job system exists to execute and coordinate **database lifecycle work** safely, durably and audibly.

## Immediate architectural consequence

The roadmap priority previously called **Jobs and durable execution infrastructure** should become a foundational cross-cutting capability rather than a late isolated feature.

Existing migrations, data movement and lifecycle execution already need:

- durable checkpoints;
- recovery;
- scheduling;
- audit;
- locks;
- orchestration.

Therefore the recommended next product sequence is:

```text
Current lifecycle foundations
      ↓
Durable Job Kernel
      ↓
Adapt existing executors
      ↓
Scheduler
      ↓
Workflow DAG
      ↓
Native scheduler discovery
      ↓
Operations / backup jobs
      ↓
Upgrade + retirement workflows
```

This sequence gives every later database capability one consistent execution substrate.
