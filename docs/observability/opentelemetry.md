# OpenTelemetry integration

`@nublox/mysql/otel` adapts NuBloxSQL's zero-dependency `diagnostics_channel` events to OpenTelemetry without adding OpenTelemetry to the driver's runtime dependency graph.

## Installation

Install the OpenTelemetry API in the consuming application:

```bash
npm install @opentelemetry/api
```

The adapter loads `@opentelemetry/api` lazily when enabled. Applications that manage their own OpenTelemetry API instance can instead pass it with the `api` option.

## Enable tracing and metrics

```js
const createOpenTelemetryAdapter = require('@nublox/mysql/otel');

const telemetry = createOpenTelemetryAdapter({
  database: 'orders',
  host: 'mysql.internal',
  port: 3306
});

telemetry.enable();
```

Disable it during application shutdown when explicit teardown is useful:

```js
telemetry.disable();
```

The adapter is idempotent: repeated `enable()` or `disable()` calls do not create duplicate subscriptions.

## Semantic conventions

The adapter follows the stable OpenTelemetry database semantic-convention names available to NuBloxSQL without parsing SQL text:

- `db.system.name = mysql`
- `db.operation.name`
- `db.namespace` when `database` is configured
- `server.address` when `host` is configured
- `server.port` when `port` is configured
- `db.response.status_code` for MySQL numeric errors
- `error.type` for failed operations
- span kind `CLIENT`
- `db.client.operation.duration` histogram in seconds

Span names use `<operation> <database>` when a database is configured, otherwise `<operation> <host>` or the operation alone.

## Pool connection timing

Pool timing is opt-in because it wraps the pool's public `getConnection()` boundary rather than adding instrumentation to the core pool implementation:

```js
const pool = mysql.createPool({
  host: 'mysql.internal',
  port: 3306,
  database: 'orders'
});

telemetry.instrumentPool(pool);
```

Instrumented pools record two OpenTelemetry histograms in seconds:

- `db.client.connection.wait_time` — time from requesting a connection until it is obtained;
- `db.client.connection.use_time` — time from borrowing that connection until `release()` returns it to the pool. Destruction of a borrowed connection also closes the observed lease.

Both metrics include `db.client.connection.pool.name`. By default NuBloxSQL derives the name as:

```text
host:port/database
```

or `host:port` when no database is known. A stable deployment-specific name can be supplied explicitly:

```js
telemetry.instrumentPool(pool, {name: 'orders-primary'});
```

Instrumentation is idempotent. Remove it explicitly with:

```js
telemetry.uninstrumentPool(pool);
```

Calling `telemetry.disable()` also restores all instrumented pools and any currently borrowed connection methods without recording a partial use-time sample.

OpenTelemetry currently classifies connection-pool metrics as development-stability conventions, so NuBloxSQL keeps this surface isolated in the adapter and does not make it part of the core pool API.

## SQL text privacy

SQL text is **not recorded by default**. This avoids unintentionally exporting sensitive literals, comments or tenant information.

To opt in:

```js
const telemetry = createOpenTelemetryAdapter({
  captureQueryText: true
});
```

When enabled, SQL is emitted as `db.query.text`. Bind values are never emitted by this adapter.

## Current coverage

The adapter consumes `nublox.mysql.query.start`, `nublox.mysql.query.end`, and `nublox.mysql.query.error` for query tracing, plus pool wait/use timing through `instrumentPool()`.

Prepared execution, transaction spans, pool state gauges and richer error classification are separate M6 tranches and will build on the same adapter rather than adding instrumentation to the protocol hot path.

## Custom tracer and meter

Applications can inject already configured OpenTelemetry instruments:

```js
const telemetry = createOpenTelemetryAdapter({
  tracer: myTracer,
  meter: myMeter,
  api: require('@opentelemetry/api')
});
```

`api` remains necessary when a custom tracer is supplied because the adapter uses OpenTelemetry span-kind, status and active-context APIs.
