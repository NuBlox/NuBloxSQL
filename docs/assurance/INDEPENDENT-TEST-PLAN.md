# Independent MySQL driver acceptance test plan

**Authority:** proposed test inventory for external reviewers; all outcomes **UNTESTED BY EXTERNAL ASSESSOR**. Reviewers should amend and expand it independently rather than merely certify our existing CI.

## A. Protocol correctness and adverse inputs — G1/G2

- **G1-01:** Clean-room install of the exact tarball in a fresh Node 22 Linux x64 consumer; verify exports, ESM imports, TypeScript declarations and documented APIs.
- **G1-02:** Prove representative native SQL, binary/text result types, null handling, signed/unsigned 64-bit integers, decimals, Unicode/invalid UTF-8 policy and column metadata round-trips against pinned MySQL 8.4.13.
- **G2-01:** Inject split/oversized Classic frame headers, invalid continuation sequence numbers, malformed length-coded integers, status flags, truncated EOF/ERR/OK packets, large column counts and trailing response data.
- **G2-02:** Independently fuzz decoder/parser and handshake with coverage-guided and threat-driven malformed packets; collect crash, heap/RSS, CPU and timeout evidence with triage of every unique failure.
- **G2-03:** Exercise pooled prepared statements, multiple result sets, binary parameter boundaries, exact 32 MiB message limit, aggregation of individually valid large binds, cursor state/cleanup and result resource caps.
- **G2-04:** Test server version/capability negotiation rejects unsupported features safely, never fabricating support.

## B. Authentication, TLS, confidentiality — G3

- **G3-01:** Negative TLS trust, wrong hostname/SAN, expired/not-yet-valid certificates, CA rotation, identity substitution and forced plaintext downgrade. Prove no fallback bypass.
- **G3-02:** Supported caching_sha2_password fast and full authentication; cold-cache, wrong password, disabled user, privilege changes and least-privilege SELECT-only restrictions. Account for distinct `isolated-local` versus `verified-tls` support.
- **G3-03:** Validate that error objects, diagnostics, CI artifacts, stack traces, environment output and package inventory never disclose credentials, tokens, certificate private keys, bound values or full customer SQL.
- **G3-04:** Assess malicious server behaviour and hostile application input at authentication/protocol trust boundaries, with independent findings, risk ratings and **retest**.
- **G3-05:** Review SBOM/dependency risks, installed tarball, provenance and secure disclosure contact. A vulnerability scan alone does not replace source-assisted testing.

## C. Transactions, fail-closed semantics, recovery — G4/G11

- **G4-01:** Inject partial reads/writes, mid-packet socket loss, cancellation and deadline expiry at SELECT, INSERT, COMMIT, ROLLBACK and prepared execution boundaries.
- **G4-02:** Confirm ambiguous write/commit returns the appropriate outcome-unknown state, never success or automatic replay. Reconcile exactly once by a **new session** using stable application identity.
- **G4-03:** Attempt expired pooled lease, escaped cursor/statement, detached transaction work, double close, slow native close, dial failure and connection reset with pending queries; prove no silent success or unsafe reuse.
- **G11-01:** Inject primary loss, partition, stale primary, asymmetric fencing, credentials/certificate replacement and recovery after failover; prove no split-brain write and document observed RTO/RPO.
- **G11-02:** Demonstrate customer-representative backup/restore and exact rollback procedure with an authorised operator. Driver failover tests do not replace real recovery exercises.

## D. Performance and endurance — G5/G6

- **G5-01:** Independent competitor-neutral comparison on documented fixed hardware with identical workload, TLS verification, MySQL patch, connection count, warm-up, data volume, run order and uncertainty intervals. Retain raw data; **do not claim superiority** from synthetic or shared-runner-only measurements.
- **G6-01:** Run real multi-hour and separate overnight concurrent-read endurance with successful SQL progress, verified SQL-error recovery, reconnects, heap/RSS trends, socket counts, queue depth, latency distribution and pool release.
- **G6-02:** Run sustained committed-write and intentional-rollback workloads with independently checked persisted values, verified-TLS profile, output digests, memory/progress sample continuity, pool cleanup and server health.
- **G6-03:** Include planned restarts, dropped connections, exhaustion and repeated recovery; distinguish genuine application stalls from an alive process. Scheduled or configured-but-skipped jobs are **not evidence**.
- **G6-04:** Review memory trends for credible retention/leaks. Evidence of a short bounded run is not a guarantee of multi-day absence of leaks.

## E. Package, compatibility and commercial operations — G7/G8/G9/G10

- **G7-01:** Verify actual tarball and hash, reproducible consumer installation, source/release identity, public API compatibility under the advertised semver policy, signed provenance and dependency audit.
- **G8-01:** Independently approve only explicitly tested MySQL patch × Node runtime × OS/architecture × TLS/DBaaS combinations. Treat unsupported combinations as excluded from sales claims.
- **G9-01:** Review named support owner, confidential security intake, incident rehearsal, escalation, patch/EOL policy, on-call reality, monitored alerts and customer rollback documents.
- **G10-01:** Qualified UK technology counsel to review ownership, third-party licences, pilot and production grants, support/SLAs, limitation of liability, distribution rights, privacy role allocation and commercial terms.

## Mandatory assessor outputs

For **each** test provide: independent test identifier, exact commit/tarball hash, commands or reproducible procedure, fixture fingerprint, actual result, pass/fail/not-tested, timestamp, redacted artifact reference, reviewer name, limitations and any finding ID. Link each observation to one or more G1–G11 gates.

**Independent security release bar:** all high/critical findings fixed and independently retested, or a specifically justified, externally reviewed acceptance signed by security and release ownership under a documented policy. Minor findings must have documented ownership and time-bound treatment. The development team cannot self-certify any independent outcome.
