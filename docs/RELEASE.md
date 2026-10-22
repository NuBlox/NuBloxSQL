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
| G3. Secure authentication and transport | Negative CA, hostname, credentials, loopback-only plaintext checks | **Partial**; formal threat model, dependency and secret review, least-privilege server users |
| G4. Cancellation and transaction safety | Abort/deadline, session reset, pooled/cursor resource-ownership tests | **Partial**; failure injection during writes and ambiguous commit, severe outages |
| G5. Reproducible performance | Workload scripts, latency/memory diagnostics and machine-readable evidence | **In progress**; quantitative baseline, competitor parity and stable hardware |
| G6. Sustained stability | Timed pooled soak and reconnect workloads in CI | **In progress**; overnight/multi-day tests, heap profiles, database restarts and chaos matrix |
| G7. Public API and package stability | Strict TypeScript, independent package-consumer tarball tests | **Partial**; versioning guarantees, semantic compatibility tests, Node LTS matrix |
| G8. Version/deployment matrix | MySQL 8.4.11 local/TLS pinned qualification | **Not met**; qualify other MySQL versions, OS/architectures, TLS deployments |
| G9. Support operations | No published response-time or escalation commitment | **Not met**; support contact, release policy, CVE/security process, change logs |
| G10. Commercial licence and delivery | Proprietary ownership stated in LICENSE | **Not met**; legal review and explicit customer evaluation/production terms, billing, invoicing and redistribution |
| G11. Disaster/recovery | Fail-closed session, pool and cursor invalidation | **Not met**; documented restore/failover operating guidance and sustained fault testing |

Statuses must be changed only after linking independent evidence.
No arbitrary throughput, latency or uptime claim is authorised by a green PR.

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
