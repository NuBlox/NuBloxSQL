# Native MySQL driver — security threat model and validation register

**Scope:** `@nublox/driver@0.1.0-dev.0`, MySQL Classic Protocol client and
its published package. **Classification:** engineering threat assessment;
not an independent penetration test, formal security certification, or a
commercial production-security sign-off.

## Trust boundaries

The client runs inside an application's Node.js process. Application-provided
SQL, parameters, target configuration, TLS trust roots, credentials,
deadlines and callbacks cross into the driver. MySQL greeting, errors,
metadata and row packets cross the untrusted server/transport boundary.
An authenticated pooled connection is scoped to one checkout; cursor,
prepared-statement and transaction handles remain session-owned. The
compiled npm package and dependency resolution are a separate
software-supply-chain boundary.

**Threat actors:** unauthorised network endpoints, compromised or
misconfigured database servers, hostile application inputs, malicious
dependency artifacts, and code using escaped/revoked handles.

| Threat | Existing engineering control | Evidence / remaining limit |
| --- | --- | --- |
| Server identity substitution or network interception | `verified-tls` validates chain and server name; plaintext permitted only on explicitly isolated loopback | Pinned LTS negative CA/hostname tests. Cloud/private PKI and rotation not qualified |
| Excessive database privileges | New isolated CI fixtures authenticate as `nubloxsql_readonly` with SELECT-only grant; SSL-required user in TLS profile | Explicit write/DDL denial, prepared/cursor/pool/transaction and recovery tests. Production principal/role management not yet assessed |
| Credential disclosure | Redacted error vocabulary; no SQL/row/secret capture in qualification artifacts | Negative authentication and error tests. Independent log review and secret rotation process still open |
| SQL injection or unsafe binding | Native bound prepared statements; inputs treated as values, not query text | Protocol and type conformance suite. Applications remain responsible for query text they build |
| Session poisoning or handle reuse | FIFO command lifecycle, statement/cursor ownership, pool reset, cancellation and fail-closed ambiguous cleanup | Real MySQL restart, cursor and prepared cleanup, pool saturation and multi-version tests. Multiple network partition profiles remain open |
| Ambiguous transaction commit after transport loss | Outcome-unknown error classification and no automatic SQL replay | Injected failure regression; customer recovery/idempotency runbook and write workloads remain open |
| Protocol parser memory exhaustion | Packet and cursor bounds, deadlines, error redaction, resource cleanup | Malformed framing tests. Formal coverage-guided fuzzing still required |
| Denial of service through pool exhaustion | Bounded physical sessions, pending waiter caps and acquire timeouts | Twelve-borrower/two-slot controlled pressure test. Prolonged high-load and mixed workload evidence remains incomplete |
| Malicious installation or unreviewed dependency | No published runtime dependencies, forbidden lifecycle hooks, npm-pack allowlist, Node 22/24 dependency audit | Independent installed-package tests. Signed artifacts, provenance attestation and vulnerability-response commitments are not yet implemented |
| Privilege escalation through test fixtures | Root used **only** to provision disposable CI database and install procedures; restricted driver tests never use root | CI-root credentials are fixed test-only values. This is not a deployable production account-management design |

## Security release conditions

Security approval **must not** be inferred from CI alone. Before any
commercial production grant, the responsible owner must obtain and retain:

1. An independently reviewed threat model with assigned treatment for
   every residual High/Critical risk.
2. External penetration-testing results and retest of findings, plus
   threat-driven protocol fuzzing with sanitised evidence.
3. A published confidential vulnerability-reporting address and an
   operated response/patch process, with named accountable personnel.
4. Verified least-privilege database identities on representative customer
   infrastructure, TLS trust-root rotation, credential rotation and access
   revocation procedures.
5. Reproducible release provenance and separately reviewed code-signing/
   artifact-signing and dependency integrity controls.
6. Signed-off customer data handling, support terms, legal permissions,
   operational recovery and rollback procedures.

All listed requirements are **open** unless independently evidenced and
approved. The proprietary `LICENSE` is ownership protection, **not** an
automatic customer licence.

The authority to accept residual security risk belongs to the product
owner and relevant security/legal reviewers, not a code test or an AI
assistant. See [commercial release gate](RELEASE.md).
