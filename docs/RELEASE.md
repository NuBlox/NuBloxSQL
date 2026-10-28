# NuBloxSQL Driver — commercial release qualification

**Status: experimental / pre-commercial, 22 October 2026.**
A passing CI job or npm package does not grant commercial redistribution rights
or establish a production service-level commitment. This register is a
release-decision gate, not a marketing checklist.

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
to recover with a **different physical server connection ID**, with no
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

## Cross-version certificate-verified TLS qualification

The [native driver workflow](../.github/workflows/driver.yml) now has
independent Linux/Node.js 22 TLS jobs using the fixed Docker image tags
`mysql:8.0.44` and `mysql:8.4.11`. Each job creates a fresh, short-lived
CA and server certificate, requires encrypted transport on the server,
and runs the complete TLS integration suite: successful authenticated
connections with a negotiated cipher, rejected unknown CA, rejected
server identity, missing trust anchors, invalid credentials, pooled and
prepared operations, transactions, cursor lifecycle and transport failure
recovery. The qualification runner also records verified-TLS authentication
results and rejected-login evidence separately for each server version.

The fixture only accepts those two exact image tags; the CI checks
that the authenticated server version matches the selected image. The
existing `verified-tls-mysql` job name is preserved for the 8.4 branch
protection check, while `verified-tls-mysql-8.0.44` adds a second
independently required job on this revision. Per-version report artifacts
are produced only by completed CI jobs; consult the run and commit SHA
before asserting qualification. This does **not** establish cross-platform
TLS coverage, cloud/IAM authentication, certificate rotation,
client-certificate authentication or commercial readiness.

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
