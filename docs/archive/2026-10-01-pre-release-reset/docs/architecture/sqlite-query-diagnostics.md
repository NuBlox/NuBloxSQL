# SQLite query diagnostics

NuBloxSQL exposes structured SQLite planner diagnostics without executing the target statement.

## High-level plans

`connection.explainQueryPlan(sql, parameters?)` runs `EXPLAIN QUERY PLAN` and normalizes the returned rows into immutable plan nodes. The normalized surface preserves SQLite's native detail text while adding conservative classifications for scans, searches, index use, covering indexes, automatic indexes and temporary B-trees.

The summary includes node counts plus `usesIndex`, `usesCoveringIndex`, `usesAutomaticIndex`, `hasFullScan` and `usesTempBtree` flags.

Warnings are advisory only. A full scan or temporary B-tree can be entirely appropriate for a small table or workload. NuBloxSQL reports planner evidence; it does not claim that a particular plan is globally optimal.

SQLite documents `EXPLAIN QUERY PLAN` as a debugging interface whose textual output can change between SQLite versions. For that reason NuBloxSQL always preserves the native `detail` string and keeps its normalized classification deliberately small and additive.

## Full virtual-machine EXPLAIN

`connection.explain(sql, parameters?)` runs full `EXPLAIN` and returns immutable VDBE opcode rows with address, opcode, P1-P5, P4 and comment fields. It also reports the opcode count and unique opcode names.

The opcode surface is diagnostic evidence, not a portable execution-plan ABI. SQLite may change opcode behavior or output between releases.

## Combined diagnosis

`connection.diagnoseQuery(sql, parameters?, options?)` combines prepared-statement metadata and the high-level query plan. Pass `includeOpcodes: true` to include full opcode output.

The target statement itself is not executed by these helpers; only its EXPLAIN forms are stepped.

## Statement metadata and SQL privacy

`PreparedStatement.metadata()` returns output-column metadata, the active BigInt-read convention and capability flags for native source/expanded SQL support.

Statement SQL text is omitted by default:

- `includeSql: true` exposes `sourceSQL`.
- `includeExpandedSql: true` exposes `expandedSQL` when the prepared statement has already been executed with bound parameters.

Expanded SQL can contain bound values and therefore potentially sensitive data. NuBloxSQL never enables it implicitly.

## Planner warnings

The first contract recognizes:

- `full-table-scan` — a `SCAN` node with no explicit index in its detail.
- `temporary-btree` — SQLite reports a temporary B-tree, commonly for ORDER BY, GROUP BY or DISTINCT processing.
- `automatic-index` — SQLite reports an automatic index in the plan.

These warnings are deliberately factual. They are not automatic index recommendations and should be evaluated against table cardinality, selectivity, write overhead and the production workload.
