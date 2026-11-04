# NuBloxSQL — Self-funded assurance work plan

**Cost objective:** run practical technical qualification with existing open tools
and GitHub-hosted CI. **No paid supplier is required to execute these engineering
checks.** They cannot independently certify NuBloxSQL, provide a legal opinion,
or guarantee a vulnerability-free product.

**Status:** free engineering assurance plan, **not** commercial-release approval.
The first proposed profile remains MySQL **8.4.13**, Node.js **22**, Linux x64,
certificate-verified TLS. All G1–G11 and human sign-offs in [issue #421](https://github.com/NuBlox/NuBloxSQL/issues/421)
are still open. The [commercial-decision manifest](../release/mysql-commercial-decision.json)
continues to prohibit customer evaluation, production and package publication.

## Why we do not need to pay first

GitHub's [public-repository CodeQL service](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning)
supports TypeScript and JavaScript and [standard GitHub-hosted Actions minutes are
free for public repositories](https://github.com/pricing). This repository is
public **but proprietary**, not open-source-licensed; do not assume all
"free for OSS" products permit commercial proprietary use.

[CodeQL](../../.github/workflows/codeql.yml) scans the source on PRs, pushes
to main and weekly with the \`security-extended\` query suite. Its green job
means analysis completed and uploaded, **not** that there are zero findings.
Review and triage results in GitHub's **Security → Code scanning** interface;
record the run URL and alert disposition. Static analysis misses some
protocol, authentication, concurrency and business-logic vulnerabilities.

The repository already runs \`npm audit --audit-level=high\`, real MySQL
integration, least-privilege/TLS qualification, transaction/failover and fault
tests, sustained read/write qualification, candidate tarball checks and
attested build provenance. These create engineering evidence **at no new
specialist fees**, but do not replace human independent scrutiny.

## Local checks on a Mac

Use a clean checkout or preserve unrelated work before switching branches.
Node.js 22 or newer and \`npm\` are required.

\`\`\`bash
git status --short
git fetch --prune origin
git switch main
git pull --ff-only origin main
node --version
npm ci
npm audit --audit-level=high
npm run build
npm test
npm run assurance:verify
npm run release:verify
git log -1 --format='%H %ci %s'
\`\`\`

Without a live MySQL service, some native integration tests intentionally
**skip**. The CI \`docs\` workflow uses a real disposable MySQL service; use
its **specific commit/run logs** as evidence, not a locally green
skip-gated summary. The release verification is deliberately pre-commercial.

## Run real long-duration qualification in GitHub

Requires an authorised GitHub account and installed \`gh\` CLI; no paid
third-party auditor is needed for the execution. Commands must be started by
an authorised operator (a service restart/soak job consumes compute time).

\`\`\`bash
gh auth status
gh workflow run mysql-resilience.yml --repo NuBlox/NuBloxSQL --ref main -f hours=2
gh workflow run mysql-write-soak.yml --repo NuBlox/NuBloxSQL --ref main -f hours=2
gh workflow run mysql-write-soak-tls.yml --repo NuBlox/NuBloxSQL --ref main -f hours=2
gh run list --repo NuBlox/NuBloxSQL --branch main --limit 30
\`\`\`

Record **the exact returned workflow run IDs**. A workflow dispatch only
requests a test: do not report a run as complete until its workload **and**
same-run independent evidence validator have succeeded, with downloadable
artifacts, duration, SQL progress, persisted-write reconciliation, memory/RSS
and cleanup data. GitHub may impose concurrency, runner availability or
usage-policy limits. Its standard public Actions pricing does not guarantee
infinite capacity or third-party service fees.

Run the distinct **overnight** qualification on an owned or appropriately
provisioned host where the test duration is supported. Do not claim an
overnight run from the existing workflows' 1–2 hour manual options or
30-minute scheduled jobs. Preserve host resource and exact build/version
identities, and ensure tests only touch disposable data.

## No-cost gate-to-evidence route

| Gate | Engineering evidence we can produce | What this does not prove |
| --- | --- | --- |
| G1 | Real pinned MySQL conformance, Unicode, metadata, prepared/cursor and transaction tests | External conformance accreditation |
| G2 | Deterministic adverse packet corpus, fuzzing with reproducible crashes, resource/deadline bounds | Exhaustive protocol security |
| G3 | CodeQL, npm audit, TLS CA/hostname negatives, least-privilege account tests, threat-model review | Independent source review or professional certification |
| G4 | Repeated cancellation, partial-write, uncertain-commit, rollback and no-replay regressions | Every real deployment failure mode |
| G5 | Fixed-workload comparative runs with source, environment, SQL, raw results and uncertainty | Independent fairness/replicability until reviewed externally |
| G6 | Real multi-hour plus separately captured overnight sustained reads/writes, verified progress, memory and pool cleanup | A lifetime leak-free guarantee |
| G7 | Node consumer package API and actual tarball/provenance, SHA checks and install audit | Customer distribution permission |
| G8 | Explicit tested patch × Node × OS × architecture × TLS matrix and excluded combinations | Qualification of untested clouds/platforms |
| G9 | Set up and rehearse an actual confidential security inbox, triage, support and patch procedures | An available, staffed SLA unless actually provided |
| G10 | Gather company/IP/third-party dependency and proposed licence terms | Qualified legal opinion or legally enforceable approved customer terms |
| G11 | Fault-injection/fencing/restart, backup-and-restore rehearsal, RTO/RPO measurements and operator reconciliation | Customer deployment acceptance |

## Independent input without buying a consultancy

A qualified **voluntary** reviewer, reciprocal peer review or collaboration
may be genuinely independent of the author **if** competence, absence of
conflicts, written testing authorisation, confidentiality/IP terms and
repeatable signed findings are documented. No payment is inherently required
for independence, but qualified volunteers are not guaranteed and informal
endorsements are not certifications.

A conventional network penetration test should **not** be treated as the
primary product-specific verification for a native MySQL client. The
[UK NCSC guidance](https://www.ncsc.gov.uk/guidance/penetration-testing)
explicitly cautions that conventional pen testing is not appropriate for
product-specific testing. Prefer independent protocol/security source review
plus malicious-server fuzzing and fault simulation. Assess any deployed
customer-facing operational systems separately if required.

## Commercial decision and scope of any future pilot

There is **no general UK law requiring every software driver to buy a
penetration test or ISO 27001 certificate before a commercial sale**.
Applicable industry procurement terms, customer contracts, regulated markets,
privacy and actual deployment obligations may impose further requirements.
The project's current **stricter self-imposed G1–G11 policy** still requires
external evidence and sign-off. Reducing that bar requires an explicit
documented business/legal risk decision and reviewed policy change, **not**
quietly editing a JSON flag or claiming that self-testing is independent.

Do not publish, grant even a customer pilot licence or claim production
readiness under the present blocked decision. Use this no-cost programme to
generate objective evidence, identify residual gaps and minimise the scope
of any later paid review. An independent review can often be procured **only
for the unresolved risks**, not to repeat an entire internal test suite.

## Evidence integrity

Use the [external evidence custody rules](EVIDENCE-AND-FINDINGS.md) to link
run IDs, immutable source SHA, MySQL profile, digests, independent
reproduction outcomes and remediation references. Do not put exploitable
findings, confidential customer data, passwords, certificates or private
audit correspondence into a public repository or CI artifact.

**Current outcome: engineering evidence can be extended at no external
assessor cost; no commercial G1–G11 release authority has been obtained.**
