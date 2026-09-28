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

## Semantic conventions and NuBlox extensions

The adapter follows stable OpenTelemetry database semantic-convention names available without parsing SQL text:

- `db.system.name = mysql`
- `db.operation.name`
- `db.namespace` when `database` is configured
- `server.address` when `host` is configured
- `server.port` when `port` is configured
- `db.response.status_code` for MySQL numeric errors
- `error.type` for failed operations
- span kind `CLIENT`
- `db.client.operation.duration` histogram in seconds
- `db.client.operation.errors` counter
- `db.client.operation.retries` counter for transaction retries

NuBlox-specific low-cardinality attributes use the `nublox.mysql.*` namespace. Failed operations expose `nublox.mysql.error.category` as one of `cancelled`, `timeout`, `deadlock`, `lock_timeout`, `authentication`, `syntax`, `constraint`, `connection`, `protocol`, `database`, or `unknown`. The original driver/MySQL code remains available as `error.type`.

Transaction retry metrics also include `nublox.mysql.retry.attempt` and `nublox.mysql.retry.delay_ms`.

Span names use `<operation> <database>` when a database is configured, otherwise `<operation> <host>` or the operation alone.

## Prepared execute spans

Native prepared-statement execution publishes the same lifecycle surface with `db.operation.name = execute`. Instrumentation lives at the protocol `Execute` sequence boundary, so it automatically covers:

- connection `execute()`;
- pool `execute()`;
- Promise execute APIs;
- cached prepared statements;
- explicitly prepared/manual statements;
- internal safe reprepare attempts.

Each actual `COM_STMT_EXECUTE` attempt receives its own span and duration measurement. A stale prepared handle that triggers the existing one-shot safe reprepare therefore produces a failed execute span followed by the replacement execute span, making the recovery visible rather than hiding it.

SQL text remains subject to the adapter's existing `captureQueryText` policy and bind values are never published. Execute durations participate in `db.client.operation.duration` and the optional slow-query policy.

## Transaction spans

`withTransaction()` publishes one operation lifecycle around the complete transaction orchestration, including any configured deadlock or lock-wait retries. The OpenTelemetry adapter therefore creates one `transaction` client span rather than one span per retry attempt.

The transaction start diagnostic includes the physical connection thread ID together with bounded policy metadata (`readOnly`, isolation level and configured maximum retries). Completion diagnostics include the final attempt count. Final failures expose the original MySQL/driver error code and are classified by the same error policy used for query failures.

Transaction lifecycle messages intentionally do not provide `durationMs` to the slow-query policy. The OpenTelemetry span still measures wall-clock transaction duration naturally from start to end, while long transactions are not misreported as slow SQL statements.

## Pool connection telemetry

Pool telemetry is opt-in because it wraps the pool's public `getConnection()` boundary rather than adding OpenTelemetry to the core pool implementation:

```js
const pool = mysql.createPool({
  host: 'mysql.internal',
  port: 3306,
  database: 'orders'
});

telemetry.instrumentPool(pool);
```

Instrumented pools record:

- `db.client.connection.wait_time` — histogram in seconds from requesting a connection until it is obtained;
- `db.client.connection.use_time` — histogram in seconds from borrowing a connection until release or destruction;
- `db.client.connection.count` — UpDownCounter of open `idle` and `used` connections;
- `db.client.connection.pending_requests` — UpDownCounter of queued or establishing requests.

All pool metrics include `db.client.connection.pool.name`. By default NuBloxSQL derives `host:port/database`, or `host:port` when no database is known. A stable deployment-specific name can be supplied explicitly:

```js
telemetry.instrumentPool(pool, {name: 'orders-primary'});
```

Instrumentation is idempotent. `telemetry.uninstrumentPool(pool)` removes it. `telemetry.disable()` also restores instrumented pools and removes the adapter's current UpDownCounter contributions.

## Slow-query policy

Slow-query detection is disabled by default. Enable it with a threshold in milliseconds:

```js
const telemetry = createOpenTelemetryAdapter({
  slowQueryThresholdMs: 250
});
```

Operations at or above the threshold emit:

- a `db.client.slow_query` span event when the span implementation supports `addEvent()`;
- a `nublox.mysql.query.slow` diagnostics event containing operation, thread ID, duration and threshold.

The diagnostics payload does **not** include SQL text by default. Bind values are never included. Set the threshold to `0`, `false`, `null`, or omit it to disable slow-query detection.

## SQL text privacy

SQL text is **not recorded by default**. This avoids unintentionally exporting sensitive literals, comments or tenant information.

To opt in:

```js
const telemetry = createOpenTelemetryAdapter({
  captureQueryText: true
});
```

When enabled, SQL is emitted as `db.query.text`, and slow-query diagnostics may include the SQL statement as `sql`. Bind values are never emitted.

## Current coverage

The adapter consumes `nublox.mysql.query.start`, `nublox.mysql.query.end`, `nublox.mysql.query.error`, and `nublox.mysql.transaction.retry`, plus pool wait/use/state telemetry through `instrumentPool()`. Text queries, prepared execution and complete `withTransaction()` operations now use the common lifecycle surface.

Connection creation/timeouts and W3C trace-context propagation through MySQL query attributes remain separate M6 tranches. They will continue to build on the adapter rather than adding OpenTelemetry dependencies to protocol hot paths.

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
