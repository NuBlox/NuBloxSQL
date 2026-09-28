# Pool acquisition circuit breaker

NuBloxSQL can fail fast when repeated connection-acquisition failures indicate that a MySQL backend is unavailable or unhealthy.

The circuit breaker is **disabled by default** so existing mysql/mysql2-compatible pool behaviour is unchanged unless explicitly enabled.

```js
const mysql = require('@nublox/mysql');

const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'app',
  database: 'app',
  connectionLimit: 20,

  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 5000,
  circuitBreakerHalfOpenMaxAttempts: 1
});
```

## State model

The breaker uses three states:

- `closed`: acquisitions proceed normally;
- `open`: new acquisitions fail fast with `POOL_CIRCUIT_OPEN`;
- `half-open`: after the cooldown, a bounded number of probe acquisitions are permitted.

A successful acquisition resets the consecutive failure count and closes the breaker. A failed half-open probe immediately reopens it and restarts the cooldown.

Only backend/acquisition failures count toward the breaker. Pool-control outcomes such as `POOL_CONNLIMIT`, `POOL_ENQUEUELIMIT`, `POOL_CLOSED`, caller cancellation (`ABORT_ERR`) and the breaker’s own `POOL_CIRCUIT_OPEN` result do not count as backend failures.

SQL/query errors do not feed the breaker because the protection boundary is pool acquisition, not application correctness.

## Configuration

| Option | Default | Meaning |
| --- | ---: | --- |
| `circuitBreakerThreshold` | `0` | Consecutive acquisition failures required to open the breaker. `0` disables it. |
| `circuitBreakerCooldownMs` | `5000` | Minimum open duration before half-open probes are admitted. |
| `circuitBreakerHalfOpenMaxAttempts` | `1` | Maximum concurrent acquisition probes while half-open. |

## Failure contract

While open, new acquisition attempts receive a non-fatal error:

```text
code: POOL_CIRCUIT_OPEN
fatal: false
retryAfterMs: <remaining cooldown>
```

The error also exposes a `circuitBreaker` snapshot so callers can inspect the current state without parsing messages.

## Runtime state

Callback pools expose:

```js
pool.circuitBreakerStats();
```

Promise pools expose the same state:

```js
pool.promise().circuitBreakerStats();
```

The snapshot contains:

- whether the breaker is enabled;
- current `closed`, `open` or `half-open` state;
- consecutive failure count and configured threshold;
- cooldown and remaining retry delay;
- half-open probes in flight and probe limit;
- cumulative opens, fast rejections and recoveries.

## Diagnostics

NuBloxSQL publishes breaker transitions and fast rejections through Node `diagnostics_channel`:

```text
nublox.mysql.pool.circuit_breaker.state
nublox.mysql.pool.circuit_breaker.reject
```

No credentials, SQL text or bind values are published on these channels.

## Relationship to adaptive admission

The circuit breaker is the first M5.3 pool-resilience boundary. It supplies an explicit backend-health state that adaptive queue admission can use in the next tranche. Static `connectionLimit`, `queueLimit`, minimum-idle maintenance and normal saturation behaviour continue to operate independently.
