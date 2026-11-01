# NuBloxSQL native MySQL — operator recovery and safe deployment

**Document status:** engineering runbook, not a supported production SLA.
Only the exact MySQL/Node/transport profiles with retained CI qualification
evidence are engineering-tested. The product remains experimental.

## Before deployment or an authorised private pilot

Obtain an explicitly signed evaluation/pilot licence. Confirm the exact
MySQL patch, Node runtime, certificate chain/hostname, connection budgets,
maximum result limits, and tested rollback method. Create a dedicated
database account with **only** the permissions actually required by the
application. Never deploy the `root` CI credentials or the
`nubloxsql_readonly` test password; rotate real credentials via the
customer's secret manager and restrict distribution to approved personnel.

Use `verified-tls` with hostname validation for any networked environment.
The `isolated-local` mode is strictly for loopback, disposable test
infrastructure. Set bounded pool size, acquire and health deadlines,
query/cursor deadlines, explicit workload admission and connection closure.
Exercise a staging restore with a known-good backup under separate
customer-owned database procedures. Confirm the operator knows the change
owner and has permission to restart dependent services.

## Classify the failure

| Symptom / code | Immediate handling | Conditions to resume |
| --- | --- | --- |
| `DATABASE_ERROR` while session remains healthy | Preserve vendor error code and SQLSTATE in secure logs (not secrets or raw parameter values); correct invalid SQL or insufficient privileges | The application may issue a **new, intentional** operation after correction |
| `TIMEOUT`, `CANCELLED`, `CONNECTION_CLOSED`, `CONNECTION_FAILED` | Stop using the affected connection; permit pool to discard the transport. Inspect server health, TLS validity and capacity. | A **new authenticated** session passes health check; do not assume interrupted work was not committed |
| `TRANSACTION_OUTCOME_UNKNOWN` or ambiguous commit/rollback | **Do not automatically retry writes.** Freeze dependent business workflow and reconcile using application business keys, idempotency tokens and authoritative database state | Explicit human/application reconciliation determines one safe next action |
| Repeated pool acquire timeouts / resource exhaustion | Reduce concurrency or pause admission; inspect application lease ownership, server connection caps and pending queue | Pool size, pending waiters and native disposal counters return to configured bounds |
| Certificate verification / TLS authentication failure | Block connection, review CA trust anchor, hostname/SAN, credential rotation and server configuration | Certificate and account validation succeed; **never downgrade to plaintext** |
| Repeated crash, corruption or loss of server | Stop write traffic, escalate to database operators; isolate failed node, preserve evidence and recover using the customer's documented restore/failover process | Database integrity confirmed, application outcome reconciliation finished and driver health probes succeed |

## Rejoining a former primary after promotion

A former primary must **not** simply restart as a writable server
after another node has accepted new transactions. Even if the server
is healthy, it may be stale. In the disposable CI rejoin profile,
the old source has `super_read_only=ON` persisted before the crash;
after restart an attempted client write is rejected. Only then is
reverse GTID auto-positioned replication configured, checked and
caught up to the promoted source's executed GTID history. The old
node remains read-only throughout.

Do not apply this fixture procedure blindly to customer systems.
Actual rejoin requires the supported topology controller, external
fencing, divergent GTID examination, data-integrity checks, operator
authorisation and a documented re-seeding path when histories conflict.

## GTID catch-up does not replace fencing authority

The disposable MySQL qualification profile can reproduce real
source-to-replica GTID catch-up, then promote a read-only replica
only after the old source is demonstrably stopped and the test has
explicitly authorised that promotion. Promotion is never
inferred from server health or from a replication checkpoint alone.

For any actual customer system, only its approved topology controller
and database operators may decide or perform promotion. Require
a supported election/fencing mechanism, durable transaction
reconciliation, replicas demonstrably caught up to the chosen
recovery point, and controlled restoration of the old primary
before accepting writes. The NuBloxSQL client **does not yet
perform automatic HA failover**.

## Explicit endpoint cutover requires proven data continuity

