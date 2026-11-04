# NuBloxSQL MySQL — External Assurance Pack

**Version:** 0.1 (procurement draft, 4 November 2026)  
**Classification:** reviewer briefing / preparation only  
**Release authority:** NONE — customer evaluation, production and package publication remain blocked.

This pack is the starting point for commissioning independent assessors. It is **not** a certificate, an approved release, a substitute for counsel, or permission for any organisation to test a third-party system. See the authoritative [commercial release register](../RELEASE.md), [decision manifest](../release/mysql-commercial-decision.json), and [release blocker #421](https://github.com/NuBlox/NuBloxSQL/issues/421).

## Documents

| Document | Purpose |
| --- | --- |
| [ASSESSMENT-SCOPE.md](ASSESSMENT-SCOPE.md) | Proposed product boundary, environment, safe access and exclusions |
| [INDEPENDENT-TEST-PLAN.md](INDEPENDENT-TEST-PLAN.md) | Repeatable independent engineering and security acceptance tests |
| [REQUEST-FOR-QUOTATION.md](REQUEST-FOR-QUOTATION.md) | Scope and evaluation criteria for assessor/legal proposals |
| [EVIDENCE-AND-FINDINGS.md](EVIDENCE-AND-FINDINGS.md) | Evidence requirements, non-public findings process and artifact custody |
| [RELEASE-ACCEPTANCE.md](RELEASE-ACCEPTANCE.md) | Actual human approvals and release/no-release decision criteria |
| [external-assurance-intake.json](external-assurance-intake.json) | Machine-checkable, **all-uncommissioned** intake baseline; not evidence of acceptance |

## Proposed assessment candidate — not frozen

- Product: NuBloxSQL native MySQL Classic client, `@nublox/driver@0.1.0-dev.0`, engineering preview.
- First proposed qualification profile: **MySQL 8.4.13**, **Node.js 22**, **Linux x64**, **verified TLS**.
- An immutable source commit and exact candidate tarball SHA-256 **must still be selected and recorded** before any assessment can be attributed to a release.
- Tests against other versions/transports or on Node 24 do not silently enlarge the authorised sales matrix.
- No Shell, Workbench, PostgreSQL, other vendors, cloud IAM, or production customer deployment is included in this first scope.

The above profile mirrors the existing blocked decision manifest and may be changed only through a reviewed scope/release change. It is **not** a promise that this profile is currently commercially supported.

## Recommended commissioning sequence

1. **Owner action:** appoint a named product/release owner and a confidential security and support escalation contact. Confirm the legal entity that will contract with reviewers.
2. Complete the [scope](ASSESSMENT-SCOPE.md) and freeze one immutable commit, package archive/digest and explicitly permitted test environments. Complete initial full-duration read, TLS-write and local-write endurance evidence; **configured or skipped jobs are not completed evidence**.
3. Send the [RFQ](REQUEST-FOR-QUOTATION.md) to a shortlist of independent security testers, MySQL experts, benchmarking specialists and a UK technology solicitor. Seek written conflicts-of-interest declarations, qualifications, relevant references and a defined remediation/retest price.
4. Agree NDA, IP/source access, scope, **written rules of engagement**, no-production-target restriction, reporting/confidentiality, data retention and secure delivery channel **before** granting access.
5. Give approved assessors the frozen artifacts, declared limitations, existing engineering reports and test harnesses. Do not share credentials, customer data, private keys or exploitable findings in this public repository.
6. Triage and remediate every finding in the private findings register. Commission independent retesting. Keep the original and retest reports, with immutable SHA-256 digests and assessor identities.
7. Have named product, independent security, legal and support/operations authorities explicitly sign their parts. Apply the [release acceptance criteria](RELEASE-ACCEPTANCE.md); only then consider a separate production authorisation mechanism.

## Certification versus assessment

A source-assisted penetration test and an independent driver engineering review are product-specific **assessments**; neither is, by itself, a government or ISO certification. **Cyber Essentials Plus** and **ISO/IEC 27001** address organisational security controls and may be procured separately to satisfy customer requirements. NCSC [penetration-testing guidance](https://www.ncsc.gov.uk/guidance/penetration-testing) covers how to commission qualified testers; [CHECK](https://www.ncsc.gov.uk/schemes/check/information-for-buyers) is especially relevant for public-sector/CNI work and is not generally required for private-sector penetration tests. IASME explains [Cyber Essentials Plus](https://ce-knowledge-hub.iasme.co.uk/space/CEKH/4412801084); UKAS [CertCheck](https://www.ukas.com/certcheck/) can verify accredited management-system certifications.

## Engineering integrity check

Run `npm run assurance:verify`. It confirms the review baseline has all G1–G11 mapped to real repository sources and is **not represented as externally commissioned, signed or authorised**. It does not validate actual independent reports. `npm run release:verify` also invokes this check. The blocked [commercial decision](../release/mysql-commercial-decision.json) is unchanged and remains authoritative.

**Do not enter actual security findings, reviewer contact information, signatures, customer credentials or contracts in this public pack.** Store these in access-controlled systems and link only redacted reference identifiers when approved for disclosure.
