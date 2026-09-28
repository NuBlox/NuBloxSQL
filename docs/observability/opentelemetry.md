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

This first M6 adapter consumes the existing `nublox.mysql.query.start`, `nublox.mysql.query.end`, and `nublox.mysql.query.error` diagnostics channels. It therefore traces the Promise text-query surface that currently emits those lifecycle events.

Prepared execution, pool wait-time telemetry, transaction spans and richer error classification are separate M6 tranches and will build on the same adapter rather than adding instrumentation to the protocol hot path.

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
