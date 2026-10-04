# Competitive Capability Benchmark

## Purpose

NuBloxSQL is developed as an independent database platform. External products are used only as capability benchmarks.

Database Tour is currently a useful benchmark because it combines multi-database connectivity with object browsing, table/data work, SQL editing, data export/import, command-line automation, DDL generation and reporting.

The objective is not to reproduce Database Tour's implementation or user interface. The objective is to ensure NuBloxSQL eventually provides a stronger technical foundation across the same broad capability classes, with deeper database semantics, explicit portability analysis and automation-first APIs.

## Verified Database Tour capability classes

The following capabilities were verified from Database Tour's public documentation on 4 October 2026.

| Capability class | Database Tour evidence | NuBloxSQL target |
| --- | --- | --- |
| Database object browser | Object Browser groups database objects and supports multi-selection, opening, DDL generation, deletion/duplication and structure-tree generation | Canonical object catalog with native evidence, stable IDs/paths, dependency relationships and API-first traversal |
| Structure tree | Database → tables/schema/columns structure tree with export options | Canonical immutable structure tree spanning database/schema/table/view/columns/indexes/constraints/relationships |
| Table structure editing | Columns, indexes, constraints, foreign keys and partitions can be inspected and edited for supported engines | Safety-classified schema edit plan backed by canonical metadata, DDL AST and capability model |
| SQL editor | Syntax highlighting, templates, dialect selection, query windows and history | Parser-backed formatting, linting, diagnostics, completion primitives, capability/version warnings and execution |
| Data browsing/editing | Table/query result grids, data editing, filtering, BLOB handling | Typed streaming data API, editable result model, validation and mutation planning |
| Import/export | Dataset, clipboard and multi-table export; database-to-database movement and many file formats | Resumable data-movement pipeline with mappings, conversions, validation, batching, checkpoints, error policy and telemetry |
| SQL/DDL generation | Object DDL and data SQL generation | Structured AST-backed generation with semantic validation and portability classification |
| Command-line automation | Query execution, table opening, export/import, action files and logging | First-class programmatic/CLI job model with deterministic plans, logs and resumability |
| Reporting | Visual report builder, grouping, functions, templates, preview/export | Data/report definition layer separated from database execution, with export-oriented rendering contracts |
| Structure export/diagram input | DBML export for supported relational structures | Canonical structure export including DBML-compatible projection and richer dependency graph formats |

## Benchmark principles

NuBloxSQL should exceed the benchmark through architecture rather than feature count alone:

1. **Canonical metadata rather than UI-only discovery.**
2. **Explicit dialect/version capability semantics.**
3. **Fail-closed portability decisions.**
4. **Structured schema diff and migration safety analysis.**
5. **Reusable data-movement engine rather than format-specific wizards.**
6. **Parser/AST-backed SQL tooling rather than text-only editing helpers.**
7. **Automation-first APIs with UI-independent contracts.**
8. **Native evidence retained alongside portable projections.**
9. **Release qualification against real database engines.**
10. **One coherent public package surface.**

## Competitive capability programme

The programme is divided into capability platforms, not UI screens.

### A. Database exploration and structure intelligence

- canonical object hierarchy;
- structure tree;
- object descriptions/comments;
- dependency graph;
- DDL representation;
- structure export;
- object search/filtering.

### B. Schema engineering

- canonical type semantics;
- schema snapshot;
- schema diff;
- migration planning;
- safety classification;
- generated DDL;
- dependency ordering;
- rollback/manual-action boundaries.

### C. Data work

- result browsing contracts;
- typed edit/mutation model;
- bulk copy;
- import/export;
- database-to-database transfer;
- field mapping;
- conversion and validation;
- checkpoints/retries;
- rejected-row handling.

### D. SQL tooling

- dialect-aware parsing;
- formatting;
- linting;
- syntax/semantic diagnostics;
- completion primitives;
- execution history model;
- templates/snippets;
- capability/version warnings;
- explain-plan integration.

### E. Automation

- reusable job definitions;
- CLI execution;
- structured logs;
- scheduling-compatible plans;
- resumability;
- idempotence controls;
- credentials/secrets boundaries.

### F. Reporting and export

- dataset/report definitions;
- grouping/aggregation;
- reusable templates;
- common document/data export formats;
- print/export rendering boundaries.

## Current first implementation slice

The first delivered slice is **database structure intelligence**.

NuBloxSQL now builds a canonical structure tree from its portable metadata vocabulary:

```text
database
  └─ schema
      ├─ table
      │   ├─ column
      │   ├─ index
      │   ├─ foreign-key
      │   └─ constraint
      ├─ view
      └─ foreign-table
```

This is deliberately implemented as a public object model rather than a UI feature. It can therefore support future explorers, structure exports, diagrams, comparisons, migrations and automation without coupling NuBloxSQL to any particular interface.

## Sources used for benchmark verification

- https://databasetour.net/documentation/database-objects.htm
- https://databasetour.net/documentation/database-structure-tree.htm
- https://databasetour.net/documentation/viewing-editing-table-structure.htm
- https://databasetour.net/documentation/sql-editor.htm
- https://databasetour.net/documentation/working-with-table-and-query-data.htm
- https://databasetour.net/documentation/export.htm
- https://databasetour.net/documentation/export-format-database.htm
- https://databasetour.net/documentation/command-line-usage-export-import-data.htm
- https://databasetour.net/documentation/reports-overview.htm
- https://databasetour.net/documentation/exporting-structure-to-dbml.htm
