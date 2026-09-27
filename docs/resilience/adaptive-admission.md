# Adaptive pool admission

NuBloxSQL can bound queue growth when a finite connection pool is saturated. The feature is **disabled by default** so existing mysql/mysql2-compatible queue behaviour is unchanged unless explicitly enabled.

```js
const mysql = require('@nublox/mysql');

const pool = mysql.createPool({
  connectionLimit: 20,
  adaptiveAdmission: true,
  adaptiveAdmissionQueueMultiplier: 2,
  adaptiveAdmissionMinimumQueue: 10
});
```

## Admission rule

Adaptive admission is evaluated only when:

- `adaptiveAdmission === true`;
- `connectionLimit > 0`;
- the pool is saturated: all permitted connections exist and none are idle.

The derived queue budget is:

```text
max(
  adaptiveAdmissionMinimumQueue,
  ceil(connectionLimit * adaptiveAdmissionQueueMultiplier)
)
```

When a finite `queueLimit` is configured, the effective adaptive budget never exceeds that hard limit:

```text
min(queueLimit, derived adaptive budget)
```

If `queueLimit` is `0`, the existing hard queue is unlimited, but adaptive admission can still impose a bounded saturation queue when explicitly enabled.

## Rejection contract

Once a saturated pool has reached its adaptive queue budget, new acquisition attempts fail fast with:

```text
code: POOL_ADMISSION_REJECTED
fatal: false
```

The error exposes:

- `queued`: current queued acquisition count;
- `queueBudget`: effective adaptive budget;
- `admission`: a runtime admission snapshot.

Already queued work is not discarded. Adaptive admission prevents additional queue growth rather than mutating or reprioritising existing callbacks.

## Configuration

| Option | Default | Meaning |
| --- | ---: | --- |
| `adaptiveAdmission` | `false` | Enables saturation-aware queue admission. |
| `adaptiveAdmissionQueueMultiplier` | `2` | Queue slots derived per configured connection. Must be a positive finite number. |
| `adaptiveAdmissionMinimumQueue` | `10` | Minimum adaptive queue budget. Must be a non-negative safe integer. |

Pools with `connectionLimit: 0` are intentionally excluded because an adaptive budget cannot be derived from an unlimited connection ceiling.

## Runtime state

Callback pools expose:

```js
pool.admissionStats();
```

Promise pools expose:

```js
pool.promise().admissionStats();
```

The snapshot reports whether admission is enabled, saturation state, pool totals, current queue length, configured connection limit, effective queue budget, configured multiplier/minimum and cumulative fast rejections.

## Diagnostics

Adaptive rejections are published through Node `diagnostics_channel`:

```text
nublox.mysql.pool.admission.reject
```

The event contains pool counts and admission limits only. It does not contain credentials, SQL text or bind values.

## Relationship to the circuit breaker

Adaptive admission and the acquisition circuit breaker solve different overload modes:

- adaptive admission bounds queue growth while a healthy-but-saturated pool is busy;
- the circuit breaker fails fast when repeated backend acquisition failures indicate an unhealthy MySQL service.

The circuit breaker wraps admission control. When the breaker is open, `POOL_CIRCUIT_OPEN` takes precedence. `POOL_ADMISSION_REJECTED` is a pool-control outcome and does not increment breaker failure counts.

Static `queueLimit` remains the hard compatibility control. Adaptive admission is an additional opt-in dynamic budget beneath that ceiling.
