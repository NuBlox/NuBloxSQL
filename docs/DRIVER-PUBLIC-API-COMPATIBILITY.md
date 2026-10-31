# NuBloxSQL — Driver public API compatibility contract

**Classification: engineering preview; not a production compatibility promise.**

## Protected surface

The published `@nublox/driver` package exposes one documented root import.
The reviewed [public API baseline](../tools/release/public-api-baseline.json)
lists its **21 explicit exports**, distinguishing runtime values from
TypeScript-only types and identifying the module each originates from.
Wildcard exports, default exports, alias changes, unexpected subpath
exports and silent preview-version changes are prohibited by
`tools/release/api-contract-core.mjs`.

A strict consumer fixture
(`tools/release/api-consumer.fixture.ts`) compiles against the
`dist/index.d.ts` type declarations under NodeNext on every package
preflight. It checks connection and pool factories, target security
configuration, bound value types, prepared statements, cursor,
transactions, cancellation, result rows, error codes and pool stats.
Negative compile-time checks ensure invalid engine/security options,
missing pool limits, arbitrary bound values and unreviewed runtime
exports remain rejected. This catches compatibility regressions that a
JavaScript runtime test alone cannot catch.

Run the complete checks with:

```bash
npm ci --no-audit --no-fund
npm run verify:api
npm run release:verify
npm test
```

`release:verify` also validates the **actual npm pack file inventory**,
licence contents, import boundaries, lifecycle scripts and dependencies.
The API checker writes `artifacts/release/public-api-contract.json` with
the reviewed baseline fingerprint, declaration SHA-256, commit SHA when
available, Node runtime and compatibility result. No source code, query
results, credentials, production targets or signing keys enter the report.

## Change control

1. Explain the proposed API change and its consumer impact in a PR.
2. Decide whether it is additive, source-breaking, binary/runtime-breaking,
   or requires an explicit published version change. Never silently
   update the baseline merely to make a failing check pass.
3. Update source exports, the locked baseline, strict TypeScript consumer
   fixture, release notes and package version together when required.
4. Run the independently installed npm tarball test and both Node 22/24
   package-security jobs, review the before/after public API diff, then
   obtain product-owner approval.
5. Preserve the CI job/run URL and redacted API/package evidence with the
   release decision. Do not claim cross-version semantic compatibility
   without qualifying an **already published** prior version.

This is a preview compatibility-change detection mechanism, not
an ABI guarantee or automated semver decision. TypeScript structural
assignability does not capture every behavioural contract, error detail,
concurrency invariant or SQL result-shape change. A future stable
release must add consumer compatibility testing against at least one
independently preserved previous release, an explicit deprecation policy
and a versioned support/maintenance commitment.

## Remaining owner/external requirements

A commercial production release additionally requires independent security
assessment, documented support operations and staffed confidential
vulnerability reporting, approved commercial/customer licence terms,
reproducible signed distribution provenance, verified customer deployment
profiles and explicit risk acceptance. Passing this gate is **not**
legal, security, SLA or general commercial approval.
