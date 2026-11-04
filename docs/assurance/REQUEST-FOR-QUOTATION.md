# NuBloxSQL external assurance — Request for quotation (RFQ)

**Status:** reusable procurement draft; **not yet issued to suppliers**. Complete the contracting legal entity, named sponsor, candidate SHA/digest, dates and budget approval privately before sending. Provide the NDA and safe test-access mechanism with the issued version.

## Background and required independence

NuBloxSQL is a **proprietary, first-party Node.js/TypeScript native MySQL Classic driver**, initially targeting the narrow [proposed profile](ASSESSMENT-SCOPE.md). It is an unpublished `0.1.0-dev.0` engineering preview and is **not production-approved**. We seek **independent third-party assessment**, not an endorsement of self-reported CI status.

We invite separately priced proposals for the following lots. A single bidder may respond to multiple lots but must disclose conflicts, reviewer independence and separation of test and final acceptance roles.

| Lot | Required supplier specialism | Scope / output |
| --- | --- | --- |
| **A — security** | Independent source-assisted security/protocol testing team | Threat-model challenge, malformed-server fuzzing, authentication/TLS review, privilege and injection boundaries, package/logging review; written report, risk ratings and separately priced retest |
| **B — database** | Independent MySQL Classic protocol and transactional-recovery expert | Clean-room protocol/type/transaction/pool/prepared/cursor conformance, failure injection, durability reconciliation, long-soak oversight and version matrix; reproducibility report |
| **C — benchmarking** | Independent performance engineer | Matched workload competitor comparison, controlled host/database configs, raw observations, confidence/variance analysis and defensible claim recommendations |
| **D — legal** | UK solicitor experienced in commercial software and technology IP | Ownership and third-party rights review, enforceable **pilot** and **production** customer licence terms, redistribution, warranties/liability, privacy roles and support/commercial terms |
| **E — operational readiness** | Independent experienced software operations/security assurance specialist | Exercise incident/vulnerability response, patch/retirement plan, support coverage, escalation, customer rollback and disaster-recovery readiness; signed gaps assessment |

**Optional organisational certifications** (separate quotes, not substitutes for Lots A–E): IASME [Cyber Essentials Plus](https://ce-knowledge-hub.iasme.co.uk/space/CEKH/4412801084), or UKAS-accredited ISO/IEC 27001 scope if customers require it. NCSC [CHECK](https://www.ncsc.gov.uk/schemes/check/information-for-buyers) is principally targeted at public sector / CNI; private commercial product testing need not automatically use CHECK.

## Required proposal response

Provide all of the following:

1. Registered entity, relevant experience with **MySQL Classic native client/protocol** and named reviewer credentials; independent previous projects and references.
2. Actual coverage against [scope](ASSESSMENT-SCOPE.md), [test inventory](INDEPENDENT-TEST-PLAN.md) and explicit exclusions. Detail threat-driven fuzzing method and transaction/failover fault-injection capability.
3. Fixed price **ex VAT**, any VAT, optional day rates, assumptions, tooling/cloud costs, and separately priced high/critical retests and follow-up days. No open-ended remediation work without prior written change approval.
4. Earliest availability and milestone schedule for kickoff, interim critical notification, draft findings, final report and retest. Time estimates are supplier commitments only after contract.
5. Evidence output formats; reproducible scripts, test logs/fixtures, SHA-referenced reports, confidentiality and IP treatment; reporting SLA for exploitable findings.
6. NDA and conflicts-of-interest statement, code/test data retention and deletion schedule, secure file-transfer method, written authorised testing boundaries and professional indemnity cover.
7. Assessor independence from NuBloxSQL development and independence of any final sign-off. State explicitly whether there is any formal **certification** or only an assessment report.
8. Constraints and dependencies, including whether reviewer can accept customer-neutral, disposable fixtures rather than live infrastructure.

## Supplier evaluation (before price award)

Suggested weighted scoring, with evidence retained privately: relevant methodology and scope coverage **35%**, assessor competence and independence **25%**, quality/reproducibility and retest terms **20%**, price transparency **10%**, schedule/availability **10%**. Reject proposals that imply a passing penetration test alone certifies a database driver, or request access to unapproved customer production environments.

## Process and acceptance

- Obtain **at least three** security proposals, **at least two** database-specialist proposals and a suitably scoped legal quotation where practicable. This is an RFQ target, not a claim that quotes have been received.
- No supplier is appointed without sponsor approval, contract, agreed pricing and written testing authorisation.
- Final milestone payment should require delivery of identified, reproducible findings and evidence under the agreed contract; avoid contracting for an automatic *pass*.
- All high/critical issues must have an agreed containment and independent retest or separately authorised residual-risk decision; report ownership and disclosure remain with the contracting entity.
- A green assessment does **not** automatically authorise customer evaluation or production. All G1–G11 and human release approvals are still governed by [commercial issue #421](https://github.com/NuBlox/NuBloxSQL/issues/421).

**Useful UK commissioning references:** NCSC [Penetration testing](https://www.ncsc.gov.uk/guidance/penetration-testing), NCSC [CHECK buyer guide](https://www.ncsc.gov.uk/schemes/check/information-for-buyers), IASME [find a certification body](https://iasme.co.uk/cyber-essentials/find-a-certification-body/), ICO [controller/processor contracts](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts/), and UKAS [CertCheck](https://www.ukas.com/certcheck/).
