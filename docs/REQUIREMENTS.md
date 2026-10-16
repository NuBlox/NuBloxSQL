# Traceable product requirements

**Status:** Candidate requirements, not implementation commitments. Every requirement needs ownership, risk analysis, design decision, acceptance evidence and test references before development.

**Priority:** P0 = necessary to validate the foundation; P1 = first complete professional workflow; P2 = later extension. “Accepted” means demonstrated, not merely coded.

| ID | Priority | Requirement | Observable acceptance evidence |
| --- | --- | --- | --- |
| PRD-001 | P0 | Separate, independently installable Driver, Shell and Workbench | Three separate release artefacts, API-only dependency checks |
| PRD-002 | P0 | Native database adapter contract independent of SQL | Adapter manifest + executable native-model tests |
| PRD-003 | P0 | Explicit vendor/version/model/protocol/deployment/capability identity | Machine-readable verified support matrix |
| PRD-004 | P0 | No executable-support claims from reference catalogue records | Unsupported engine attempts fail deterministically |
| PRD-005 | P0 | Authentication, TLS and credential handling with no secret logging | Negative security tests and documented threat model |
| PRD-006 | P0 | Connection open/close/pool lifecycle with deterministic cleanup | Real-engine connect/teardown and failure tests |
| PRD-007 | P0 | Parameter binding and native operation semantics, including cancellation | Live conformance and injection/error tests |
| PRD-008 | P0 | Structured errors, timeouts, bounded results and observability | Reproducible failure, timeout and resource tests |
| PRD-009 | P0 | Clear compatibility and unsupported-feature signalling | Capability-gated tests with failure evidence |
| PRD-010 | P0 | Reproducible builds and usable public JS/TS developer contracts | Clean-install consumer tests across supported Node versions |
| PRD-011 | P1 | Reliable server discovery and database metadata | Real-engine identity and schema inventory |
| PRD-012 | P1 | Functional Shell workflow via public Driver API | End-to-end documented `connect → inspect → export` |
| PRD-013 | P1 | Functional Workbench workflow via public Driver API | End-to-end `connect → browse → inspect`, no Shell imports |
| PRD-014 | P1 | Native data/query operations with sensible transaction semantics | Commit/rollback and typed result tests where supported |
| PRD-015 | P1 | Proven connection to one real managed-cloud offering | End-to-end auth/TLS/network qualification and credential expiry |
| PRD-016 | P1 | Durable job evidence for long-running operations | Recovery, cancellation, idempotency and audit acceptance tests |
| PRD-017 | P1 | Native database security and privileged operation boundaries | Privilege matrix and refusal/approval tests |
| PRD-018 | P1 | Native backup/recovery as an evidence-backed task | Verified restore on a disposable target |
| PRD-019 | P2 | Engine installation and retirement with provider boundaries | Disposable host/container qualified lifecycle, recovery evidence |
| PRD-020 | P2 | Schema diff, migration, rollback and impact analysis | Versioned cross-engine plan/test outcomes |
| PRD-021 | P2 | Non-SQL document/key-value/graph model expansion | Separate model-native adapters and live protocol tests |
| PRD-022 | P2 | Wider relational SQL vendor coverage | New vendor/version live qualification, not a catalogue count |
| PRD-023 | P2 | Full task/work-product coverage of the eleven phases | Prioritised task acceptance register with evidence links |
| PRD-024 | P2 | Securely administered cloud connectivity variants | Per-provider IAM/Entra/rotating-token/private-endpoint qualification |

## Quality constraints

- **Backward compatibility:** explicit versioned public API; breaking changes require a separate decision, migration path and major release.
- **Safety:** destructive operations require privilege enforcement, preview/plan and environment-specific recovery; a UI “read-only” switch is not sufficient.
- **Privacy:** never persist database passwords, raw secrets or credentials inside job plans, diagnostics, client-side browser state or logs.
- **Correctness:** tests must exercise real engines/protocols; mocked contracts alone are not qualification.
- **Isolation:** no vendor protocol logic in Shell or Workbench; no tool import into the Driver.
- **Determinism:** pinned dependencies, reproducible builds, bounded resource use and controlled concurrency.
- **Accessibility and usability:** CLI help, structured output, keyboard-accessible Workbench and explicit operation risk.

## Requirements management

Propose requirements only in this document; give stable IDs, classify native model/engine applicability, and link them to lifecycle tasks and tests. Do not create parallel registers to boost apparent coverage. The specification exit gate is defined in [ROADMAP.md](ROADMAP.md).
