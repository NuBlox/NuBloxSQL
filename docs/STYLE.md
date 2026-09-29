# NuBloxSQL Documentation Standard

NuBloxSQL documentation must describe **one platform consistently** while preserving the different technical roles of its packages.

## Canonical product language

Use these terms consistently:

- **NuBloxSQL** — the overall database connectivity/runtime platform.
- **SQL Core** / `@nublox/sql-core` — the portable platform contract layer.
- **adapter** or **runtime** — a database-family implementation such as MySQL, PostgreSQL or SQLite.
- **consumer** — a product/application that uses NuBloxSQL, for example NuBlox SQL Workbench.
- **native extension** — an adapter-specific capability that deliberately sits outside the portable contract.

Do not describe the repository as merely a collection of independent drivers.

## Design statement

Every current document should be compatible with this sentence:

> NuBloxSQL is one platform: SQL Core defines proven portable contracts, native adapters own real database semantics, and consumers depend on NuBloxSQL rather than owning database transports themselves.

If a document contradicts that sentence, the document is wrong or historical context must be stated explicitly.

## Package README contract

Every package README uses this order:

1. one-sentence package identity;
2. **Role in NuBloxSQL**;
3. **Status** table;
4. **Platform contract**;
5. **Native capabilities** (or **Platform contract surface** for SQL Core);
6. **Quick start**;
7. **Native semantics** / evolution policy;
8. **Verification and dependency boundary**;
9. **Related documentation**;
10. **Licence**.

The headings are intentionally uniform. The content is not forced to be identical because the package roles differ.

## Status vocabulary

Use only:

- **Stable** — supported and included in a stable release baseline.
- **Development** — implemented but not yet part of a stable support baseline.
- **Planned** — intended future work with no implemented support claim.
- **Historical** — retained release/migration evidence that is no longer current product guidance.

## Version vocabulary

Always distinguish:

- NuBloxSQL release baseline, e.g. `v1.0.0`;
- package version, e.g. `@nublox/postgresql@1.0.0`;
- SQL Core contract family, e.g. `1.0`;
- database/runtime qualification, e.g. PostgreSQL 15–18.

## Source-of-truth ownership

| Subject | Authoritative document |
| --- | --- |
| Product intent | `docs/architecture/design-intent.md` |
| Current platform/package status | `README.md` |
| Technical architecture | `docs/architecture/multi-dialect.md` |
| Forward engineering sequence | `NUBLOX-SQL-ROADMAP.md` |
| Package API/capabilities | package README + code/types/tests |
| Stable v1 support matrix | `docs/v1/V1-SUPPORT-MATRIX.md` |
| Stable SQL Core v1 contract | `docs/v1/SQL-CORE-V1-CONTRACT.md` |
| Historical v1 release evidence | `docs/v1/` |

Do not create competing current-state documents.

## Technical rules

Documentation must:

- distinguish platform contracts from native adapter semantics;
- describe capability flags as implemented NuBloxSQL behaviour, not theoretical server features;
- preserve catalog/database/schema distinctions;
- state when a behaviour is adapter-native;
- avoid claiming unsupported equivalence, emulation or cancellation semantics;
- favour data fidelity over convenient but lossy descriptions;
- identify supported versions precisely;
- link to the authoritative source instead of duplicating mutable matrices unnecessarily.

## Historical documents

Historical RC notes, migration guides and release-gate evidence should not be rewritten to appear current. Add framing when necessary, but preserve the historical record.

## Naming

- `NuBloxSQL`
- `NuBlox SQL Workbench`
- `Node.js`
- `MySQL`
- `PostgreSQL`
- `SQLite`
- `SQL Server`
- `Oracle`
- use `Licence` in prose and preserve literal filenames such as `LICENSE`.
