# SQLite resource governance

NuBloxSQL exposes explicit, capability-detected controls for constraining SQLite workloads without pretending every supported Node.js line exposes the same native API.

## Capability report

`connection.resourceGovernanceCapabilities()` reports whether the active `node:sqlite` runtime exposes mutable SQLite runtime limits. Page-count controls, query-result budgets and the NuBloxSQL hardened profile are available independently.

Node.js exposes `database.limits` on newer runtimes. NuBloxSQL feature-detects that object rather than inspecting a Node version string. On runtimes without it, `setRuntimeLimit()` fails with the stable `NUBLOXSQL_UNSUPPORTED` contract.

## Native runtime limits

Where supported, `runtimeLimits()`, `setRuntimeLimit(name, value)` and `applyRuntimeLimits(limits)` cover SQLite limits for value length, SQL length, columns, expression depth, compound SELECT terms, VDBE operations, function arguments, attached databases, LIKE patterns, SQL variables and trigger depth.

The exported `SQLITE_LIMIT_KEYS` identifies the supported names. `Infinity` resets a mutable native limit to its compile-time maximum where the underlying Node API supports that behavior.

## Hardened profile

`applyHardenedProfile()` applies conservative native limits when the runtime supports mutable limits. It always returns the effective query-result budget and may also set an explicit database `max_page_count`.

The profile is intentionally not enabled automatically. Applications differ significantly in schema width, expression complexity, parameter counts and expected result size; silently imposing these values would be a compatibility risk.

## Query-result budgets

`queryBudget({ profile: 'hardened' })` returns the default hardened result budget:

- 10,000 rows
- 1 MiB per row
- 16 MiB total result materialization

`governedQuery()` applies those or caller-supplied budgets through the existing `SqliteResultLimitError` path. This controls JavaScript-side result materialization independently of SQLite's native parser/VM limits.

## Database growth

`pageCountLimit(value?, database?)` reads or sets SQLite `PRAGMA max_page_count` for a validated database namespace. It can be used with the current page size to place an explicit upper bound on database-file growth.

## Security posture

Resource governance complements, but does not replace, authorizer callbacks, defensive mode, extension-loading policy, query-only/read-only connections and application-level admission control. Untrusted SQL should combine these controls rather than relying on any single limit.
