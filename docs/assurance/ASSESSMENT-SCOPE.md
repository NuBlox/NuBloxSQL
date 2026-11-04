# Proposed independent assessment scope

**Stage:** draft statement of work — subject to named product-owner approval and reviewer agreement. This is not a deployment permission or a frozen release.

## 1. Candidate identification

| Attribute | Proposed value / required action |
| --- | --- |
| Package | `@nublox/driver@0.1.0-dev.0` (unpublished engineering preview) |
| Vendor and protocol | Native MySQL Classic Protocol client |
| Server | MySQL 8.4.13 |
| Runtime | Node.js major 22 |
| Platform | Linux x64 |
| Network security | `verified-tls` with trusted CA and hostname checking |
| Source commit (40-char SHA) | **NOT YET FROZEN** |
| npm tarball SHA-256 | **NOT YET FROZEN** |
| Test fixture | Disposable isolated MySQL instance, synthetic datasets and accounts only |
| Licence/rights | No customer evaluation or production rights granted |

The tested profile must be captured by a full source commit, release candidate digest, signed provenance where applicable and matching CI run URLs. Any material code, MySQL patch, dependency, authentication or runtime change requires assessor impact review and potentially retesting.

## 2. Inside the first product review

- Public driver connection lifecycle, configuration validation, errors and capability disclosure.
- MySQL Classic packet framing, protocol 4.1 handshake, supported authentication plugins, TLS verification and malformed-server replies.
- Prepared statement binding, execution and cleanup, types and metadata, multiple results, bounded read-only cursor access.
- Transaction state, commit/rollback ambiguity, cancellation, deadlines, connection pooling, reconnect, reset and session/handle revocation.
- Resource caps for logical messages, rows, columns, parameters, pending waiters, active sockets, response buffers and operation deadlines.
- Public distribution package: actual `npm pack` contents, lockfile, runtime dependencies, prohibited install hooks, supported Node package API, provenance and error/credential redaction.
- Repeatable performance, read/write endurance, recovery and failure-injection behaviour on *specifically named* supported profiles.

Use [existing threat model](../MYSQL-SECURITY-THREAT-MODEL.md), [operations runbook](../MYSQL-OPERATIONS-RUNBOOK.md) and [release register](../RELEASE.md) as **internal claims to challenge**, not independent proof.

## 3. Out of scope unless separately contracted

- NuBloxSQL Shell, graphical Workbench, ORM, query builder, document/graph engines, other SQL vendors and multi-vendor universal claims.
- Application SQL quality, customer application security, customer production network assessment and customer data processing.
- Unlisted OS/CPU architectures, cloud DBaaS/IAM, Node versions, MySQL versions or transport modes.
- Product availability SLA, hosting service, organisational ISO/Cyber Essentials certification, tax assurance and legal approval, unless a separate workstream expressly covers them.
- Access to real customer systems, live credentials, secrets, customer databases or production DDL/DML.

## 4. Rules of engagement

- All tests require an **executed contract, NDA where appropriate, written explicit authorisation and approved target IP/hostname/ports**. No scanning or exploitation of production or third-party systems.
- Reviewer uses isolated disposable infrastructure; destructive tests and intentional restarts are limited to named disposable fixtures. Provide repeatable reset and data destruction instructions.
- Share proprietary source, logs and credentials via access-controlled channels with least privilege and agreed retention period; do not attach them to public issues or GitHub Actions artifacts.
- Findings must be reported confidentially, including reproducible minimal inputs, severity, affected SHA/profile, impact, and agreed remediation/retest procedure.
- A high/critical open security issue cannot be waived by the development team itself. Only the accountable independent security reviewer and release owner may document an explicitly approved disposition, subject to legal and customer risk terms.
- Any assessor-generated tool or exploit code must be handled under the signed rules of engagement and wiped/returned at contract end.

## 5. Evidence and success criteria

Reviewer reports must identify exact revision and package, environment, methods, limitations, expected versus observed behaviour, all defects, independent assessor identity/organisation and dated signature. A passing CI run alone is not independent acceptance. **No commercial profile is approved** until all G1–G11 gate evidence and owner/legal/security/support decisions are externally documented as required by [issue #421](https://github.com/NuBlox/NuBloxSQL/issues/421).
