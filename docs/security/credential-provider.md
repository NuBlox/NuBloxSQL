# Short-lived credential providers

NuBloxSQL supports an optional `credentialProvider` connection setting for credentials that should be resolved immediately before MySQL authentication instead of being stored as a long-lived static password in application configuration.

The provider is **disabled by default**. Existing `user`, `password` and `database` configuration continues to behave unchanged.

```js
const mysql = require('@nublox/mysql');

const connection = mysql.createConnection({
  host: 'db.internal',
  user: 'application',
  database: 'core',
  ssl: true,

  async credentialProvider(context) {
    const token = await issueDatabaseToken({
      host: context.host,
      port: context.port,
      user: context.user
    });

    return token;
  }
});
```

The provider can also rotate the username or database together with the password/token:

```js
credentialProvider: async () => ({
  user: 'ephemeral-user',
  password: await issueToken(),
  database: 'tenant_db'
})
```

## Resolution boundary

The provider is invoked once per physical connection handshake, after any configured TLS upgrade has completed and before the first authentication response is generated.

This makes the hook suitable for short-lived database tokens while ensuring the resolved secret is available to built-in MySQL authentication plugins such as `caching_sha2_password`, `sha256_password` and `mysql_clear_password`.

A pool creates independent physical connections, so each new pooled connection performs its own credential-provider resolution. Existing established connections do not continuously refresh credentials because MySQL authentication occurs at connection establishment.

## Provider context

The provider receives an immutable context containing:

- `host`;
- `port`;
- `socketPath` when configured;
- configured `user`;
- configured `database`;
- `secure`, indicating TLS or a local socket authentication path.

The context does **not** contain the configured or previously resolved password.

## Return values

A provider may return a password/token string:

```js
return 'short-lived-token';
```

or a credential object:

```js
return {
  user: 'optional-new-user',
  password: 'short-lived-token',
  database: 'optional-new-database'
};
```

Both synchronous values and Promises are supported.

The object form requires `password` to be a string. Optional `user` and `database` values must also be strings.

## Failure behaviour

A provider exception or rejected Promise terminates the current authentication handshake as a fatal connection error. If the original error has a `code`, NuBloxSQL preserves it; otherwise the error code is:

```text
CREDENTIAL_PROVIDER_ERROR
```

Invalid provider output fails with:

```text
CREDENTIAL_PROVIDER_INVALID_RESULT
```

The failure affects that physical connection attempt. A later pool connection attempt invokes the provider again and can obtain a fresh credential.

## Diagnostics and secret handling

NuBloxSQL publishes safe lifecycle events through Node `diagnostics_channel`:

```text
nublox.mysql.credentials.resolve.start
nublox.mysql.credentials.resolve.end
nublox.mysql.credentials.resolve.error
```

These events contain connection identity/timing metadata and error codes only. Resolved passwords/tokens are never included.

The connector core intentionally has no dependency on a particular secret manager. Applications can integrate AWS IAM/RDS tokens, Azure identity tokens, HashiCorp Vault, Kubernetes-issued credentials, an internal NuBlox credential service, or another provider through the same interface.

## Operational guidance

Keep the provider fast enough to fit within the connection-establishment budget, avoid logging returned credentials, and prefer TLS when token or password authentication can expose clear credential material at the MySQL protocol layer.
