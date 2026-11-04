# Independent commercial release acceptance and sign-off checklist

**This is an UNAPPROVED template. No human signature has been collected.** Completion requires a reviewable, externally evidenced release decision by actual accountable people. The existing [decision manifest](../release/mysql-commercial-decision.json) still blocks customer evaluation, production and publication.

## Required first-release identity — blank until frozen

- Product/release identifier: `@nublox/driver`; **production version: NOT AUTHORISED**
- Source revision (40-char SHA): **UNSET**
- Released tarball SHA-256 and verified signing/provenance link: **UNSET**
- Proposed server/runtime/platform/transport: MySQL 8.4.13 / Node 22 / Linux x64 / verified TLS — **PROPOSED ONLY**
- Complete supported deployment matrix, named exclusions and lifecycle dates: **UNAPPROVED**
- Changelog, migration/version compatibility and rollback/retirement procedure: **UNAPPROVED**
- Customer evaluation/pilot licence and any production/customer-rights grant: **NOT GRANTED**

## G1–G11 gate acceptance

| Gate | Minimum signed-off evidence | Current decision |
| --- | --- | --- |
| G1 | Independent end-to-end integration on each claimed profile | **PENDING** |
| G2 | Native protocol/type/malformed-packet/prepared/cursor conformance and fuzz findings | **PENDING** |
| G3 | Independent source-assisted security report, high/critical retests, TLS/least-privilege sign-off | **PENDING** |
| G4 | Uncertain-write, cancellation/timeout, fault injection and no automatic replay evidence | **PENDING** |
| G5 | Independently reproducible competitor-neutral benchmark and restrictions on claims | **PENDING** |
| G6 | Completed multi-hour **and overnight** read/write soak, heap/RSS/progress trends, leak and cleanup assessment | **PENDING** |
| G7 | Public API/semver, consumer tarball, signed provenance and publication controls | **PENDING** |
| G8 | Version × Node × OS × arch × TLS/DBaaS matrix with explicitly excluded profiles | **PENDING** |
| G9 | Real security/support intake, on-call/incident, patch/disclosure/EOL and escalation owners | **PENDING** |
| G10 | Legal-approved pilot/production rights, IP, privacy role, warranties/liability and billing/redistribution | **PENDING** |
| G11 | Customer-representative failover, backup/restore, RTO/RPO, operational reconciliation and rollback | **PENDING** |

Gate completion **must** be backed by retained reviewer reports, tested SHA/digests, actual run URLs, findings, retest records and signed decisions. A script-produced green summary cannot approve G1–G11.

## Real decision signatories — not yet appointed

| Independent/human authority | Responsibility | Current status |
| --- | --- | --- |
| Product/release owner | Scope, business acceptance, residual risk, effective date and authorised distribution | **UNASSIGNED / NOT SIGNED** |
| Independent security lead | Threat model review, penetration test, high/critical retest and accepted residual risks | **UNASSIGNED / NOT SIGNED** |
| UK technology legal adviser | Software/IP ownership, customer licence, liability, data and commercial terms | **UNASSIGNED / NOT SIGNED** |
| Support/operations owner | Actual staffed support, incident process, patch commitments, backup/recovery and escalation | **UNASSIGNED / NOT SIGNED** |
| Independent MySQL technical reviewer | Protocol/function/HA/long-run acceptance for exact profile | **NOT COMMISSIONED / NOT SIGNED** |
| Independent performance reviewer | Reproducible workload and permissible claim language | **NOT COMMISSIONED / NOT SIGNED** |

## Release/no-release decision procedure

1. Confirm no unaddressed critical/high defects, every issue has signed final disposition, and residual risks are quantified.
2. Independently validate G1–G11 evidence for the **exact candidate**; if a supplied artifact, signature, review or supported version differs, block the gate.
3. Verify legal entity, IP ownership, confidential support/security contact, customer contract terms, insurance/commercial arrangements, rollback and support coverage.
4. Record a formal dated **NO-GO** or **GO** by the authorised owner; GO additionally requires all mandated independent approvals and an explicitly bounded supported profile.
5. Only after a genuine GO, implement a separately reviewed, cryptographically verifiable production authorisation/publishing workflow. Editing this template or the blocked preview manifest does not authorise anything.
6. Publish a customer-visible support matrix and product terms **before** onboarding or distributing a commercial release.

**Recorded outcome for this draft: NO-GO (not authorised).** This describes the existing release restriction; it is **not** a signed product-owner decision.

Use [issue #421](https://github.com/NuBlox/NuBloxSQL/issues/421) to track verified completion without guessing reviewer appointments, dates, prices or independent outcomes.
