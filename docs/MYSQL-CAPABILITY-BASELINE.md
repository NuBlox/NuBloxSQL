# WP00 — MySQL capability and evidence baseline (revision 1)

Audit date: 2026-11-25. Audited source: [aa0e3b94a5ce5ab52e4ec29d03d6543bbf165248](https://github.com/NuBlox/NuBloxSQL/commit/aa0e3b94a5ce5ab52e4ec29d03d6543bbf165248). Programme: [#490](https://github.com/NuBlox/NuBloxSQL/issues/490).

This is an engineering traceability baseline, not a commercial support declaration or exhaustive conformance verdict. It supplements, rather than replaces, [RELEASE.md](RELEASE.md), [DRIVER.md](DRIVER.md), [PRODUCT.md](PRODUCT.md), and the blocked commercial decision. Source paths and test names below were checked against the non-truncated Git tree; public contracts and selected protocol files were inspected. Individual test assertions have not all been audited. Status codes: E = implemented with relevant passing engineering CI; P = partial implementation or evidence; N = no dedicated public implementation observed; U = not yet established. A successful job is not proof of every feature or scenario in its category.

## Baseline inventory

265 tracked blobs; 28 driver source files; 56 driver test files matching *.test.mjs; 20 workflow definitions. 56 main-revision check runs: 54 succeeded, 2 schedule-only extended soak checks skipped, none failed. [Exact main revision checks](https://github.com/NuBlox/NuBloxSQL/commit/aa0e3b94a5ce5ab52e4ec29d03d6543bbf165248/checks). PR #489 is outside this source baseline and requires fresh checks after updating its branch to main. No local working tree was available for inspection.

## Official specification anchors

- S1 [Classic protocol basics](https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_basics.html) (version-sensitive; use the exact 8.4 protocol revision when designing conformance cases).
- S2 [8.4 prepared statement protocol](https://dev.mysql.com/doc/dev/mysql-server/8.4.11/page_protocol_command_phase_ps.html).
- S3 [8.4 text result sets](https://dev.mysql.com/doc/dev/mysql-server/8.4.11/page_protocol_com_query_response_text_resultset.html).
- S4 [MySQL 8.4 reference manual](https://dev.mysql.com/doc/refman/8.4/en/), particularly authentication, encrypted connections, data types, transactions, INFORMATION_SCHEMA and client/server connection interfaces.
- S5 [Prepared statement caching](https://dev.mysql.com/doc/refman/8.4/en/statement-caching.html).
- S6 [Compression control](https://dev.mysql.com/doc/refman/8.4/en/connection-compression-control.html).

References are research anchors, not a claim of audited compliance with every specification clause. Driver-specific lifecycle and package requirements derive from DRIVER.md and the master programme.

## Capability register

Source paths are relative to packages/driver/src; test paths are relative to packages/driver/tests. Evidence IDs below refer to runs on the audited main revision.

| ID | Capability | Status | Source | Representative test file(s) | Spec / evidence | Gap / next work |
|---|---|---|---|---|---|---|
| C01 | Public connection and target validation | E | core/connection.ts, core/contracts.ts, vendors/mysql/configuration.ts | mysql-connection-identity.test.mjs | S4 / E1,E2 | WP60 broader transports |
| C02 | Classic greeting, capabilities and login | P | vendors/mysql/protocol/handshake.ts | mysql-greeting-security.test.mjs, mysql-auth-negotiation.test.mjs | S1,S4 / E1,E3 | WP10 flag/handshake clause audit |
| C03 | Authentication | P | vendors/mysql/auth/plugins.ts, adapter.ts (vendor directory) | mysql-auth-negotiation.test.mjs, mysql-least-privilege-live.test.mjs | S4 / E3 | Two recognised plugins; cold full SHA2 only verified TLS; other methods not certified |
| C04 | Certificate-verified TLS and loopback restriction | E | vendors/mysql/adapter.ts, configuration.ts | mysql-tls-live.test.mjs, mysql-connection-identity.test.mjs | S4 / E1,E3 | WP40 certificate rotation |
| C05 | Packet framing, sequences, fragmentation | E | vendors/mysql/protocol/framing.ts, primitives.ts | packet-fragmentation.test.mjs, mysql-frame-header-fastpath.test.mjs | S1 / E1 | WP10 coverage-guided corpus |
| C06 | Connection cancellation and deadlines | E | core/resources.ts, vendors/mysql/adapter.ts | mysql-connect-cancel.test.mjs, mysql-connect-deadline.test.mjs | DRIVER / E1 | WP40 workload/fault matrix |
| C07 | Native prepared execution | E | vendors/mysql/protocol/commands.ts, prepared.ts, adapter.ts | mysql-prepared-live.test.mjs, mysql-prepared-encoding-fastpath.test.mjs | S2 / E1 | WP20 expanded binding/large value options |
| C08 | Explicit prepared handle lifecycle | E | vendors/mysql/prepared.ts, adapter.ts | mysql-prepared-close-retry.test.mjs, mysql-prepared-live.test.mjs | S2 / E1 | WP40 lifecycle stress |
| C09 | Exact SQL implicit prepared cache | E | vendors/mysql/statement-cache.ts, adapter.ts | mysql-statement-cache.test.mjs, mysql-statement-cache-live.test.mjs | S2,S5 / E4,E5 | WP30 matched workload benefits |
| C10 | Literal text execution and multiple results | E | vendors/mysql/text-results.ts, adapter.ts | mysql-text-results.test.mjs, mysql-text-protocol-live.test.mjs | S3 / E1 | WP20 text streaming, no arbitrary interpolation |
| C11 | Prepared multi-result / stored procedures | E | vendors/mysql/protocol/results.ts, adapter.ts | mysql-multi-protocol.test.mjs, mysql-multi-live.test.mjs | S2 / E1 | WP10 audit boundary variants |
| C12 | Column metadata and duplicate names | E | vendors/mysql/metadata.ts, types.ts, protocol/results.ts | mysql-column-key-scaling.test.mjs, result-boundaries.test.mjs | S2,S3 / E1 | WP10 metadata encoding and boundary audit |
| C13 | Binary row and numeric/temporal fidelity | P | vendors/mysql/types.ts, collations.ts | mysql-types-live.test.mjs, type-fidelity.test.mjs, mysql-binary-scalar-fastpath.test.mjs | S2,S4 / E1 | WP10 type/range matrix by version |
| C14 | Text type fidelity and collations | P | vendors/mysql/text-results.ts, collations.ts | mysql-collations.test.mjs, mysql-collations-live.test.mjs | S3,S4 / E1 | WP10 complete explicit supported/excluded matrix |
| C15 | OK / ERR / EOF acknowledgements | P | vendors/mysql/protocol/results.ts, primitives.ts, errors.ts | codec.test.mjs, result-boundaries.test.mjs, mysql-result-header-fail-closed.test.mjs | S1 / E1 | WP10 exact unsigned 64-bit acknowledgement values |
| C16 | Managed transactions and uncertain outcomes | E | vendors/mysql/adapter.ts, models/relational.ts | mysql-managed-transaction-boundary-live.test.mjs, mysql-rollback-outcome.test.mjs, mysql-transaction-detached-outcome.test.mjs | S4 / E1,E6 | WP40 continued failover/reconciliation; never replay |
| C17 | Transaction isolation/access mode/savepoint API | N | models/relational.ts (current transaction signature) | Dedicated contract not observed | S4 / none | WP20 explicit scoped options and savepoint lifecycle; native SQL access is not a typed API |
| C18 | Bounded prepared cursor | E | vendors/mysql/cursor.ts, adapter.ts | cursor-protocol.test.mjs, mysql-cursor-live.test.mjs | S2 / E1 | WP30 streaming performance |
| C19 | Backpressure-aware Node row stream | E | core/row-stream.ts, vendors/mysql/adapter.ts | mysql-row-stream.test.mjs, mysql-row-stream-live.test.mjs | DRIVER / E1 | WP20 general text-mode streaming not exposed |
| C20 | Bounded materialisation | E | vendors/mysql/materialization.ts, core/resources.ts | mysql-materialization-budget.test.mjs | DRIVER / E1,E7 | WP30 calibrated retained heap/RSS |
| C21 | Pool reset, ownership and resource lifecycle | E | core/pooling.ts, vendors/mysql/adapter.ts | pool-lifecycle.test.mjs, mysql-pool-live.test.mjs, mysql-pool-transaction-status.test.mjs | DRIVER / E1,E4 | WP40 fairness, prolonged load |
| C22 | Protocol fault handling and parser mutation | P | vendors/mysql/protocol/*, adapter.ts | mysql-parser-mutation.test.mjs, mysql-fault-matrix.test.mjs, mysql-wire-fault-live.test.mjs | S1 / E1,E6 | WP10 coverage-guided fuzzing; existing deterministic corpus not replaced |
| C23 | Native error taxonomy and redaction | P | core/errors.ts, vendors/mysql/errors.ts, protocol/results.ts | mysql-decoder-classification.test.mjs, mysql-session-fatal-live.test.mjs | S1 / E1,E3 | WP10 redaction and classification audit |
| C24 | Server identity and capability discovery | P | core/contracts.ts, core/capabilities.ts, vendors/mysql/capabilities.ts | mysql-connection-identity.test.mjs | S4 / E1,E2 | Four static capability identifiers; negotiated feature/deployment matrix |
| C25 | Schema/catalogue discovery API | N | vendors/mysql/metadata.ts, models/relational.ts (no dedicated catalogue API) | Dedicated contract not observed | S4 / none | WP20 bound INFORMATION_SCHEMA queries; privilege visibility |
| C26 | Batch execution and large-value upload API | N | models/relational.ts, protocol/commands.ts (existing per-command bound execution) | Dedicated contract not observed | S2 / none | WP20 semantics and limits; no unsafe interpolation |
| C27 | Unix socket / managed-cloud identity / compression | N | core/contracts.ts, vendors/mysql/configuration.ts (TCP target only) | Dedicated contract not observed | S4,S6 / none | WP20/WP60 prioritise after security and demand analysis |
| C28 | Package installation and public API | P | index.ts, package.json, core/contracts.ts | package-consumer.test.mjs | DRIVER / E8 | WP50 stable version, compatibility, docs |
| C29 | Least privilege and operational resilience | P | adapter.ts, core/pooling.ts | mysql-least-privilege-live.test.mjs, mysql-transaction-reconciliation-live.test.mjs | S4 / E3,E6 | WP40 long-duration evidence; no customer SLA |
| C30 | Deployment matrix | P | core/contracts.ts, configuration.ts | mysql-live.test.mjs, mysql-tls-live.test.mjs | S4 / E2,E9 | WP60 platform/auth/cloud qualification |

## Evidence ledger (same main revision)

| ID | Workflow run(s) | Observed result / limitation |
|---|---|---|
| E1 | [Native MySQL / TLS](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118918), [docs baseline](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118912) | Required docs and both native/TLS jobs succeeded |
| E2 | [Current release qualification](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118965) | 8.4.13 and 9.7.4 local/TLS, 26.10.0 local; aggregate evidence succeeded; Innovation TLS unqualified |
| E3 | [Least privilege](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118961), [CodeQL](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721119182) | Jobs succeeded; no independent assessment or individual findings audit inferred |
| E4 | [Cache concurrency](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721119188) | Quota 4 and verified-TLS quota 8 jobs succeeded |
| E5 | [TLS cache endurance](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118970) | Workload and evidence checks succeeded, not a multi-day claim |
| E6 | [Outages/recovery](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118969), [durable write](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118910), [TLS write](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721119031) | Executed fault and write jobs succeeded; extended soak + evidence skipped |
| E7 | [Internal profile](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721119201), [concurrent comparison](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118967), [TLS comparison](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721119027) | Jobs succeeded; raw numeric results not inspected or retained independently yet |
| E8 | [Package security](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721119007), [release provenance](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118917) | Node22/24 and provenance checks succeeded; package not authorised for sale |
| E9 | [Legacy/baseline version qualification](https://github.com/NuBlox/NuBloxSQL/actions/runs/45721118930) | 8.0.44 and 8.4.11 local/TLS succeeded; not a production support declaration |

Performance artifact metadata observed: concurrent comparison 15071907581 (expires 2026-12-09), native profile 15072217619 (expires 2026-12-09), TLS comparison 15071224213 and decision 15071982435 (expire 2027-01-24). Each identifies the audited main SHA. Download and securely retain redacted raw reports before expiry, verify digests against API metadata, then derive a baseline with environment/workload semantics and variability. No comparative speed or memory claim from this ledger alone.

## Preserved performance report snapshots

The [baseline report snapshot](evidence/mysql-performance-aa0e3b94.json) retains seven JSON reports from the original three workflow job logs, including 48 comparative trial summaries, ten synthetic stage summaries and both repeated-run analyses. It preserves original reported metrics, strips the runner-local path, and records source revision, run/job IDs and GitHub-reported artifact ZIP digests. It is not a byte-for-byte copy of the original ZIP archives; archive bytes have not been verified.

| Workload | Local TCP p50 ratio (native / mysql2) | Verified TLS p50 ratio |
|---|---:|---:|
| Connection only | 0.525636 | 0.951894 |
| Prepared sequential | 1.139433 | 1.150350 |
| Prepared concurrent | 1.455896 | 1.229234 |

Ratios are geometric means of paired run summaries, not throughput ratios. Reference is mysql2 3.24.6. Transports use different pinned server versions (8.4.11 local, 8.4.13 TLS), so this is not a controlled TLS overhead experiment. Both analyses report inconclusive evidence (two runs, two rounds, 12 operations per trial, concurrency 2). Concurrent prepared execution is a WP30 investigation candidate, not a proven bottleneck attribution or justification for skipping WP10/WP20. Refresh on a frozen candidate with larger matched workloads. Original ZIP retention/digest verification remains open.

## Ranked execution queue

| Rank | Work package | Deliverable and acceptance |
|---|---|---|
| 1 | WP00 | Complete #489 with current-head CI, verify merged main, clean branch; freeze raw evidence and link digests. |
| 2 | WP00 | Complete clause-level protocol/test traceability and reconcile stale README/RELEASE/DRIVER scope descriptions with E2/E6; preserve all commercial gates. |
| 3 | WP10 | Investigate OK packet unsigned 64-bit fidelity: current public affectedRows/insertId are number and Cursor.len rejects > MAX_SAFE_INTEGER. Design non-lossy compatible API before changing contract; synthetic and live high auto-increment ID tests, no silent rounding, no misleading failed write acknowledgement. |
| 4 | WP10 | Audit framing, metadata strings, auth flags, all supported type/collation bounds; implement coverage-guided bounded fuzz harness with reproducible seeds and regression corpus. |
| 5 | WP20 | First-class negotiated capability discovery and catalogue API, with permission-scoped live tests and explicit exclusions. |
| 6 | WP20 | Scoped transaction isolation/access/savepoint API, expanded bind fidelity, streaming/batch designs. |
| 7 | WP30–60 | Workload-matched performance, endurance, usability and deployment qualification in programme order; establish real baseline before setting thresholds. |
| 8 | WP70 | External/owner/security/legal/support approvals and ruleset #328; release issue #421 remains open. |

G1/G2/G3/G4/G5/G6/G7/G8/G11 have engineering evidence to varying degrees; G9/G10 and all final sign-offs remain open. Main ruleset 25231727 was read live: active, strict required checks, only docs context required, no bypass actors. Do not weaken it. No commercial decision changes made.

WP00 is not closed: raw evidence retention, detailed conformance mapping, documentation reconciliation, and outstanding PR integration still require completion.
