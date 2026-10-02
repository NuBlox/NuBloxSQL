# TypeScript guide

NuBloxSQL publishes its TypeScript entry point through `types/root.d.ts`. The declarations discriminate clients by dialect and expose portable metadata, query diagnostics and the executable SQL capability ontology.

## Typed client creation

```ts
import { createClient, sql, type PostgreSqlClient } from 'nubloxsql';

const db = createClient({
  dialect: 'postgresql',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app'
});

// inferred as the PostgreSQL dialect client shape
const same: PostgreSqlClient = db;
```

Aliases are also reflected by the type mapping (`pg`/`postgres`, `mssql`/`sql-server`).

## URL inference

Literal connection URL types are declared for MySQL, PostgreSQL, SQL Server and SQLite:

```ts
const db = createClient('postgresql://app:secret@localhost:5432/app');
```

If a URL is only known as a broad `string`, TypeScript cannot use a literal URL scheme to discriminate the return type. Prefer a typed configuration object or a sufficiently narrow URL value when static dialect inference matters.

## Row typing

```ts
interface UserRow {
  id: number;
  name: string;
  email: string | null;
}

const rows = await db.all<UserRow>(sql`
  SELECT id, name, email FROM users
`);
```

This generic describes the row shape your code expects. It is compile-time typing, not runtime validation. Database schema changes still require tests/migrations and can invalidate the assumption.

## Result typing

```ts
const result = await db.query<UserRow>(sql`SELECT id, name, email FROM users`);
for (const row of result.rows) {
  console.log(row.name);
}
```

`ClientResult<Row>` also exposes portable result metadata and `native` engine evidence.

## Prepared statements

```ts
const find = await db.prepare(sql`
  SELECT id, name, email
  FROM users
  WHERE id = ${sql.parameter('id')}
`);

const user = await find.one<UserRow>({ id: 42 });
```

Named bindings are runtime-validated. Their object key names come from the `sql.parameter()` names in the prepared SQL fragment.

## Portable metadata types

The portable metadata declaration includes `PortableMetadataSnapshot`, `PortableTableMetadata`, `PortableColumnMetadata`, `PortableIndexMetadata`, `PortableForeignKeyMetadata` and `PortableConstraintMetadata`.

```ts
import type { PortableMetadataSnapshot } from 'nubloxsql';

const snapshot = await db.introspect({ deep: true });
const portable: PortableMetadataSnapshot<'postgresql'> = snapshot.portable;
```

The vocabulary version is typed as the literal `1`.

## Dialect-specific access

A dialect-specific client narrows `adapter`, `native`, `config` and transaction callback client types.

```ts
if (db.dialect === 'postgresql') {
  // Prefer creating/injecting an already discriminated PostgreSqlClient
  // when extensive native API access is required.
}
```

For strongly typed native feature modules, import their public types from the package declarations rather than casting `unknown` broadly.

## Capability model types

The package exports typed interfaces for capability features, comparisons, matrices, migration surfaces, runtime qualification, rewrite plans/results and the SELECT-foundation AST.

```ts
const decision = capabilityModel.rewriteDecision(
  'postgresql',
  'mysql',
  'statements.select'
);

if (decision.action === 'reject') {
  // compiler can narrow the action discriminant
}
```

## Capability ontology types

The ontology declaration adds typed capability definitions, engine observations, conditional availability, implementation coverage, resolutions and profiles.

```ts
import {
  capabilityOntology,
  type SqlCapabilityDefinition,
  type SqlCapabilityObservation,
  type SqlCapabilityImplementationCoverage
} from 'nubloxsql';

const definition: SqlCapabilityDefinition | null =
  capabilityOntology.definition('queries.cte.recursive');

const engine: SqlCapabilityObservation | null =
  capabilityOntology.observation('postgresql', 'queries.cte.recursive');

const compiler: SqlCapabilityImplementationCoverage | null =
  capabilityOntology.implementation('queries.cte.recursive');
```

Use the engine observation to describe database support and the implementation record to describe NuBlox parser/AST/validator/renderer/rewrite coverage. They intentionally do not collapse into one boolean.

## Strictness recommendation

Enable TypeScript strict mode in consumer projects. Treat `unknown` native payloads as a signal that your application must intentionally narrow engine-specific data. Avoid `any` casts that erase the dialect boundary NuBloxSQL declarations are designed to preserve.
