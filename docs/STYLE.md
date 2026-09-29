# Documentation Style

NuBloxSQL documentation should be precise, current and non-duplicative.

## Naming

- Product: `NuBloxSQL`
- Packages: always use their published names, for example `@nublox/postgresql`
- Database families: `MySQL`, `PostgreSQL`, `SQLite`, `SQL Server`, `Oracle`
- Runtime: `Node.js`
- Licence spelling: `Licence` in prose; retain literal filenames such as `LICENSE`

## Status vocabulary

Use only these package-status terms:

- **Stable** — released and included in a supported release baseline.
- **Development** — implemented but not yet included in a stable support baseline.
- **Planned** — roadmap intent with no supported package claim.
- **Historical** — retained release or migration evidence that is not current planning.

Do not call a stable adapter a “foundation”. Use “foundation” only for an explicitly incomplete development slice.

## Version claims

Always distinguish:

- package version, such as `@nublox/postgresql@1.0.0`;
- SQL Core contract family, such as `1.0`;
- repository/release baseline, such as `NuBloxSQL v1.0.0`.

Do not imply that post-v1 development packages are part of the stable v1.0.0 support matrix.

## Source of truth

- `README.md` owns the current product/package status summary.
- `docs/architecture/multi-dialect.md` owns current architecture rules.
- `NUBLOX-SQL-ROADMAP.md` owns future development sequence.
- `docs/v1/V1-SUPPORT-MATRIX.md` owns the stable v1 qualification matrix.
- package READMEs own package usage and package-specific behaviour.
- `docs/v1/GATE-*-EVIDENCE.md` are immutable-style historical evidence except for factual corrections.

Prefer links over copying mutable tables into multiple documents.

## Package README structure

Package READMEs should use this order where applicable:

1. purpose;
2. status;
3. requirements/support;
4. capabilities;
5. quick start;
6. semantics or package-specific policy;
7. verification/dependency boundary;
8. related documentation;
9. licence.

## Technical language

- Describe capabilities as implemented driver behaviour, not merely server features.
- Separate portable contracts from adapter-native extensions.
- Do not claim semantic equivalence between catalogs, schemas, databases or transaction models where vendors differ.
- Do not claim cancellation, cursor or JSON capabilities unless the adapter actually implements the stated semantics.
- Prefer exact commands and supported-version lists over vague phrases such as “modern versions”.

## Historical documents

Historical RC notes and migration documents may reference superseded versions when the reference is necessary to explain history. Add context rather than rewriting history to look current.
