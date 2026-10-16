# TASK-001 — inspect a real database and export an inventory

**Status:** **Proposed** vertical-slice specification; not approved, implemented, qualified or released.
**First candidate:** a single **PostgreSQL** engine/version running in an isolated repeatable integration fixture. Exact engine version and connection settings must be pinned at implementation review; the broader universal-driver ambition is not a promise here.

## User outcome

An authorised database professional can connect to a specific existing database instance, inspect basic **native server identity, effective principal, visible database inventory and observed capabilities**, and export the *same redacted, machine-readable evidence* from:

1. the NuBloxSQL **Driver**, via a stable headless result contract;
2. **Shell**, via a scriptable command using **only** the Driver's public API; and
3. **Workbench**, via a guided visual flow using **only** the Driver's public API.

**The task is strictly read-only.** It does not install, create, upgrade, migrate, configure or delete databases, query user table data, provision cloud accounts or bypass native catalog privileges.

## References and traceability

- Professional activity candidates: `ACT-009` (discover), `ACT-043` (vendor qualification), `ACT-047` (first run), `ACT-048` (metadata scope), `ACT-049` (inventory drift).
- Career families: `family-02`, `family-03`, `family-04`, `family-05`, `family-08`, `family-09`, `family-10`, `family-13`, `family-15`, `family-17`. Other families may consume the output.
- Lifecycle: **Discover**, with security decisions from **Establish** and subsequent usage during **Understand**.
- Requirements: `PRD-002`, `PRD-003`, `PRD-004`, `PRD-005`, `PRD-006`, `PRD-008`, `PRD-009`, `PRD-011`, `PRD-012`, `PRD-013`.
- Work-product contract: [database-inventory-v1.schema.json](contracts/database-inventory-v1.schema.json).

These are requirement relationships only; neither the roles nor the activities grant a database privilege.

## Inputs and preconditions

| Input | Requirement |
| --- | --- |
| Target | Explicit saved **profile alias** resolved within the user's secure execution context; never a credential-bearing URL in evidence |
| Adapter | A genuinely implemented, version-qualified native PostgreSQL adapter |
| Connection | Reachable endpoint, selected existing database, native database identity and least-privileged catalog-read grants |
| Authentication | Password or another explicitly implemented method loaded from a secret source, not persisted inside work products |
| Transport | **Verified TLS** for remote network connections, or a separately documented isolated local fixture exception; reject unsupported or insecure transport requests |
| Operation controls | Finite timeout and maximum inventory items, cancellation and deterministic connection/resource teardown |
| Authorisation | User identity, allowed metadata scope and native permissions verified at execution time; role names from the career taxonomy do not authorise actions |
| Intent | Read-only metadata inspection; no DDL/DML, privilege elevation, unrestricted arbitrary statements or discovery outside the authorised target |

**Assumptions still to approve:** the primary PostgreSQL engine version, supported login method and TLS test fixture, installation/distribution model for each surface, and the exact naming of the public API methods. These are not implementation facts.

## Expected behaviour

1. Validate a profile alias and qualified native adapter identity; reject unknown/unimplemented vendors.
2. Establish the database connection with the requested verified security controls. Authenticate the real target and enforce timeout/cleanup.
3. Query native, **read-only**, privilege-scoped PostgreSQL catalog/identity interfaces; obtain the current database, current principal, version and database entries visible to that principal.
4. Return typed, deterministically ordered records; cap the number of entries and record `truncated` accurately. Do not infer that hidden databases do not exist.
5. Mark every observed native capability with evidence status. Unsupported or unobserved features remain `unsupported` or `unknown`; never manufacture capability availability.
6. Create exactly one result envelope conforming to the [inventory v1 schema](contracts/database-inventory-v1.schema.json), with a capture timestamp, source alias, redacted identity, native version and visibility caveat.
7. Export that **same envelope schema** through the public Driver, scriptable Shell and Workbench; only presentation changes. All three must preserve warnings, completeness and error state.
8. Always release native sessions, statements, timers and streams on success, failure or cancellation. Return a separately coded failure (not a forged successful inventory) when connection or core identity discovery cannot complete.

## Work-product semantics

