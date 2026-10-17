# TASK-001 — inspect a real database and export an inventory

**Status (16 October 2026):** G0 **engineering baseline accepted for implementation**, not implemented, live-qualified or released. No public npm API exists yet.
**Initial target:** **PostgreSQL 17** in a disposable CI container. Additional PostgreSQL versions, all other DBMS vendors and managed-cloud offerings require separate evidence.

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

## Engineering decisions for G0

- **Target:** PostgreSQL 17 as the first CI qualification fixture (pin `postgres:17` to a digest in the G1 pipeline). This is a **test target**, not current release support.
- **Runtime/build:** Node.js 24 baseline, strict TypeScript with ESM/`NodeNext` module semantics, an npm-workspaces monorepo and committed lockfile. Distinct Driver, Shell and Workbench packages must remain private until independently qualified. **Owner-corrected decision (ADR-014/015):** implement PostgreSQL protocol v3 framing, SCRAM authentication and native query flow as NuBloxSQL first-party source using Node core sockets/crypto. The previous `pg`-based demonstration was temporary and may not underpin the proprietary driver.
- **API:** `inspectDatabase(profile, options): Promise<InventoryV1>`. The Driver owns native discovery. `profile` is resolved on the trusted server/process side; accepted fields are explicitly allowlisted rather than handing arbitrary options/connection strings to `pg`. `options` include `maxDatabases` (1–1000, default 100), finite timeout and abort signal.
- **CLI:** `nublox shell inspect --profile ALIAS --format json --output PATH`. A private connection profile/secret resolver runs locally; passwords never appear in flags or work products. The CLI must write atomic, permission-restricted output and return nonzero on failure.
- **Workbench:** local/private SvelteKit server-side operations call the Driver API. No `pg` connection or secrets in browser bundles, stores, JSON responses or local storage. Export exactly the same canonical inventory object.
- **Authentication:** PostgreSQL SCRAM/password fixture from CI secrets/environment only. Do not persist raw secrets or include connection strings in diagnostics.
- **Transport:** unencrypted connections are admitted **only** for explicitly isolated loopback `127.0.0.1`/`::1` fixtures. In `verified-tls` mode, the first-party native client now performs PostgreSQL SSLRequest, requires acceptance (`S`), consumes precisely one response byte and verifies the certificate chain and target hostname/IP identity through Node core TLS. Any refusal, unexpected response, trust or name mismatch fails closed; no insecure downgrade or credential-bearing URI. CI proves native TLS on a disposable PostgreSQL 17 service using generated CA and server certificates, with negative untrusted-CA, valid-CA/wrong-hostname and TLS refusal tests. **SCRAM-PLUS/channel binding and production remote/cloud endpoint identity/networking remain unqualified**.
- **Error:** failures use the [safe error v1 contract](contracts/database-operation-error-v1.schema.json), never an inventory with `status=completed`, a leaked raw `pg` exception or an unredacted target string.
- **Scope:** source catalog rows are filtered by native `CONNECT` privilege and `datallowconn`; `visible` does not mean “every database in the cluster,” and `CONNECT` privilege does **not** prove a network/host-based connection is possible.

These are **approved design choices for the first implementation only**. Success remains gated on reproducible tests, public API review, secure export behaviour and real DBMS → Driver → both tools integration.

## Expected behaviour

1. Validate a profile alias and qualified native adapter identity; reject unknown/unimplemented vendors.
2. Establish the database connection with the requested verified security controls. Authenticate the real target and enforce timeout/cleanup.
3. Read the native PostgreSQL identity using parameter-free built-ins, and read the shared `pg_catalog.pg_database` with the exact `CONNECT` privilege and `datallowconn` filter below. PostgreSQL's `pg_database` may expose names without `CONNECT` permission; **never treat bare catalog rows as authorised inventory**. <https://www.postgresql.org/docs/17/catalog-pg-database.html>
4. Return typed, deterministically ordered records; cap the number of entries and record `truncated` accurately. Do not infer that hidden databases do not exist.
5. Mark every observed native capability with evidence status. Unsupported or unobserved features remain `unsupported` or `unknown`; never manufacture capability availability.
6. Create exactly one result envelope conforming to the [inventory v1 schema](contracts/database-inventory-v1.schema.json), with a capture timestamp, source alias, redacted identity, native version and visibility caveat.
7. Export that **same envelope schema** through the public Driver, scriptable Shell and Workbench; only presentation changes. All three must preserve warnings, completeness and error state.
8. Always release native sessions, statements, timers and streams on success, failure or cancellation. Return a separately coded failure (not a forged successful inventory) when connection or core identity discovery cannot complete.

## PostgreSQL 17 read-only discovery oracle

The first adapter must use static, reviewed PostgreSQL catalog queries rather than accepting caller-supplied SQL. Run the following under a least-privilege identity and a finite timeout; the Driver alone owns the query semantics.

```sql
SELECT current_database() AS current_database,
       current_user AS current_principal,
       current_setting('server_version') AS engine_version,
       current_setting('server_version_num')::integer AS server_version_number;

SELECT datname::text AS name
FROM pg_catalog.pg_database
WHERE datallowconn IS TRUE
  AND has_database_privilege(oid, 'CONNECT') IS TRUE
ORDER BY datname::text COLLATE "C"
LIMIT $1;
```

