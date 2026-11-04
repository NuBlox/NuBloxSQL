# NuBloxSQL Driver — commercial release qualification

**Status: experimental / pre-commercial, 22 October 2026.**
A passing CI job or npm package does not grant commercial redistribution rights
or establish a production service-level commitment. This register is a
release-decision gate, not a marketing checklist.

## Machine-readable commercial decision (fail closed)

The reviewed [MySQL commercial decision manifest](release/mysql-commercial-decision.json)
covers proposed MySQL 8.4.13 / Node 22 / Linux x64 / verified-TLS scope only.
It is a **proposed pilot qualification target, not an approved customer profile**.
All G1–G11 release sign-offs and independent product/security/legal/support
approvals remain pending. **Neither customer evaluation, production use nor
package publication is currently authorised.**

`npm run release:verify` checks this manifest's full shape, exact dev package
identity, all pending gates and absence of any claims of approval. The unpublished
candidate GitHub workflow also invokes the decision check explicitly, and writes
a redacted `artifacts/release/commercial-decision.json` audit report.
`npm run release:production-check` **must fail** until a separately reviewed
production authorisation mechanism is implemented and independent signed
evidence is accepted. No field or boolean checked into Git can alone approve
commercial distribution. A green preview CI is **not a production readiness pass**.

The authoritative outstanding work and independent sign-off criteria remain in
[issue #421](https://github.com/NuBlox/NuBloxSQL/issues/421). Production
authorisation requires a separate reviewed implementation, package/version
transition, per-profile evidence, product decision and approved customer terms.

## Minimum mandatory protected-branch CI coverage (G1/G3/G7)

The GitHub `main` ruleset currently requires the check named `docs`, but
does not yet individually require the native MySQL and security workflow
contexts. To prevent this one mandatory check from passing based solely on
skip-gated database tests, its job now starts a throwaway pinned MySQL 8.4.13
service, installs stored-procedure fixtures, executes the full native MySQL
test suite on Node 24 with `NUBLOX_LIVE_MYSQL=1`, blocks high/critical npm
advisories, and runs the same package/commercial preflight. A failing real
MySQL test now fails the currently required `docs` check. The other matrix
and verified-TLS workflows remain distinct evidence; this change does
**not** imply their statuses are individually required by the ruleset.
Issue [#328](https://github.com/NuBlox/NuBloxSQL/issues/328) still requires
a permitted administrator to add the complete reviewed status-check matrix
to protected `main`. Pre-commercial and independent security/legal/support
gates remain open.

## Bound-parameter allocation safety before MySQL COM_STMT_EXECUTE (G2/G6)

MySQL's native prepared command now computes the full length of all bound
parameters, null bitmaps, type flags and variable-length prefixes before
encoding even its first potentially large string or binary value. Inputs
that exceed the existing 32 MiB logical-command limit—either individually
or in aggregate—fail before allocating rejected payload copies or writing
to the socket. The same single-value bound protects direct protocol encoder
calls. Exact-limit valid packets retain byte-for-byte Classic encoding;
the native session remains reusable after a locally rejected bound value.
Unit regressions cover an exact-limit payload, a one-byte overage, large
UTF-8/BLOB values, and an aggregate overage; live MySQL tests check a
rejected prepared statement followed by a successful execution on the
same authenticated connection. This limits avoidable memory amplification
from rejected commands; it is **not** a total-process memory quota, general
OOM guarantee or commercial qualification sign-off.

## Current verified engineering scope

The current implementation is a first-party MySQL Classic protocol client,
tested primarily against **MySQL 8.4.11** with local isolated TCP and
certificate-verified TLS. Public entrypoints support bound query and
transaction operations, reusable prepared statements, bounded pooling,
read-only cursors, deadlines and cancellation, strict result decoding and
bounded packet fragmentation. The current package is `@nublox/driver` at
`0.1.0-dev.0`. The repository includes a proprietary ownership notice and
licence; there is **no general downstream commercial grant**.

## Release gates

| Gate | Current evidence | Status for a production commercial release |
| --- | --- | --- |
| G1. Repeatable functional integration | Pinned MySQL 8.4.11 and verified-TLS CI, installed-package consumer tests | **Partial**; extend versions and installation targets |
| G2. Protocol/types/correctness | Native packet tests, result/type regression fixtures, protocol malformed-input tests | **Partial**; broader fuzz coverage, recovery conditions and capability matrix |
| G3. Secure authentication and transport | Negative CA, hostname, credentials, loopback-only plaintext, dependency audit and package preflight checks | **Partial**; formal threat model, independent penetration test, threat-driven fuzzing and least-privilege server users |
| G4. Cancellation and transaction safety | Abort/deadline, session reset, pooled/cursor resource-ownership tests | **Partial**; failure injection during writes and ambiguous commit, severe outages |
| G5. Reproducible performance | Workload scripts, latency/memory diagnostics and machine-readable evidence | **In progress**; quantitative baseline, competitor parity and stable hardware |
| G6. Sustained stability | Timed pooled soak and reconnect workloads in CI | **In progress**; overnight/multi-day tests, heap profiles, database restarts and chaos matrix |
| G7. Public API and package stability | Strict TypeScript, independently installed tarball tests, and automated publish-content/licence/import integrity validation | **Partial**; versioning guarantees, semantic compatibility tests and multi-Node qualification |
| G8. Version/deployment matrix | MySQL 8.4.11 local/TLS pinned qualification | **Not met**; qualify other MySQL versions, OS/architectures, TLS deployments |
| G9. Support operations | No published response-time or escalation commitment | **Not met**; support contact, release policy, CVE/security process, change logs |
| G10. Commercial licence and delivery | Proprietary ownership stated in LICENSE | **Not met**; legal review and explicit customer evaluation/production terms, billing, invoicing and redistribution |
| G11. Disaster/recovery | Fail-closed session, pool and cursor invalidation | **Not met**; documented restore/failover operating guidance and sustained fault testing |

Statuses must be changed only after linking independent evidence.
No arbitrary throughput, latency or uptime claim is authorised by a green PR.

## No phantom success for unfinished pooled work (G4/G6)

An exclusive `withConnection()` callback previously could return a value
while a query, statement operation, transaction or cursor started through its
lease was still pending. Although the pool discarded the unsafe connection,
the caller could mistakenly observe successful callback completion. The pool
now rejects such premature completion as `CONNECTION_CLOSED` with an
explicit warning that SQL effects may be unknown, and irrevocably discards
the native connection without replay. Already-awaited work remains eligible
for normal reset and reuse. Synthetic gated-I/O and live MySQL tests exercise
premature success, delayed native SQL, physical replacement and normal reuse.
This is a fail-closed improvement, not evidence that an interrupted write did
not commit. G4 and G6 remain partial/in progress.

## Detached managed transaction commands cannot claim success (G4)

Managed MySQL `transaction(callback)` now reports
`TRANSACTION_OUTCOME_UNKNOWN`, rather than a generic closed-session error,
when the callback returns or throws while scoped SQL remains unsettled.
The native connection is revoked without sending a misleading COMMIT or
retrying SQL. The original uncertain outcome is preserved across the
session-interruption race. An outstanding scoped operation that settles
*after* callback lifetime also rejects with an uncertain-outcome diagnostic:
its late server response cannot be interpreted as confirmation that its
owning transaction committed. Normal fully awaited transactions and
confirmed callback-error rollbacks are unchanged. Deterministic gated I/O
tests cover callback success, callback error, delayed native success and
delayed native failure. A live InnoDB test checks that a write acknowledged
by MySQL but abandoned by its callback cannot report completed success.
G4 remains incomplete and externally reviewed commercial sign-off is pending.

## Fail-closed MySQL pool transaction state (G4/G6)

The native `COM_PING` checkout probe and `COM_RESET_CONNECTION` lease
reset now require their complete MySQL OK acknowledgements to report no
`SERVER_STATUS_IN_TRANS` flag. A contradictory status revokes the physical
connection as a protocol failure; checkout may replace it before application
work, while a failed reset rejects the completed lease rather than presenting
a false safe-reuse outcome. No application SQL is replayed. Deterministic
native-packet and pool-replacement tests exercise valid and invalid statuses.
This is a defensive consistency check, not proof that an untrusted server
accurately represents its transaction state or evidence of commercial readiness.

## Independently checked SQL-work progress during extended MySQL soaks (G6)

Sustained pooled-read and durable InnoDB write-soak runners now retain
bounded 30-second aggregate samples of verified successful SQL work
alongside their existing process memory samples. Independent evidence
validation requires matching timestamps, strictly nondecreasing
operation counters, and exact reconciliation with the completed workload
count. Runs of 30 minutes or longer fail if more than 90 seconds of
sampled time passes without newly confirmed SQL completion. A process
that remains alive and reports plausible heap/RSS observations cannot
therefore substitute for a stalled database workload. Short CI runs
retain start/end-only observations and do not prove multi-hour endurance.
These safeguards improve G6 evidence integrity; actual sustained and
independently reviewed production-readiness evidence remains outstanding.

## No false callback success after pool shutdown (G6)

A pool shutdown now invalidates the observable `lease.closed` property
synchronously, including while native socket disposal is still pending.
If an active `withConnection()` callback later returns from unrelated
application work after pool-initiated shutdown, it rejects with
`CONNECTION_CLOSED` and an explicit warning that SQL outcomes may
be unknown. A callback that catches a native query failure may still
return its own recovery result; the disconnected session is discarded. It does not return the callback's nominal
success value. Already-failed callbacks preserve their original errors;
previously completed callbacks remain successful even if shutdown
starts while their native reset is in progress. Native disposal is owned
by the existing single shared shutdown barrier. Deterministic gated
shutdown, handled-native-loss and original-error regressions plus live
MySQL qualification exercise the race. This advances G6 reliability but
does not establish a service-level or commercial production guarantee.

## All-settled pool shutdown disposal barrier (G6)

The bounded connection pool no longer uses fail-fast `Promise.all` for
native session shutdown: a single rejected close must not settle the shared
`close()` barrier while another physical connection is still closing. It now
awaits all currently owned and already-discarding session closures, preserves
the first native disposal error for the caller, never retries a failed close,
and counts native slots until each closure finishes. Deterministic regression
tests inject an early failed close plus a slower independent close, including
a session already being discarded. Late noncooperative dialing remains an
explicitly bounded best-effort shutdown limitation; no guarantee of graceful
server drain or production readiness is inferred. G6 stays incomplete.

## Cursor cleanup error precedence (G4/G6)

A secondary failed `COM_STMT_CLOSE` after cursor work must not overwrite the
original cursor or application exception. The driver now preserves the first
failure across operation-guard interruption while permanently revoking the
physical connection. Live regression tests cover typed SQL diagnostics,
ordinary callback exceptions, no cleanup replay and pooled replacement. The
existing successful-operation cleanup error behaviour remains unchanged.
G4/G6 still require independent qualification and are not release-approved.

## Explicit transaction completion under nondefault MySQL settings (G4)

The native driver now uses `COMMIT AND NO CHAIN NO RELEASE` and `ROLLBACK
AND NO CHAIN NO RELEASE`. This overrides server/session `completion_type`
settings rather than allowing an acknowledged managed transaction to start
another transaction or disconnect the socket. The driver validates native
`SERVER_STATUS_IN_TRANS` on `START TRANSACTION`, `COMMIT` and `ROLLBACK`,
rejecting contradictory states with fail-closed disposal. Synthetic protocol
and live MySQL tests cover CHAIN and RELEASE policy, both successful commit
and application-error rollback, and ambiguous completion. The G4 gate remains
partial: these checks do not establish the outcome of a lost acknowledgement.

## Managed transaction-boundary detection (G4)

Scoped `tx.query()` and `tx.queryResults()` now require the final native
MySQL server result to report `SERVER_STATUS_IN_TRANS`. If a statement
implicitly or explicitly ends the managed transaction, the driver revokes the
session and reports `TRANSACTION_OUTCOME_UNKNOWN`; no subsequent synthetic
`COMMIT` or automatic write replay is permitted. New deterministic and live
InnoDB regression tests demonstrate a durable INSERT surviving DDL's implicit
commit, followed by reconciliation through a fresh pooled connection. This
improves detection, **not** rollback guarantees. For a recoverable SQL
error in a managed transaction, the native client now issues one same-session
COM_PING status probe: if the transaction is no longer active or cannot be
verified, the driver discards the connection and reports an unknown outcome.
This closes the failed-DDL pre-commit gap while preserving normal SQL errors
when the server confirms an active transaction. MySQL DDL and administrative
operations can commit before execution, and routines can alter transaction
boundaries beyond what status probes alone can prove. Applications must avoid these operations
inside managed transactions and reconcile uncertain outcomes. G4 remains
**partial / pending**, not commercially signed off.

## Numeric binary-row decoding optimisation (G5)

The MySQL [binary result decoder](../packages/driver/src/vendors/mysql/types.ts)
now reads fixed-width signed/unsigned integers, bigint, float and double
directly from the validated packet offset instead of creating a transient
`Buffer.subarray` for each numeric cell. Before each read it verifies that
the full field is present, preserving the previous fail-closed truncation
behaviour. NULL bitmaps, string collations, decimal, JSON, BLOB, temporal
values and public result shapes are unchanged.

The [scalar compatibility tests](../packages/driver/tests/mysql-binary-scalar-fastpath.test.mjs)
independently reproduce the former slice-based parser across signedness and
numeric boundaries, 64-column NULL bitmap positions, deterministic 1,500-row
mutations and deliberately shortened frames. Existing real-MySQL type,
prepared-statement, cursor and failure tests remain release requirements.

The [internal native before/after workflow](../.github/workflows/mysql-native-optimisation.yml)
builds the exact PR baseline and candidate and measures both general mixed
decoding and a targeted in-process numeric microprofile with alternating
baseline/candidate order and identical packets. These timings are
**diagnostic only** and must not be represented as network/query latency,
independent performance superiority or commercial qualification. **G5 stays open.**

## Prepared execution buffer allocation (G5)

The native [COM_STMT_EXECUTE encoder](../packages/driver/src/vendors/mysql/protocol/commands.ts)
now calculates a bounded command size and writes the header, NULL bitmap,
parameter types and values directly into **one final output allocation**.
Existing value/type/range encoders are preserved. The implementation
checks the 32 MiB command ceiling before allocating its output and writes
every byte of the allocated buffer.

The [wire-equivalence regression](../packages/driver/tests/mysql-prepared-encoding-fastpath.test.mjs)
compares exact output bytes with the prior encoder for all supported binding
types, NULL bitmap boundaries, binary/Unicode values, cursor mode and
deterministic mutated parameter lists. A separate [BAAB baseline/candidate
microprofile](../.github/workflows/mysql-prepared-encoding.yml) compiles
the exact PR base and proposed driver on the same CI runner and measures
synthetic packet encoding with identical inputs. These measurements can
identify allocation overhead but are **not** wire-network response latency
or comparative mysql2 performance proof. All existing live MySQL and
verified-TLS qualification checks must still pass. **G5 remains open.**

## Strict verified-TLS competitive evidence (G5)

A separate [MySQL TLS competitor workflow](../.github/workflows/mysql-comparison-tls.yml)
compares NuBloxSQL and an independently installed, pinned `mysql2@3.24.6`
using the same MySQL 8.4.13 TLS-required fixture and bound query. Both
clients must verify the certificate authority and server identity,
present a nonempty TLS cipher and reject an unrelated CA; mysql2 has
`verifyIdentity: true` explicitly. Reused mysql2 session tickets are
disabled within the comparison harness by constructing a fresh SSL
configuration for each connection. Both client orders alternate,
with original trials and a separate same-run evidence verification.

The current GitHub workflow collects **only two small exploratory
runs** on shared runner hardware and cannot certify any performance
advantage. A commercial claim requires representative customer
workloads, controlled dedicated environments, many reproducible
independent samples and reviewed uncertainty bounds. **G5 remains
in progress.**

## Verified-TLS transactional write evidence

A separate [TLS write qualification workflow](../.github/workflows/mysql-write-soak-tls.yml)
now exercises actual MySQL 8.4.13 InnoDB commits and rollbacks over
certificate-verified TLS with a restricted **SELECT/UPDATE REQUIRE SSL**
application identity. Its fixture administrator is separate from pooled
application connections. Bad CA, wrong hostname, incorrect password,
unencrypted-transport policy and denied DDL have explicit negative checks.
Independent same-run evidence validates final durable counters, time,
resource cleanup and security assertions.

**G3/G6/G8 remain incomplete.** A passing short smoke test is not a
long-duration, multi-environment, independent security or customer-production
approval. The [resilience register](MYSQL-RESILIENCE-QUALIFICATION.md)
defines the narrower engineering evidence.

## Durable transactional write qualification (new evidence stream)

The [write-endurance workflow](../.github/workflows/mysql-write-soak.yml)
adds real MySQL **InnoDB committed-write and intentional-rollback** endurance
testing, independent follow-up reads, final durable counter reconciliation,
bounded resource trends, pool teardown and cleanup of its disposable
per-run table. Short PR/main smoke checks run automatically. Weekly
30-minute and manually requested one/two-hour runs require successful
original observations plus a separate same-run evidence validator.

A configured scheduled job, passing mock test or short PR smoke is **not**
evidence of multi-hour endurance. The work does not qualify verified-TLS
writes, managed cloud, independent security or customer data safety.
**G6 remains in progress** until representative long-duration reports are
retained and independently approved. See [resilience details](MYSQL-RESILIENCE-QUALIFICATION.md).

## Reproducible workspace dependency gate

The experimental driver is now built from a **committed npm v3 lockfile**
(`package-lock.json`). Workspace CI uses `npm ci --no-audit --no-fund`
rather than silently resolving new build-tool versions. The reviewed graph
contains only development dependencies: TypeScript 5.9.3, Node.js type
definitions 22.20.5 and undici-types 6.21.0. The driver itself retains
**zero third-party runtime dependencies**.

`npm run verify:lock` checks exact workspace linkage, matching package
manifests, HTTPS npm registry tarball identities, SHA-512 integrity digests,
the dependency allowlist, and absence of dependency install scripts.
`npm run release:verify` requires this gate before its existing tarball
preflight and strict public API checks. `npm test` includes negative
lock-policy regression tests. Pinned, separately installed comparison
fixtures remain outside the release workspace dependency graph.

**Procedure for intended upgrades:** change the source `package.json`
manifest, regenerate the root lockfile using a reviewed Node/npm version,
inspect the full dependency diff, update the allowlist/policy tests if the
new transitive graph has been explicitly approved, run `npm ci`,
`npm test`, `npm run release:verify`, and independently rerun CI before
merging. Never use `npm install` as the normal CI installation command.
A checksum/registry allowlist is not a substitute for audit, provenance,
a reviewed dependency update, independent security evaluation or legal
distribution approval. G7 and G10 remain **partial/not met** respectively.

## MySQL transactional fencing-epoch qualification

An isolated TLS-required MySQL 8.4.13 CI gate now tests **server-side,
monotonically increasing authority epochs**. Two distinct restricted
database principals can invoke a test-owned, security-definer stored
routine, but cannot directly read or write its authority or
operation tables. Each write locks and verifies the current
`(epoch, authenticated identity)` inside the same transaction as
its business-token INSERT. Stale epochs, unauthorised holders,
replays and direct writes must fail; competing administrative epoch
compare-and-swap operations yield exactly one winner. A real
server restart must retain the new epoch and continue refusing
the old authority. An independent same-run evidence check is required.

This demonstrates a **server-enforced single-node fencing primitive**,
not a production integration or independent trusted election service.
Privileged SQL clients are not fenced by the routine. NuBloxSQL
does not transparently enforce the epoch on every SQL operation.
Commercial HA release gate G11 remains **not met**.

## Asymmetric observer visibility and test-controlled hard fencing

An additional pinned MySQL 8.4.13 CI gate now uses independent
network-scoped observer clients with conflicting views of which
MySQL node is reachable. The test proves that a stale candidate
cannot be promoted on local health alone, persists a read-only
fence on the current source, kills its actual server process, then
requires that promotion remain blocked while GTIDs are missing.
Following a read-only restart, GTID replication must recover and
both nodes must remain non-writable. A separate same-run evidence
decision verifies network views, source fencing and cleanup.

This advances the G11 qualification matrix beyond symmetric
client reachability, but does not implement production distributed
fencing or authoritative leader election. The two-server test is
not an availability SLA or commercial HA approval.

## Split-brain safety during a replication-link partition

An additional disposable MySQL 8.4.13 CI gate now partitions only the
source-to-replica Docker replication network while both database
endpoints remain independently healthy and reachable. A new committed
source write is deliberately missing from the read-only replica and
the full source GTID barrier times out. The test verifies that direct
writes to the replica fail and an explicit fail-closed policy blocks
unsafe promotion and SQL replay while the old source is unfenced.
After the transport heals, the replica must catch up, preserve both
business tokens and remain read-only with the original source still
writable. Same-run independent evidence validation is required.

This strengthens **one specific partition safety path**, not a
production election protocol, lossless replication contract, topology
fencing authority or general multi-node high availability.
Commercial gate G11 remains **not met**.

## Read-only former-primary recovery and GTID rejoin

The pinned disposable MySQL 8.4.13 qualification now includes a
recovered former-primary scenario. The old source persists its
`super_read_only` fence **before** process termination, remains stopped
while a caught-up replica is explicitly promoted, and restarts in
read-only mode after the promoted node commits a new operation token.
A client INSERT on the recovered server must fail; it must then
configure reverse GTID auto-positioned replication, receive the
promoted commit, and retain both original and new tokens without ever
becoming writable. The promoted source remains the sole writable
instance. Independent same-run evidence and negative tests are required.

This strengthens controlled recovery engineering coverage for G11,
but does not implement customer fencing authority, automatic
former-primary rejoin, split-brain detection under arbitrary
network partitions or production availability guarantees.

## Real MySQL GTID replication and controlled fixture promotion

A pinned, isolated two-container MySQL 8.4.13 CI profile now
provisions source/replica GTID replication rather than assuming
a healthy second server is current. It waits for a source GTID
barrier, verifies an acknowledged business-token commit is present
on the read-only replica, kills and fences the original source,
and then permits an **explicit test-only promotion** of the
caught-up replica. The new promoted node must preserve the
original token and acknowledge exactly one new write, while the
former source remains stopped. A second job independently verifies
the retained same-run evidence.

This improves G11 engineering evidence but does **not** supply a
production failover controller, synchronous data-loss prevention,
authorised customer fencing, former-primary rejoin, cloud topology
support, availability SLA or generally safe automatic routing.
Commercial G11 approval remains **not met**.

## Independent MySQL endpoint cutover must fail closed

A two-node pinned MySQL 8.4.13 qualification now provisions independent,
nonreplicated database containers. After committing a business token on
one node it crashes that primary during an in-flight read, confirms old
pool retirement and connects freshly to the healthy alternate node.
The alternate node lacks the committed token, so application-managed
cutover is **blocked**: no automatic transaction replay, write
resumption or standby promotion is permitted. The original node is
restarted, original committed state is reconciled and both fixtures
are cleaned up. A dependent job checks the retained same-run
evidence and malicious/partial evidence fixtures are unit-tested.

**This does not establish multi-node high availability or replication.**
It demonstrates a critical no-data-loss safety prerequisite for G11,
which remains **not met** pending genuine replication, failover and
fencing qualification on supported topologies.

## Genuine MySQL server-crash COMMIT qualification

A dedicated PR/main CI job now crashes a pinned disposable MySQL
8.4.13 container with `SIGKILL` after one native COMMIT frame is
written and before the driver receives acknowledgement. The test
requires `TRANSACTION_OUTCOME_UNKNOWN`, a retired native session,
exactly one write and transaction callback, **no replay**, restart of
the same service, read-only business-token reconciliation (0 or 1
durable token, depending on crash timing), a healthy fresh pool
connection and complete cleanup. A second dependent job independently
validates same-revision/same-run crash evidence.

This extends G4/G11 real-server failure coverage beyond a transport
proxy. It does **not** establish the precise InnoDB commit boundary,
database-cluster correctness, cloud recovery or safe automatic retries.
Customer recovery requirements and independent commercial approval
remain outstanding.

## Deterministic ambiguous-COMMIT outcome reconciliation

A dedicated MySQL 8.4.13 local-CI integration gate exercises
two distinct write outcomes with the native first-party protocol driver:
one successful InnoDB COMMIT whose final acknowledgement is deliberately
corrupted, and one client transport interrupted **before** COMMIT reaches
the server. Both correctly return `TRANSACTION_OUTCOME_UNKNOWN`;
fresh independently authenticated read-only reconciliation confirms
**one durable token** in the former case and **no durable token** in
the latter. The pool must discard poisoned sockets and must never
replay either transaction callback or bound write.

The tests create and remove isolated test-owned tables. This is
direct real-database evidence for the error contract and recovery
procedure, not a guarantee about external side effects, customer
workloads, replica failover, real server crashes during COMMIT or
full recovery operations. G4 and G11 remain incomplete.

## Mixed prepared/cursor/transaction/pool qualification

The MySQL resilience workflow now includes an independently selectable
**mixed native lifecycle profile** in addition to the longer pooled
read-soak. It exercises bound queries, prepared-handle closure,
server-side cursor draining, read-only transaction commit/rollback and
reuse through a bounded native pool. Four sequential but concurrently
executed phases record per-phase heap/RSS/externals and bounded latency
samples. The total memory timeline is checked with existing investigative
growth guardrails and all connections must close.

Normal PR/main runs execute an eight-second integration smoke; weekly
scheduled/manual runs are configured for ten minutes. These checks
extend *functional* G4/G6/G11 engineering coverage but do not constitute
multi-day endurance, sustained writes, ambiguous commit recovery or
commercial production approval.

## Bounded memory observation during endurance

Timed soak qualification now uses a constant-capacity 4,096-value
latency reservoir rather than retaining every successful operation's
latency, so the qualification harness does not introduce linear memory
growth as query count increases. Soak percentiles are **sample estimates**
with the actual total operation count retained separately. This does not
change the published native driver.

On long scheduled/manual endurance jobs a 30-second, maximum-256-sample
process heap/RSS/external/ArrayBuffer timeline is retained. The
independent long-soak validator rechecks timestamps, sample coverage,
trend calculations, and provisional 128 MiB heap / 256 MiB RSS
growth-investigation guardrails. Synthetic regression tests reject both
forged data and deliberately sustained growth. These gates do not claim
absence of leaks, validate all physical memory effects, or replace heap
profiling under customer-like write loads; G6 remains **in progress**.

## Extended version and restart qualification (new evidence gate)

The [version and recovery workflow](../.github/workflows/mysql-version-qualification.yml)
now executes independent CI jobs against the fixed official Docker image tags
`mysql:8.0.44` and `mysql:8.4.11`, on Node.js 22/Linux x64.
Each matrix entry builds and runs the native regression suite (including real
MySQL), installs stored-procedure fixtures, performs bounded prepared/cursor/
pool/authentication qualification, and captures a timed concurrent soak.
PR/push runs require at least **5 seconds** of soak per version; weekly scheduled
runs require at least **120 seconds** per version. These are explicitly
short qualification stages, **not** multi-day stability evidence.

The same CI job then *destructively kills* its disposable MySQL service
during an outstanding prepared SQL request, waits for the native connection
and prepared handle to be revoked, restarts MySQL and requires a bounded pool
to recover using a **new physical connection (proven by pool lifecycle counters)**, with no
automatic SQL replay. The recovery runner requires CI, an explicit destructive
fixture opt-in, a container identity, an exact allowed MySQL version and
Docker image identity. **Do not run against a real customer database.**

A job is evidence only once it has completed successfully. Store the
version-specific JSON artifacts alongside its run URL and commit SHA.
This augments G1, G4, G6, G8 and G11; it does **not** qualify arbitrary
MySQL versions, other operating systems/architectures, TLS on every version,
cloud endpoints, overnight endurance or customer recovery targets.
G8 and G11 remain **not met** for general commercial release until their
full deployment and recovery requirements have independent evidence.

## Certificate-verified TLS version matrix

The [MySQL version qualification workflow](../.github/workflows/mysql-version-qualification.yml)
also runs independent certificate-verified TLS jobs for the pinned
`mysql:8.0.44` and `mysql:8.4.11` images on Node.js 22/Linux x64.
Each job starts a TLS-required server using a newly generated, short-lived
test CA and a hostname/IP SAN certificate; verifies the actual MySQL
version; and runs native TLS regressions for trusted authentication,
rejected CA, invalid hostname, missing trust, incorrect credentials,
rejected plaintext transport, transactions, prepared statements,
server-side cursors and pooled state reset. A bounded qualification runner
also records rejected-authentication results and native-resource evidence.
The fixture rejects unsupported image versions before startup and removes
the container and ephemeral key material on cleanup.

Keep the separate 8.4 TLS driver CI job as a baseline. The matrix extends
G1, G3 and G8 only for these exact local-Linux test profiles. A green run
must be retained with its version-specific artifact, commit SHA and workflow
URL before being treated as evidence. It does not qualify TLS certificates
from cloud providers, external networks, alternative architectures,
future patch versions or commercial deployments. G8 remains **not met**
for general commercial release.

## Matrix-wide evidence integrity gate

The `mysql-qualification-evidence` job runs **after** both native-version
and TLS-version matrices. It downloads the four independent
version/transport artifact groups and rejects the full matrix decision
unless it finds exactly eight valid reports: a local benchmark, local
soak, TLS benchmark and destructive-restart report for **each** of
MySQL 8.0.44 and 8.4.11. It checks the actual server version,
Node 22/Linux x64 and matching commit SHA, verified TLS rejection
coverage, authentication cleanup, cursor/statement/pool workloads,
zero unexpected errors, the minimum elapsed soak duration, and
fail-closed restart/statement revocation without replay.

The validator produces a single redacted `mysql-qualification-matrix`
JSON artifact only after passing all checks. Missing, duplicated, failed,
stale or cross-version reports fail the gate. A green individual job is
**not** a substitute for a green matrix evidence decision. Neither the
validator nor its unit tests connect to customer servers or store
credentials, SQL, row data or connection IDs. This improves traceability
of G1/G3/G4/G6/G8/G11 but is **not** independent penetration testing,
external disaster recovery, long-duration stability or a commercial
release approval. Keep G8 and G11 unfulfilled beyond the tested profile.

## Maintained MySQL LTS TLS qualification and current-release evidence

The [current MySQL release qualification specification](MYSQL-CURRENT-RELEASE-QUALIFICATION.md)
defines separate pinned native local-TCP qualification for MySQL
`8.4.13`, `9.7.4`, and `26.10.0`, plus certificate-verified TLS
integration for the **8.4.13 and 9.7.4 LTS** lines. The TLS fixture
requires an ephemeral trusted CA, verified hostname, authenticated TLS
cipher, negative CA/hostname/credential tests, and prepared/cursor/pool
operation coverage. The Innovation 26.10.0 version remains
**local-TCP-qualified only**, not TLS-qualified.

An independent `mysql-current-qualification-evidence` job checks the
three local benchmarks, three duration-bounded soaks, three real server
restart reports and two LTS TLS benchmarks, enforcing the same exact
revision, actual server-version and environment constraints as the
legacy matrix. All eleven reports are required; one failed or missing
LTS TLS job invalidates the complete current-release decision. Save
the single redacted current-release evidence artifact and the Actions
run URL for each qualified revision.

This extends the scope of G1/G3/G4/G6/G8/G11 evidence; **G8 remains not
met for a general commercial release** without cross-platform, cloud,
resilience and independent security qualification.

## Repeated outages, bounded pool pressure and longer endurance

The dedicated [resilience qualification](MYSQL-RESILIENCE-QUALIFICATION.md)
adds an independent GitHub Actions workflow for pinned MySQL 8.4.13:
two destructive `mysqld` outage/restart cycles on each PR/main run,
or six cycles on scheduled/manual runs. Every cycle verifies twelve
concurrent borrowers against a two-connection pool before and after
the crash, native capacity and waiter cleanup, terminated in-flight
work, revoked prepared handles, and fresh authenticated recovery
without SQL replay. A separate dependent evidence gate requires each
original crash report to match the redacted aggregate decision.

A parallel, isolated weekly endurance job runs a minimum **30-minute**
timed pooled soak. A manually dispatched run can request **one or two
hours** (with a bounded iteration ceiling and explicit full-duration
checks). These are available qualification profiles, **not claims that
long-duration runs have passed until their evidence artifacts exist**.
Process memory peaks and snapshots are observations, not proof of a
memory-leak-free service. A clean pool at shutdown is a stricter,
separately verified resource invariant.

The scheduled/manual `mysql-extended-soak` job now has a separate
`mysql-extended-soak-evidence` verification job that requires the original
same-run, same-commit MySQL 8.4.13 report, the exact configured duration,
valid read/error-recovery counts, reconnect evidence, process resource
measurements and zero pool/waiter capacity after shutdown. It stores a
redacted independent decision and fails if the original job or its artifact
is missing. Unit tests run during normal PR checks; full-duration evidence
is accepted **only after** a successful scheduled/manual run and decision.
This is an evidence-integrity improvement, not an assertion that a
multi-hour workload has already passed.

This advances evidence for G4/G6/G11, but the gates remain
**incomplete** pending multi-day stability, multiple outage mechanisms,
write/commit ambiguity qualification, HA failover, security assessment,
realistic customer profiles and documented operational recovery targets.

## Commercial security and operator assurance

The [least-privilege qualification workflow](../.github/workflows/mysql-restricted-principal.yml)
provisions a fresh **SELECT-only** database principal rather than
using the privileged CI fixture account. Current-release
plaintext-loopback checks require cold full `caching_sha2_password`
authentication to **fail closed**; they do not claim successful cold
restricted-user login over plaintext.

The two qualified LTS versions (8.4.13 and 9.7.4) exercise **functional
least-privilege SQL over verified TLS** with MySQL `REQUIRE SSL`:
prepared statements, cursors, read-only transactions, pool reset, denied
writes and DDL, and clean disposal, plus plaintext/credential rejection.

The [security threat model](MYSQL-SECURITY-THREAT-MODEL.md)
enumerates network identity, credential handling, native protocol and
result parsing, resource exhaustion, transaction ambiguity, data
privileges and package-supply-chain threats; residual risks remain
open pending formal review. The [operator runbook](MYSQL-OPERATIONS-RUNBOOK.md)
specifies safe connection retirement, no automatic ambiguous-write replay,
reconciliation and rollback, TLS refusal and staged resumption.

**These documents and CI tests are engineering evidence, not third-party
security approval, signed customer licensing, a staffed vulnerability
process or a customer recovery SLA.** G3, G9, G10 and G11 remain open
until their independent requirements and accountable sign-offs exist.

## Native MySQL parser mutation regression corpus

The package's ordinary `npm test` suite includes a fixed-seed,
dependency-free [protocol mutation corpus](../packages/driver/tests/mysql-parser-mutation.test.mjs).
It exercises malformed MySQL greetings, authentication switches and
continuations, length-encoded fields, result/prepare/EOF acknowledgements
and incrementally framed messages with random TCP chunk boundaries.
A deliberately incorrect packet sequence must fail closed; valid split
frames reconstruct the original payload. Parsing results and error
classification are checked within strictly bounded input sizes and
iteration counts so CI execution is reproducible on Node 22 and 24.

This improves G2/G3 *engineering regression coverage*. It does **not**
substitute for independent coverage-guided fuzzing, sanitiser-assisted
native audits, an external security assessment or security risk signoff.
Those commercial release blockers remain open.

## Preview public API compatibility gate

The [public API compatibility contract](DRIVER-PUBLIC-API-COMPATIBILITY.md)
pins **21 named root exports** for `@nublox/driver@0.1.0-dev.0` and
their value-vs-type status to an explicitly reviewed baseline. Every
`npm run release:verify` now builds a strict TypeScript consumer fixture
against the published declaration entrypoint; incompatible connection,
pool, statement, cursor, transaction, type or error contracts cause
release preflight failure. The ordinary `npm test` suite also tests that
unexpected exports, aliases, defaults, subpaths and preview version
changes cannot pass the lock.

Redacted `artifacts/release/public-api-contract.json` records the
compiled declaration SHA-256, baseline fingerprint, revision and runtime.
Both Node 22 and Node 24 package-security jobs exercise the contract.
The independent tarball consumer smoke test remains in force.

This adds concrete **G7 compatibility-change detection**, but the gate
remains **partial**: no stable customer release exists against which to
verify backward compatibility, semantic-versioning promises, deprecation
windows, support lifecycle or separately signed release provenance.
Review an updated baseline only in an explicit versioned PR with
documented consumer impact; do not treat a green API lock as commercial
licensing or production suitability.

## Unpublished release-candidate provenance

The [candidate provenance specification](RELEASE-CANDIDATE-PROVENANCE.md)
adds a GitHub Actions build gate that packages the exact preview npm
tarball, validates its SHA-256, proprietary licence, dependency inventory,
API compatibility evidence and source commit. On **`main` only**, the
workflow signs SLSA provenance via GitHub OIDC and Sigstore and uses
`gh attestation verify` to require the exact signer workflow, source
revision and branch identity. Pull requests build/inspect an **unsigned
candidate**; a green PR check is not evidence that provenance signing
succeeded. Only a green main-branch signing and verification job is
suitable evidence for a specific candidate.

The workflow never publishes to npm, grants redistribution rights,
promotes `0.1.0-dev.0` to a stable release, or provisions customer
credentials. This advances G3/G7/G10 *engineering supply-chain evidence*
but does **not** complete commercial licensing, external security review,
support commitments, code-review segregation or production release
authorisation. See the source workflow and retained Actions attestation
for the specific validated commit before making an integrity claim.

## Target decision levels

- **Engineering preview**: clearly labelled non-production, qualified on a
  single version and transport profile, reproducible install and live tests.
- **Private paid pilot**: written pilot licence, limited supported target
  profile, customer consent to limitations, support contact, mandatory
  vulnerability reporting, explicit acceptance and rollback procedure.
- **General commercial release**: all release gates met for each advertised
  version/profile, reviewed contractual terms, traceable signed release,
  published security and lifecycle policy, and documented support channels.

The owner decides pricing and distribution. This register does **not**
unilaterally license the software to anyone. If an evaluation customer needs
rights to run the package, a written evaluation licence must be executed
before deployment. Public GitHub/npm access alone is not that licence.

## Evidence procedure

Run `npm run verify`, the pinned MySQL integration and TLS suites, plus
`npm run qualify:mysql -- --iterations=120 --concurrency=4` and
`npm run soak:mysql -- --durationMs=120000 --concurrency=4` against an
isolated throwaway MySQL fixture. Download the attached JSON from the
GitHub Actions qualification jobs; preserve commit SHA, Node version,
server version, transport, environment, row counts, latency percentiles,
throughput, heap/RSS and resource counters.

Before any performance comparison, run identical SQL, prepared parameter
types, row counts, concurrency, server config, network, hardware,
warmup, TLS, memory sampling and measurement windows against competitor
clients, with independent raw outputs and an explicit fair-comparison
method. The qualification runner currently measures **NuBloxSQL only**.

Open blockers must remain public in this document until separately verified.
