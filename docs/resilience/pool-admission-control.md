# Adaptive pool admission control

NuBloxSQL can apply an application-defined admission policy when a pool is saturated and an acquisition would otherwise enter the wait queue.

The hook is **disabled by default**, preserving existing mysql/mysql2-compatible queue behaviour unless explicitly configured.

```js
const mysql = require('@nublox/mysql');

const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'app',
  database: 'app',
  connectionLimit: 20,
  queueLimit: 200,

  admissionControl(snapshot) {
    if (snapshot.circuitBreaker && snapshot.circuitBreaker.state !== 'closed') {
      return {allow: false, reason: 'backend-recovering', retryAfterMs: 100};
    }

    if (snapshot.queued >= 50 && snapshot.utilization === 1) {
      return {allow: false, reason: 'queue-pressure', retryAfterMs: 25};
    }

    return true;
  }
});
```

## Evaluation boundary

The hook runs only when the pool has no immediately available capacity and the request would otherwise be queued.

The existing static `queueLimit` remains the hard upper bound and is checked before the adaptive hook. An admission policy therefore cannot weaken an operator-defined queue cap.

The hook is synchronous by design. It should be fast, deterministic and free of network or filesystem I/O.

## Snapshot

Each evaluation receives an immutable snapshot containing:

- `total`: physical connections currently owned by the pool;
- `active`: non-idle connections;
- `idle`: immediately reusable idle connections;
- `acquiring`: connections currently being established or validated;
- `queued`: callbacks already waiting for a connection;
- `limit`: configured `connectionLimit`;
- `queueLimit`: configured static queue limit;
- `minimumIdle`: configured idle target;
- `utilization`: active/limit ratio, or `null` for an unlimited pool;
- `saturated`: whether the bounded pool is at its connection limit with no idle connection;
- `circuitBreaker`: current circuit-breaker snapshot when available.

No SQL text, bind values or credentials are included.

## Decisions

The hook may return a boolean:

```js
return true;  // admit to queue
return false; // shed load
```

or a structured decision:

```js
return {
  allow: false,
  reason: 'queue-pressure',
  retryAfterMs: 50
};
```

A rejected acquisition receives:

```text
code: POOL_ADMISSION_REJECTED
fatal: false
```

The error also exposes `reason`, `retryAfterMs` and the evaluated admission snapshot.

If the hook throws, returns an invalid value or supplies an invalid `retryAfterMs`, the acquisition receives the non-fatal `POOL_ADMISSION_HOOK_ERROR` error. The original failure is available as `error.cause`.

## Runtime statistics

Callback pools expose:

```js
pool.admissionStats();
```

Promise pools expose:

```js
pool.promise().admissionStats();
```

The snapshot contains:

- whether admission control is enabled;
- total evaluations;
- admitted evaluations;
- rejected evaluations;
- hook/decision errors.

## Diagnostics

NuBloxSQL publishes admission activity through Node `diagnostics_channel`:

```text
nublox.mysql.pool.admission.decision
nublox.mysql.pool.admission.error
```

Decision events include the safe pool snapshot and policy decision metadata. Error events include the error code and safe pool snapshot. SQL, bind values and credentials are not published.

## Relationship to the circuit breaker

The circuit breaker answers **whether the backend appears healthy enough to attempt acquisition**. Adaptive admission answers **whether another saturated request should be allowed to wait**.

They are intentionally separate controls. The admission snapshot includes circuit-breaker state so a NuBlox integration can combine backend health, utilization and queue pressure without coupling that policy into the connector core.
