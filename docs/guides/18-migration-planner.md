# Migration planner

NuBloxSQL migration planning converts a canonical schema diff into an ordered, safety-classified execution plan.

```js
const diff = sql.diffSchemas(before, after);
const plan = sql.planMigration(diff, { targetDialect: 'postgresql' });
```

## Planner output

Each plan contains:

- target dialect;
- transaction strategy;
- highest safety classification;
- automatic/manual step counts;
- ordered migration steps;
- per-step preconditions;
- generated SQL where NuBloxSQL can justify it;
- compensating rollback SQL where a safe structural inverse is available;
- explicit manual steps where automatic rendering would be guesswork.

## Execution modes

`automatic` means NuBloxSQL has enough semantic information to render the step for the selected target dialect.

`manual` means the planner intentionally refuses to invent SQL or data-migration behavior.

A plan is `executable: true` only when every step is automatic. This does not mean every automatic step is low risk: destructive and potentially-lossy steps remain explicitly classified.

## Transaction strategy

The planner currently returns one of:

- `transactional-preferred`
- `autocommit-boundary`
- `manual`

MySQL is conservatively marked `autocommit-boundary`. PostgreSQL, SQLite and SQL Server use `transactional-preferred` as a planning hint; callers must still obey engine/object-specific transactional semantics.

## Ordering

Planner phases currently order changes as follows:

1. drop foreign keys / constraints / indexes;
2. drop columns;
3. drop tables/views;
4. other removals;
5. modifications;
6. add tables/views;
7. add columns;
8. add indexes / constraints / foreign keys;
9. other additions.

This ensures dependencies are removed before their targets and relationship objects are added after their base objects.

## Preconditions

Examples include:

- verify no NULL values exist before tightening nullability;
- validate existing values before potentially-lossy type conversion;
- provide backfill/default strategy before adding a required column;
- review dependency edges before changing/removing dependent objects.

Required columns with no default/identity/generated value are deliberately emitted as manual steps even if a syntactic `ADD COLUMN` could be produced.

## Automatic rendering in v1

The first released planner can automatically render selected:

- column additions;
- column drops;
- PostgreSQL column type changes;
- SQL Server column type changes;
- PostgreSQL nullability changes;
- PostgreSQL default changes;
- simple index create/drop;
- foreign-key add/drop for non-SQLite targets;
- table drops.

More complex table creation, compound ALTER semantics, SQLite rebuild workflows, constraint definitions and advanced index features remain manual.

## Rollback

Rollback metadata is compensating SQL only where an obvious structural inverse exists. It is not a guarantee of data restoration. Destructive drops intentionally do not claim an automatic data-preserving rollback.

## Current boundary

The planner does not execute SQL. Execution, checkpoints, resumability, lock/timeout policy, data backfill orchestration and transactional recovery are separate future layers.