The machine-readable response is scoped to the principal's observable catalog privileges, **not** an assertion that the entire DBMS installation has been inventoried.

- `schemaVersion`: fixed to `1.0.0`; schema changes require deliberate compatibility/version review.
- `operation`: fixed to `database.inspect`.
- `status`: `completed` or `partial`; `partial` is permitted only when missing/limited metadata is explicitly communicated.
- `target`: alias, `engineId`, engine version/version number, current database and native current principal. No host, full DSN or secrets.
- `transportSecurity`: `verified-tls` or `isolated-local`; neither value implies unqualified cloud vendor support.
- `capture`: ISO UTC timestamp, requested maximum, truncation flag, and `observed-only` completeness.
- `capabilities`: only observed native capability decisions with `supported`, `unsupported`, or `unknown` state and provenance.
- `databases`: ordered native visible database identifiers and accessibility information, with a maximum enforced by the caller's controls.
- `warnings`: typed, redacted explanations of partial permission-limited results or unsupported optional metadata.

The JSON Schema is a **proposed output contract**, not proof that any real database output already conforms. Treat inventory exports as potentially sensitive operational metadata with restricted file permissions and clear retention policies.

## Product surface acceptance

| Surface | Proposed contract | Must not do |
| --- | --- | --- |
| Driver | `inspectDatabase(profile, controls) → InventoryV1` (conceptual method name, not yet final API) | Import UI/Shell code or fabricate driver capabilities |
| Shell | Proposed `nublox shell inspect --profile NAME --format json --output PATH`; exit nonzero for failures | Store raw passwords in command history or implement native SQL discovery itself |
| Workbench | Choose secure connection profile → inspect → review capability/visibility notices → export inventory | Implement private native protocol, silently conceal incomplete discovery or auto-save secrets |

The CLI syntax and API naming must be approved as part of the API design gate. Workbench must have keyboard navigation and accessible error/visibility explanations.

## Acceptance scenarios (must run on a real qualified engine)

| ID | Test | Expected result |
| --- | --- | --- |
| INV-01 | Known PostgreSQL fixture with read-only metadata rights | Real server version, effective principal and database identity match native source |
| INV-02 | Run same operation from Driver, Shell and Workbench | Equivalent canonical inventory data, status, ordering, capability states and warnings; no duplicated native adapter |
| INV-03 | Authenticate with an invalid or revoked secret | Explicit categorised failure, no captured secret and no leaked connection |
| INV-04 | Reject invalid certificate or remote connection without required verification | Connection refused; no unsafe fallback to cleartext or unverified TLS |
| INV-05 | Low-privilege principal with restricted catalog visibility | Observed-only scope, honest partial/permission warning or explicit error; no elevated access |
| INV-06 | Inventory limit lower than number of visible databases | Deterministic bounded output, `truncated=true` and `status=partial` |
| INV-07 | Unreachable target and timeout/cancel during discovery | Bounded failure, clean session disposal, no misleading success document |
| INV-08 | Unsupported adapter, PostgreSQL version or optional capability | Deterministic unsupported/unknown result; never claim a supported vendor because it is catalogued |
| INV-09 | Malicious profile alias, schema name or unexpected native field | Validate inputs; no statement injection, leaked stack secrets or uncontrolled JSON properties |
| INV-10 | All three output products exported to file | Contract-valid JSON, no passwords/tokens/DSNs, sensitive file metadata handled according to security policy |
| INV-11 | Repeated inspection without explicit authorisation changes | No target mutations; stable data apart from legitimate observation timestamp or live engine changes |
| INV-12 | Cloud vendor/managed service without its own qualification | No claim of cloud IAM, private endpoint or TLS certification from a local PostgreSQL pass |

Mocks may test API-level shape and fault injection but **cannot substitute for real-engine tests**. A release requires reproducible fixture scripts, conformance evidence, negative security cases, clean-install consumers and accessible Shell/Workbench acceptance.

## Exit gate

The **specification** is ready to leave draft only when the database-engine version, API naming, schema/error contract, profile security model, fixtures and all test oracle expectations are reviewed and accepted. It becomes **delivered** only after a successful real DBMS → public Driver → Shell + Workbench → common inventory test. No current green docs-only workflow proves that software exists.
