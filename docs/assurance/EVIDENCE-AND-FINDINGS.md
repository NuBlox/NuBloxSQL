# Evidence provenance, findings and retest custody

**Status:** empty intake baseline; no independent assessment is recorded as completed.

## Evidence record — required minimum fields

Each independently reviewed result must have a private evidence record containing:

| Field | Purpose |
| --- | --- |
| Evidence ID / G1–G11 gate | Stable tracking identity and explicit acceptance condition |
| Test/workload and verdict | Pass, fail, inconclusive or not-tested; distinguish runner status from assessor verdict |
| Candidate commit SHA | Exact **40-character** revision for code tested |
| Candidate tarball SHA-256 | Exact archive bytes under test, verified against signed provenance when available |
| MySQL / Node / OS / architecture / TLS | Actual profile, not a proposed one |
| Immutable run and artifact reference | GitHub Actions run URL and artifact digest **or** reviewer-controlled immutable storage reference |
| Assessor name, employer, independence | Accountable person and engagement reference; stored privately |
| Date/time, method, limitations | Reproducible environment, workload, duration and explicit omissions |
| Finding IDs and disposition | Failures and residual risk linked to retest evidence |
| Review signature reference | Signed and dated external report or independently verifiable equivalent |

**Source code/test scripts, existing workflow files and passing CI jobs are *engineering preparation only*.** An external reviewer must independently reproduce, validate and approve evidence. Never invent a completed audit, run, signature or certificate.

## Initial evidence sources

- Source and API: [driver public API baseline](../DRIVER-PUBLIC-API-COMPATIBILITY.md), [package preflight](../RELEASE-CANDIDATE-PROVENANCE.md).
- Security: [threat model](../MYSQL-SECURITY-THREAT-MODEL.md), [security policy](../../SECURITY.md), [restricted MySQL principal workflow](../../.github/workflows/mysql-restricted-principal.yml).
- Reliability: [resilience qualification](../MYSQL-RESILIENCE-QUALIFICATION.md), [read soak workflow](../../.github/workflows/mysql-resilience.yml), [durable-write soak](../../.github/workflows/mysql-write-soak.yml), [TLS write soak](../../.github/workflows/mysql-write-soak-tls.yml).
- Compatibility: [current MySQL version qualification](../MYSQL-CURRENT-RELEASE-QUALIFICATION.md), [version workflow](../../.github/workflows/mysql-version-qualification.yml).
- Operations/legal: [operations runbook](../MYSQL-OPERATIONS-RUNBOOK.md), [blocked commercial decision](../release/mysql-commercial-decision.json) and root [proprietary licence](../../LICENSE).

**All of these are pointers, not evidence that an independent review took place.** For each actual run obtain its **specific** run ID, immutable source SHA, exact artifact(s), independent decision and archive digest. Scheduled/manual-only stages that are skipped on PRs must be recorded as skipped, **not** passed.

## Findings register (private — suggested columns)

Use a protected issue tracker or encrypted register, never a public GitHub issue. Define these columns before engagement:

`findingId,lot,gate,reportRef,sourceSha,affectedProfile,severity,descriptionRef,impact,owner,state,remediationCommit,retestReportRef,retestResult,reviewedBy,riskAcceptanceRef,openedAt,closedAt`

States: `new` → `triaged` → `fix-in-progress` → `ready-for-retest` → `retested-closed`; alternatively `risk-accepted` **only** when independent security/release approval evidence is captured. A rejected or unverified retest must remain open. Severity **Critical/High** requires immediate confidential escalation and control of disclosure.

## Retest and report requirements

1. Preserve the **original** report and its digest. Never overwrite a failed result when retesting.
2. Give the assessor a minimal reproducer and remediation commit. Agree whether the entire security/regression scope or only the affected test must be rerun.
3. Obtain a **separate dated retest report**, exact tested revision, observation and assessor signature. A developer's own green test is not an independent retest.
4. Aggregate findings by G1–G11 in the private release dossier. Redact proof-of-concept payloads, tokens, vulnerabilities and confidential personal information from any public summary.
5. Apply evidence retention, access and disposal obligations defined in the signed contract; do not leave raw customer traces or credentials in CI artifacts.

## Release gate rule

No gate becomes approved based on an editable Boolean or a Markdown checkbox. The authoritative [commercial decision](../release/mysql-commercial-decision.json) is intentionally fail-closed until an independently reviewed release-authorisation mechanism is implemented. The [intake JSON](external-assurance-intake.json) deliberately lists **no commissioned reviewers, no verified reports and no production permissions**.
