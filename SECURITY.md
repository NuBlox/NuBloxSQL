# NuBloxSQL Security Policy — Engineering Preview

**Release status:** `@nublox/driver@0.1.0-dev.0` is experimental and is
**not approved for production deployment**. No generally supported commercial
release or security service-level agreement exists.

## Current assurance boundary

Native MySQL Classic protocol connectivity is exercised against pinned
MySQL 8.4.11 with verified TLS and explicitly isolated loopback tests.
Only the release matrix in [docs/RELEASE.md](docs/RELEASE.md) defines actual
qualification evidence. No other MySQL versions, cloud IAM deployments, or
other database vendors should be assumed supported.

The CI package preflight checks that the distributed tarball carries the
complete proprietary licence, documented JavaScript/TypeScript entrypoints,
no unintended tests, credentials, source fixtures or private files, and no
unreviewed third-party runtime dependencies or install scripts. Automated
dependency vulnerability audits and Node 22/24 package checks supplement
this; they do **not** replace threat modelling or penetration testing.

## Least-privilege MySQL database accounts

The [restricted-principal qualification](.github/workflows/mysql-restricted-principal.yml)
runs a disposable `nubloxsql_readonly` MySQL user with **SELECT-only**
database grants on three pinned current-release fixtures (8.4.13,
9.7.4 and 26.10.0). The two LTS fixtures also enforce **REQUIRE SSL**
at the server account level and client-side verified TLS.

Live tests cover successful bounded SELECT, prepared statements, cursor,
read-only transaction and pooled reset, rejection of UPDATE/DELETE/INSERT
and CREATE TABLE, and continued safe read access after a denied operation.
The TLS jobs additionally test rejection of plaintext connections and
incorrect credentials. Root is used exclusively by the ephemeral CI
fixture installer, **not** by the restricted client tests.

Passing these test profiles does not certify customer IAM, cloud service
accounts, credential lifecycle, or least-privilege application workflows.
The [threat model](docs/MYSQL-SECURITY-THREAT-MODEL.md) and
[operations runbook](docs/MYSQL-OPERATIONS-RUNBOOK.md) document controls,
residual risks and incident handling. Independent security assessment and
an accountable confidential reporting contact remain outstanding.

## Responsible security reporting

Please do **not** disclose suspected exploitable details in a public issue,
pull request, discussion or comment. Contact the project owner through an
agreed private channel, or use GitHub's **Report a vulnerability** facility
if private vulnerability reporting is enabled for this repository.
The owner must establish a published confidential reporting address and
response commitments **before** accepting commercial production customers.

Include the affected commit/package version, supported server and Node
versions, reproducible steps (with secrets removed), expected versus observed
behaviour, and an impact assessment. Never attach live credentials or private
certificates.

## Rules for operation

- Always verify TLS server identity and certificate chain for networked
  production-like tests; `isolated-local` allows only literal loopback
  addresses and is for isolated test deployments.
- Use a dedicated least-privilege database user instead of the root account.
  Root credentials used by pinned CI fixtures must never be deployed.
- Set operation timeouts, bounded pool capacity and maximum fetch sizes.
- Aborting an in-progress query or transaction destroys the session;
  ambiguous writes must not be replayed automatically.
- Protect downloaded release artifacts and verify their provenance before
  distribution. A passing release preflight is **not** a signed attestation.
- Obtain the owner's express written licence for evaluation or commercial use.
  Public visibility of source or npm tarballs conveys no additional licence.

## Version and disclosure lifecycle

The `0.1.0-dev.0` line has **no published support end date, SLA, or
commitment to security backports**. All such commitments remain gated in
`docs/RELEASE.md`. The release owner will assign severity, remediation and
disclosure schedules per report after review; no fixed response deadline is
promised by this experimental policy.