An alternate MySQL host responding to `SELECT 1` or passing its
native health probe is **not proof** that it contains the committed
application data from a failed primary. Do not promote, replay writes,
or reopen business workflows merely because a replacement connection
succeeds. An authorised topology controller and database operator
must independently verify replication and durable transaction state,
prevent concurrent primaries (fencing), reconcile affected business
tokens and explicitly approve new writes.

The disposable two-node CI safety scenario intentionally has **no
replication**. It proves that a healthy second MySQL server lacking
the committed token causes cutover to be blocked, while the failed
primary is restarted and its durable token can still be found. This
is a safety regression, not an operable automatic failover system.

## Single-node crash at COMMIT

Disposable CI qualification now sends one bound InnoDB write and COMMIT,
kills the actual MySQL server while acknowledgement is withheld, and
restarts the same isolated service. The driver must report an unknown
transaction outcome, retire the old connection and refuse automatic
replay. A separately authenticated connection reconciles the
transaction token after recovery; either zero or one durable token
can be legitimate depending on crash timing.

**Never** use this CI crash harness on a customer, production, shared
development or otherwise unauthorised database. The customer
runbook requires its own written, authorised recovery procedure.
Even when reconciliation finds no row, other in-flight effects and
replicas must be assessed before any deliberate new operation.

## Reconcile an unknown COMMIT without replay

When an operation reports `TRANSACTION_OUTCOME_UNKNOWN`, **do not infer**
the presence or absence of a durable commit from the error code. The
same code occurs if COMMIT committed but its acknowledgement was lost,
or if COMMIT never reached the database.

For a controlled application workflow, persist a unique business
operation or idempotency token **inside the same InnoDB transaction**
as the affected write. Stop any automatic retries, retire the failed
connection, and connect independently using an authorised, healthy
database principal. Read the authoritative row by that stable token
and evaluate any downstream side effects using their separate systems
of record. If the token exists once, do not repeat the write. If it is
absent, verify that no other transaction or external side effect may
still be in flight before authorising any new action; absence at one
instant is not automatically a safe retry decision.

The disposable-MySQL regression suite verifies both durable-commit
and unsent-COMMIT fault paths, including connection retirement and
no automatic SQL replay. It is not a general distributed exactly-once
transaction guarantee. A human/operator or an explicitly designed
idempotency workflow owns the business-level reconciliation decision.

## Incident and rollback procedure

1. Record the exact driver version/commit, UTC time, MySQL server patch,
   deployment mode, supported Node version, safe error codes and
   anonymised resource counters. Do **not** retain passwords, TLS private
   keys, raw SQL parameters or customer row data in tickets.
2. Stop new work and prevent automatic replay of ambiguous writes.
   Revoke affected connection leases; drain/close the driver pool.
3. Preserve independent database incident logs and snapshot/backup
   evidence according to the customer's retention rules. Confirm a
   separate operationally authorised database operator owns recovery.
4. Roll back application/driver deployment to an **already tested,
   explicitly licensed** package version; never silently substitute
   unqualified SQL dialect or MySQL server versions.
5. Reconcile pending transactions and any externally visible side effects
   using authoritative business records, not connection IDs or attempted
   query counts alone.
6. Run fresh authenticated TLS connectivity, SELECT-only health checks,
   controlled negative permissions and isolated recovery checks.
   Reopen traffic gradually within configured connection budgets.
7. Record the incident outcome, owner approval, affected release,
   residual risk and follow-up defect; do not advertise an uptime or
   recovery SLA without measured customer-environment evidence.

## Scope and gaps

The current controlled CI tests support connection fail-closed behaviour
across particular MySQL releases and isolated TLS fixtures. They **do not**
establish recovery time objectives, recovery point objectives, data
replication correctness, regional failover, write-after-failover safety,
customer-specific database privileges, zero data loss or a support SLA.

Those requirements must be defined and witnessed before a production
commercial release. No destructive database restart qualification may
be executed against a customer system without separately authorised,
customer-controlled test procedures.

See [security threat model](MYSQL-SECURITY-THREAT-MODEL.md) and
[commercial release register](RELEASE.md).