Bind `$1 = maxDatabases + 1`, validate the bound (1–1000), retain only the first `maxDatabases` returned rows and mark `capture.truncated=true` and `status=partial` if the extra row exists. Never interpolate an identifier, a free-form catalog filter or SQL from the profile alias. PostgreSQL lists database catalog entries separately from SQL `CONNECT` privileges, and host-based access may still deny a connection. See the official [PostgreSQL 17 catalogue](https://www.postgresql.org/docs/17/catalog-pg-database.html) and [privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html).

For local-only test exceptions, explicitly require a disposable loopback target. For network/TLS connections, the client must independently verify certificate chain and DNS hostname; `pg_stat_ssl` may corroborate TLS on the current backend but is **not** a substitute for client-side certificate verification. See [pg_stat_ssl](https://www.postgresql.org/docs/17/monitoring-stats.html) and [node-postgres SSL configuration](https://node-postgres.com/features/ssl).

A result envelope is `completed` only when all queried fields are collected for its permitted scope without truncation or omissions. Any warning communicating incomplete metadata makes `status=partial`. True authentication, TLS, timeout and discovery failures must throw a safe error object rather than returning a plausible but false inventory.

## Work-product semantics

The machine-readable response is scoped to the principal's observable catalog privileges, **not** an assertion that the entire DBMS installation has been inventoried.

- `schemaVersion`: fixed to `1.0.0`; schema changes require deliberate compatibility/version review.
- `operation`: fixed to `database.inspect`.
- `status`: `completed` or `partial`; `partial` is permitted only when missing/limited metadata is explicitly communicated.
- `target`: alias, `engineId`, engine version/version number, current database and native current principal. No host, full DSN or secrets.
- `transportSecurity`: `verified-tls` or `isolated-local`; neither value implies unqualified cloud vendor support.
- `capture`: ISO UTC timestamp, requested maximum, truncation flag, `observed-only` completeness, and fixed `connect-privilege-and-datallowconn` visibility rule.
- `capabilities`: only observed native capability decisions with `supported`, `unsupported`, or `unknown` state and provenance.
- `databases`: ordered permitted database names only; *no* misleading `accessible` flag. A database is included iff the catalog reports `datallowconn` and `has_database_privilege(oid, 'CONNECT')`. Actual network/HBA readiness is not asserted. Names lacking either predicate are **excluded**, even if `pg_database` itself exposes them.
- `warnings`: typed, redacted explanations of partial permission-limited results or unsupported optional metadata.

The [v1 JSON Schema](contracts/database-inventory-v1.schema.json), [safe error schema](contracts/database-operation-error-v1.schema.json), and [executable examples](contracts/examples/inventory-success.json) are **accepted G0 contract inputs**, not proof that any real database output already conforms. Treat inventory exports as potentially sensitive operational metadata with restricted file permissions and clear retention policies.

## Product surface acceptance

| Surface | Proposed contract | Must not do |
| --- | --- | --- |
| Driver | `inspectDatabase(profile, options): Promise<InventoryV1>` — accepted G0 API name | Import UI/Shell code or fabricate driver capabilities |
| Shell | `nublox shell inspect --profile NAME --format json --output PATH`; exit nonzero for failures | Store raw passwords in command history or implement native SQL discovery itself |
| Workbench | Choose secure connection profile → inspect → review capability/visibility notices → export inventory | Implement private native protocol, silently conceal incomplete discovery or auto-save secrets |

The API and CLI naming above are the accepted initial G0 interface; exported types, compatibility and release status still require G1–G5 evidence. Workbench must have keyboard navigation and accessible error/visibility explanations.

## Acceptance scenarios (must run on a real qualified engine)

| ID | Test | Expected result |
| --- | --- | --- |
| INV-01 | Known PostgreSQL fixture with read-only metadata rights | Real server version, effective principal and database identity match native source |
| INV-02 | Run same operation from Driver, Shell and Workbench | Equivalent canonical inventory data, status, ordering, capability states and warnings; no duplicated native adapter |
| INV-03 | Authenticate with an invalid or revoked secret | Explicit categorised failure, no captured secret and no leaked connection |
| INV-04 | Reject invalid certificate or remote connection without required verification | Connection refused; no unsafe fallback to cleartext or unverified TLS |
| INV-05 | Low-privilege principal when pg_database lists DBs without CONNECT | Exclude database names lacking CONNECT or datallowconn; prove no catalog-name disclosure; no elevation |
| INV-06 | Inventory limit lower than number of visible databases | Deterministic bounded output, `truncated=true` and `status=partial` |
| INV-07 | Unreachable target and timeout/cancel during discovery | Bounded failure, clean session disposal, no misleading success document |
| INV-08 | Unsupported adapter, PostgreSQL version or optional capability | Deterministic unsupported/unknown result; never claim a supported vendor because it is catalogued |
| INV-09 | Malicious profile alias, schema name or unexpected native field | Validate inputs; no statement injection, leaked stack secrets or uncontrolled JSON properties |
| INV-10 | All three output products exported to file | Contract-valid JSON, no passwords/tokens/DSNs, sensitive file metadata handled according to security policy |
| INV-11 | Repeated inspection without explicit authorisation changes | No target mutations; stable data apart from legitimate observation timestamp or live engine changes |
| INV-12 | Cloud vendor/managed service without its own qualification | No claim of cloud IAM, private endpoint or TLS certification from a local PostgreSQL pass |

Mocks may test API-level shape and fault injection but **cannot substitute for real-engine tests**. A release requires reproducible fixture scripts, conformance evidence, negative security cases, clean-install consumers and accessible Shell/Workbench acceptance.

## Exit gate

G0's implementation choices are now specified; the next gate (G1) must pin dependency lockfile, PostgreSQL 17 image digest, native discovery test fixtures, and make the strict Node/TypeScript build reproducible. G2 requires live fixture results and TLS negative tests; G3 requires successful real DBMS → public Driver → Shell + Workbench → identical inventory evidence. **The contract and live tests demonstrate only this bounded native Driver/Shell slice and a disposable certificate-verified TLS fixture; they do not qualify Workbench, managed-cloud or other remote infrastructure, channel binding, graceful cancellation or a production release.**
