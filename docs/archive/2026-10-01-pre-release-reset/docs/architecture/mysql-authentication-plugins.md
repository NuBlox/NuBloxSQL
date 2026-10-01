# MySQL Authentication Plugin Matrix

## Purpose

NuBloxSQL treats MySQL authentication as a versioned protocol contract rather than assuming every server exposes the same plugin set. The public matrix describes client support separately from server availability so applications and tooling can make explicit decisions without guessing from a server version string.

## Public API

```js
const mysql = require('nubloxsql/mysql');

const plugin = mysql.authenticationPlugin('caching_sha2_password', '9.7.0');
const matrix = mysql.authenticationPluginReport('8.4.11');
```

The dialect also exports the frozen `AUTHENTICATION_PLUGINS` register.

## Supported client paths

### `caching_sha2_password`

Status: **qualified and preferred**.

NuBloxSQL supports:

- initial SHA-256 challenge response;
- fast-auth continuation;
- full authentication over TLS;
- RSA password exchange using a configured server public key;
- server RSA public-key retrieval when explicitly enabled.

This is the preferred modern MySQL authentication path.

### `sha256_password`

Status: **qualified but deprecated by MySQL**.

NuBloxSQL supports:

- cleartext password exchange only over TLS;
- RSA password exchange using a configured server public key;
- server RSA public-key retrieval when explicitly enabled.

The matrix marks the plugin deprecated so support does not imply recommendation.

### `mysql_native_password`

Status: **legacy client support**.

NuBloxSQL retains the legacy SHA-1 challenge implementation for compatibility with older servers. The matrix reports server lifecycle separately: MySQL 8.4 disables the server plugin by default, while MySQL 9.0 and newer have removed it from the server.

NuBloxSQL does not imply that a server supports this plugin merely because the client algorithm remains available.

### `mysql_clear_password`

Status: **guarded**.

The cleartext client plugin is rejected unless both conditions are true:

1. the connection is protected by TLS; and
2. the caller explicitly sets `allowCleartextAuth: true`.

NuBloxSQL never sends a cleartext password for this plugin over an unencrypted connection.

## Unsupported plugins

Unknown authentication plugins do not silently fall back to another exchange. `authenticationPlugin(name, serverVersion)` returns `clientSupport: 'unsupported'`, and a live authentication switch to an unsupported plugin fails explicitly.

This is intentional: using the wrong authentication exchange is less safe than refusing the connection.

## RSA key policy

Public-key retrieval is opt-in through `getServerPublicKey: true`. Applications may instead provide `serverPublicKey` explicitly. TLS avoids RSA key retrieval because the password exchange is already protected by the encrypted transport.

## Qualification

The current matrix is qualified with:

- Node.js 22, 24 and 26 contract tests;
- MySQL 8.4 and 9.7 live servers;
- `caching_sha2_password` authentication;
- deprecated `sha256_password` authentication;
- RSA public-key retrieval;
- configured RSA public-key paths where the server exposes the key;
- TLS authentication paths;
- `mysql_native_password` server-lifecycle checks;
- guarded cleartext-plugin contract tests;
- the normal NuBloxSQL security, fuzz, package and cross-dialect regression gates.

The matrix records observed support; it does not override MySQL server policy, plugin installation, account configuration or server-side deprecation/removal decisions.
