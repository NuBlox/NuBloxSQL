# Canonical dialect registry

NuBloxSQL keeps four concepts separate:

```text
vendor
  -> DBMS product/profile
     -> DBMS version
        -> SQL dialect/profile
           -> dialect version/capabilities
              -> grammar / AST / compiler
```

A compatibility label is therefore metadata, not permission to route a connection through an existing adapter.

## Public API

```js
const sql = require('nubloxsql');

console.log(sql.DIALECT_REGISTRY_SCHEMA_VERSION);       // 1
console.log(sql.DIALECT_REGISTRY_MASTER_PROFILE_COUNT); // 100

const aurora = sql.dialectRegistry.product('aurora-postgresql');

console.log(aurora.vendor);          // Amazon
console.log(aurora.parentDialect);   // postgresql
console.log(aurora.primaryDialect);  // postgresql
console.log(aurora.driver.routable); // false
```

Registry membership does **not** expand the executable `DIALECTS` map. An entry remains non-routable until a driver/profile has its own implementation and qualification evidence.

## Registry layers

### Master profiles

The registry contains 100 source profiles covering the commercially and technically significant SQL systems captured by the project research. Vendor labels are normalized project metadata derived from the supplied product/platform names; they are not an independently verified legal-ownership register.

Each product/profile contains:

- `vendor`;
- `product`;
- `dialect`;
- `parentDialect`;
- `primaryDialect`;
- qualified `versions`;
- `driver` and routing state;
- `wireProtocol`;
- grammar compatibility metadata;
- language coverage for capabilities, data types, operators, functions, DDL, DML, DCL, TCL and procedural language.

### First-class dialect targets

The initial first-class set is:

```text
ansi
mysql
mariadb
postgresql
cockroachdb
yugabytedb
sqlserver
oracle
db2
sqlite
duckdb
firebird
snowflake
bigquery
redshift
teradata
spark
databricks
hive
trino
presto
clickhouse
hana
informix
sybase-ase
```

"First-class" is a target classification, not a claim that NuBloxSQL already has a driver/compiler for that dialect.

## Inheritance

Profiles can inherit or specialize a parent dialect without becoming aliases.

Examples:

```text
aurora-postgresql -> postgresql
timescaledb       -> postgresql
spanner-postgresql -> postgresql

aurora-mysql      -> mysql
tidb              -> mysql
memsql-legacy     -> singlestore -> mysql

azure-sql         -> sqlserver
fabric            -> sqlserver

oracle-plsql      -> oracle
oceanbase-oracle  -> oracle

bigquery-legacy   -> bigquery
athena            -> trino
```

Use:

```js
sql.dialectRegistry.ancestry('memsql-legacy');
// memsql-legacy -> singlestore -> mysql

sql.dialectRegistry.productsForDialect('postgresql', {
  includeDescendants: true
});
```

## Support honesty

The registry uses separate implementation fields:

- `routable`: NuBloxSQL can actually construct a connection for this exact identifier;
- `driver`: exact driver implementation status;
- `candidateAdapter`: a possible compatibility-family adapter, **not** a routing promise;
- `capabilityModel`: exact, partial, inherited-unverified or unmodelled;
- `compiler`: implementation state for structured SQL compilation.

For example, Aurora PostgreSQL can identify PostgreSQL as its compatibility family while remaining `routable: false`. This prevents product compatibility from being mistaken for NuBloxSQL qualification.

## Language surfaces

Every registry dialect has explicit coverage slots for:

```text
capabilities
dataTypes
operators
functions
ddl
dml
dcl
tcl
proceduralLanguage
```

Current Tier-1 capability models are marked `modelled`. SQL Server is `partial`. Compatible descendants of current runtimes are `inherited-unverified` until product-specific evidence exists. Other entries remain `unmodelled`.

This registry is the identity and inheritance layer. The existing capability ontology remains the detailed engine-capability evidence layer.

## Validation

```js
const validation = sql.dialectRegistry.validate();

if (!validation.valid) {
  throw new Error(validation.errors.join('\n'));
}
```

The release gate fixes the source master-profile count at 100 and the initial first-class target count at 25, validates every parent reference, checks surface vocabulary, and verifies that profile registration cannot silently make an unsupported dialect executable.
