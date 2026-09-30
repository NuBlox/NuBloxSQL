# SQLite extensibility and runtime security

NuBloxSQL exposes SQLite extensibility features through a capability-detected, deny-by-default security model.

## User-defined functions

Scalar functions are registered with `connection.createFunction(name, options?, fn)`. Aggregate and window functions use `connection.createAggregate(name, options)` when the active Node runtime exposes `DatabaseSync.aggregate()`.

`connection.extensibilityCapabilities()` reports runtime support instead of inferring support from a Node version string.

## Extension loading policy

Native SQLite extension loading is disabled unless the connection is explicitly constructed with `allowExtension: true`.

An optional `extensionAllowlist` contains the exact resolved filesystem paths that may be loaded. When the allowlist is non-empty, attempts to load any other path are rejected before SQLite is called.

```js
const db = sqlite.createConnection({
  allowExtension: true,
  extensionAllowlist: ['./extensions/decimal.dylib']
});
```

The policy is inspectable with `connection.extensionPolicy()`. Loading may subsequently be disabled with `connection.enableExtensionLoading(false)`. A connection created without extension loading enabled cannot elevate itself later.

## Authorizer

When supported by the active Node runtime, `connection.setAuthorizer(callback)` installs a SQLite authorizer callback. `connection.authorizerConstants()` exposes the SQLite action/result constants supplied by `node:sqlite` so policies do not need hard-coded numeric action codes.

Unsupported runtimes return `NUBLOXSQL_UNSUPPORTED` rather than silently omitting enforcement.

## Defensive mode

When `DatabaseSync.enableDefensive()` is available, `connection.setDefensive(true)` enables SQLite defensive mode. This is capability-detected because it is not present throughout the full Node 22/24/26 support matrix.

## Security properties

- extension loading defaults to disabled;
- connection construction determines whether extension loading can ever be enabled;
- extension paths can be exact-path allowlisted;
- authorizer and defensive controls fail explicitly when unavailable;
- UDF names are restricted to simple SQL identifiers;
- native SQLite errors continue through NuBloxSQL error normalization.
