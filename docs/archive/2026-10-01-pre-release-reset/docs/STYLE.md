# Documentation Standard

NuBloxSQL documentation must describe **one product with one developer entry point**.

## Canonical product statement

Use this design statement consistently:

> NuBloxSQL is a single-entry, multi-dialect SQL database integration platform. Developers install and import NuBloxSQL once; NuBloxSQL selects and manages the appropriate native dialect runtime underneath one coherent platform API.

Do not describe NuBloxSQL as a collection of separate products or imply that ordinary application developers are expected to install every dialect package independently.

## Product boundaries

- Public product: **NuBloxSQL** / `nubloxsql`.
- Public installation model: one package.
- Public import model: one entry point.
- Internal dialect workspaces: implementation and testing boundaries.
- SQL Core: shared internal contract vocabulary, not the primary developer entry point.

Do not discuss unrelated products in NuBloxSQL product documentation.

## Package README structure

Every package/workspace README must use this order:

1. **Role inside NuBloxSQL**
2. **Status**
3. **What it implements**
4. **How NuBloxSQL reaches it**
5. **Native semantics**
6. **Verification**
7. **Licence**

Each README must state that the normal developer installation path is `nubloxsql` and that the workspace exists to implement a dialect or shared contract inside the platform.

## Status vocabulary

Use only:

- **Stable** — supported in a qualified release baseline.
- **Development** — implemented but not yet in a stable support baseline.
- **Planned** — roadmap intent without a supported implementation.
- **Historical** — retained evidence for an earlier release or migration.

## Source of truth

- `README.md` — current public product and developer entry point.
- `docs/architecture/design-intent.md` — why NuBloxSQL exists.
- `docs/architecture/multi-dialect.md` — current platform architecture.
- `NUBLOX-SQL-ROADMAP.md` — development sequence.
- package READMEs — implementation-role details only.
- `docs/v1/` — stable v1 historical release evidence.

## Technical language

- Unify only semantics that are genuinely portable.
- Preserve native database behaviour where it differs.
- Prefer capability discovery over unsupported assumptions.
- Never claim silent emulation as compatibility.
- Preserve data fidelity, native diagnostics and native extension access.
- Distinguish public facade behaviour from internal adapter behaviour.
