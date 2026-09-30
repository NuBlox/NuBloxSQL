# NuBloxSQL public facade errors

NuBloxSQL exposes one stable error class across database-runtime failures and public facade failures: `NuBloxSqlError`.

Facade consumers should branch on `error.code` and `error.category`, not on error-message text or JavaScript built-in subclasses.

## Stable facade codes

| Code | Category | Meaning |
| --- | --- | --- |
| `NUBLOXSQL_CONFIGURATION` | `state` | Invalid portable connection, pool, telemetry or type configuration |
| `NUBLOXSQL_ROUTING` | `state` | Invalid or contradictory dialect/URL routing input |
| `NUBLOXSQL_UNSUPPORTED_DIALECT` | `unsupported` | Requested dialect is not implemented by this release |
| `NUBLOXSQL_UNSUPPORTED_URL_SCHEME` | `unsupported` | Connection URL scheme cannot be routed |
| `NUBLOXSQL_CLIENT_LIFECYCLE` | `state` | Operation conflicts with the client's lifecycle state |
| `NUBLOXSQL_UNSUPPORTED` | `unsupported` | Requested portable feature is unsupported by the selected dialect |

The constants are exported as `ERROR_CODES`.

```js
const sql = require('nubloxsql');

try {
  sql.createConnection('oracle://localhost/app');
} catch (error) {
  if (error instanceof sql.NuBloxSqlError &&
      error.code === sql.ERROR_CODES.UNSUPPORTED_URL_SCHEME) {
    // deterministic routing failure
  }
}
```

## Common fields

Every public facade failure supplies the normal `NuBloxSqlError` fields:

- `code` — stable machine-readable code;
- `category` — portable error taxonomy category;
- `dialect` — selected dialect where known;
- `operation` — `routing`, `configuration`, `lifecycle`, or the unsupported feature;
- `retryable` — `false` for facade validation/state failures;
- `cause` — originating error where one exists.

Lifecycle failures additionally expose `lifecycleState`.

## Compatibility policy

Message text exists for humans and may become clearer over time. It is not the compatibility contract. Public code and category values are the stable integration surface.

Native database failures continue through the existing error normalization layer and retain native diagnostics. This facade contract covers failures raised before or around native execution, ensuring application code does not have to catch a mixture of `TypeError`, `RangeError`, and generic `Error` for public NuBloxSQL operations.
