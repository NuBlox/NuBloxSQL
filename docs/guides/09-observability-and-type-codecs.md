# Observability and type codecs

## Telemetry

Pass a `telemetry` object to `createClient()`:

```js
const db = createClient({
  dialect: 'postgresql',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'app',
  telemetry: {
    slowQueryThresholdMs: 250,
    includeSql: false,
    onEvent(event) {
      metrics.record(event);
    },
    onError(event) {
      logger.error(event);
    }
  }
});
```

Supported event families include query, execute, prepare, prepared execution, transaction, transaction retry, stream, connection and error events.

Telemetry events carry a schema version, event/client identifiers, dialect, timestamp and event-specific fields such as duration, success, slow status, row counts, affected rows, command, error category/code, retryability and pool snapshots.

## SQL text is opt-in

`includeSql` is disabled unless you enable it. Keep it disabled if SQL text can contain sensitive literals or reveal internal schema details. Tagged SQL protects values through binding, but observability policy is still your responsibility.

## Slow-operation threshold

The base declaration supports `slowQueryThresholdMs`; the extended public surface also supports `slowOperationThresholdMs` for broader operation reporting. Configure the option supported by the current client contract you consume and verify TypeScript declarations during upgrades.

## Event-specific callbacks

In addition to `onEvent`, telemetry supports callbacks such as `onQuery`, `onExecute`, `onPrepare`, `onPrepared`, `onTransaction`, `onTransactionRetry`, `onStream`, `onConnection` and `onError`.

Keep callbacks fast. A telemetry callback is not the right place to perform slow synchronous I/O.

## Type codecs

Use the `types` option to transform values at the NuBloxSQL client boundary:

```js
const db = createClient({
  dialect: 'postgresql',
  user: 'app',
  types: {
    decode(value, context) {
      if (context.column === 'amount' && typeof value === 'string') {
        return BigInt(value);
      }
      return value;
    }
  }
});
```

The type codec context includes dialect, direction, column, native type, parameter index and portable type evidence where available.

## Column decoder

Register a decoder for a particular result column:

```js
db.types.registerColumn('payload', (value) => {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
});
```

Remove it later with `unregisterColumn(name)`.

## Native-type decoder

```js
db.types.registerNativeType('uuid', value => String(value));
```

Native type names are dialect-specific. Use this only when your application deliberately understands the selected engine's metadata.

## Encode hook

An encode hook can map domain values before they reach the native adapter:

```js
const db = createClient({
  dialect: 'mysql',
  user: 'app',
  types: {
    encode(value, context) {
      if (value instanceof URL) return value.toString();
      return value;
    }
  }
});
```

Do not use encoders to inject SQL syntax. They transform bound values only.

## Null decoding

`decodeNulls` controls whether the global decoder is invoked for `null` values. Leave nulls untouched unless the application has an explicit reason to transform them.

## Operational recommendation

Make telemetry and codec registration part of application bootstrap rather than mutating behaviour unpredictably per request. Treat codecs as part of your database contract and cover them with integration tests.