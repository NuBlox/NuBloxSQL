# NuBloxSQL Technology Strategy

**Decision:** 10 October 2026  
**Status:** Adopted for new development; staged migration, not a rewrite.

## Platform choices

- **Primary runtime:** Node.js, with Node.js 24 LTS as the preferred development and deployment baseline. Continue running supported CI on Node.js 22, 24 and 26 while package.json declares `node >=22` and compatibility is qualified.
- **Primary source-language direction:** strict TypeScript for future core development and progressively migrated existing modules, while keeping the npm consumer contract usable from both JavaScript and TypeScript.
- **Current source baseline:** JavaScript/CommonJS plus maintained TypeScript declaration files. This remains supported; an unqualified mass conversion is prohibited.
- **SQL engines:** PostgreSQL, MySQL, SQLite and SQL Server, preserving native dialect semantics. Dialects and drivers remain independently qualified.
- **Presentation:** a separate Svelte/SvelteKit layer (including the NuBlox Shell as appropriate), not a dependency of the SQL runtime.
- **Persistence:** use explicit domain-specific stores. The existing SQLite JobStore is local, same-host coordination; a multi-host system will need a separately qualified transactional backend.

## Implementation rules

1. Preserve the existing single public npm entry point, CommonJS compatibility and declaration surface. Internal job components are not public APIs merely because they exist in `lib/`.
2. Introduce a reproducible, strict TypeScript compilation/typecheck pipeline **before** moving runtime files to `.ts`. Qualify generated JavaScript, declarations, supported Node versions, source maps and package contents in CI.
3. Migrate incrementally at stable module boundaries, prioritising new contracts and high-change components. JavaScript maintenance/integration slices may precede that pipeline; these are compatibility-preserving transitional changes rather than a reversal of the TypeScript direction.
4. Keep network I/O, parsing/compilation, lifecycle operations and the public developer API in Node.js unless evidence justifies another runtime.
5. Require bounded streaming, backpressure, memory limits, cancellation and instrumentation for bulk data movement. Avoid heavy CPU work on the event loop; benchmark worker threads, child processes or native extensions before introducing new languages.
6. Evaluate native or Rust acceleration only against measured workload, portability, safety and maintenance requirements; **do not rewrite** the platform speculatively.
7. Keep sensitive connection state out of persisted job plans/events. Require explicit approval and target-side fencing/reconciliation for mutating lifecycle operations.
8. Do not tie NuBloxSQL to downstream products or build a generic enterprise operating system inside the SQL package.

## Immediate implementation order

1. Complete safe, read-only domain job adapters and verification against existing NuBloxSQL capabilities.
2. Establish strict TypeScript toolchain and contractual checks without changing the published runtime surface.
3. Introduce explicit policy/approval evidence and qualified mutating lifecycle adapters.
4. Expand scheduling/workflows and distributed storage only after correctness and recovery requirements are testable.

This decision is subordinate to the [Product Blueprint](BLUEPRINT.md) for product scope and to [Database Jobs](../architecture/DATABASE-JOBS.md) for job semantics.
