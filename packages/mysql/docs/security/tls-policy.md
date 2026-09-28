# TLS security policies

NuBloxSQL supports opt-in named TLS policies that turn the low-level Node.js TLS version settings into enforceable connection-security profiles.

Existing `ssl` behaviour remains unchanged unless `tlsPolicy` is configured.

## Modern policy

```js
const connection = mysql.createConnection({
  host: 'db.internal',
  user: 'app',
  database: 'core',
  ssl: {
    ca: trustedCa
  },
  tlsPolicy: 'modern'
});
```

`modern` enforces:

- TLS 1.2 or newer;
- certificate verification (`rejectUnauthorized: true`).

An explicitly configured TLS 1.3 minimum is accepted because it is stricter than the profile requirement.

## Strict policy

```js
const connection = mysql.createConnection({
  host: 'db.internal',
  user: 'app',
  database: 'core',
  ssl: {
    ca: trustedCa
  },
  tlsPolicy: 'strict'
});
```

`strict` enforces:

- TLS 1.3 or newer;
- certificate verification (`rejectUnauthorized: true`).

Use this profile only when every target server is configured for TLS 1.3.

## Fail-closed validation

A named TLS policy is rejected during connection configuration when:

- TLS is not enabled;
- `rejectUnauthorized` is explicitly `false`;
- an explicit `minVersion` is weaker than the selected policy;
- an explicit `maxVersion` is lower than the policy minimum;
- the policy name is unknown.

This is intentional: selecting a policy is a request for a security invariant, not a best-effort preference.

## Relationship to raw SSL options

Applications can continue to configure raw Node.js-compatible TLS settings directly:

```js
ssl: {
  ca: trustedCa,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  rejectUnauthorized: true
}
```

Without `tlsPolicy`, NuBloxSQL preserves the existing compatibility behaviour. Named policies add validation and minimum guarantees without removing the lower-level configuration surface.

When a policy is selected, an explicitly stronger `minVersion` is preserved. Certificate verification cannot be weakened.

## Pools

`tlsPolicy` is a connection option and therefore also applies to every physical connection created by a pool:

```js
const pool = mysql.createPool({
  host: 'db.internal',
  user: 'app',
  database: 'core',
  ssl: {ca: trustedCa},
  tlsPolicy: 'modern',
  connectionLimit: 20
});
```

## Credential providers

TLS policies compose with `credentialProvider`. TLS negotiation happens before a short-lived credential is resolved and before the first authentication response is generated. This is useful when the credential provider returns a token that must only be sent across an authenticated encrypted transport.

## Migration guidance

For existing deployments:

1. confirm all target MySQL servers support the required TLS version;
2. confirm the configured CA/server certificate chain validates correctly;
3. enable `tlsPolicy: 'modern'` first;
4. use `strict` only after confirming TLS 1.3 support across every target and failover endpoint.
