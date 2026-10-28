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
