# MySQL official-document parity register

NuBloxSQL uses the official MySQL documentation as the primary source for MySQL runtime, protocol and feature-parity decisions.

Primary references:

- https://dev.mysql.com/doc/refman/8.4/en/
- https://dev.mysql.com/doc/refman/9.7/en/
- https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html

This register tracks **NuBloxSQL implementation coverage**, not whether MySQL itself supports a feature.

| Area | MySQL capability | NuBloxSQL status | Next action |
| --- | --- | --- | --- |
| Core classic protocol | Handshake, capability negotiation, commands, resultsets | Qualified | Maintain |
| TLS | Classic-protocol TLS | Qualified | Maintain |
| Authentication | caching_sha2_password, guarded/legacy plugin handling | Qualified | Continue lifecycle/version tracking |
| Prepared statements | COM_STMT_PREPARE / EXECUTE / RESET / CLOSE | Qualified | Maintain |
| Connection attributes | CLIENT_CONNECT_ATTRS and Performance Schema visibility | Qualified by this slice | Maintain 64KB guardrails and live 8.4/9.7 evidence |
| Connection compression | zlib, zstd, uncompressed algorithm negotiation | Gap | Implement protocol compression with explicit algorithm policy and live qualification |
| Session-state tracking | CLIENT_SESSION_TRACK and OK-packet state-change data | Gap | Add OK-packet session-state decoding together with EOF deprecation support |
| EOF deprecation | CLIENT_DEPRECATE_EOF | Gap | Implement alongside session tracking so resultset terminators remain protocol-correct |
| Query attributes | CLIENT_QUERY_ATTRIBUTES | Gap | Add COM_QUERY/COM_STMT_EXECUTE attribute encoding after session tracking |
| Multi-factor authentication | CLIENT_MULTI_FACTOR_AUTHENTICATION | Gap | Define secure factor callback/credential contract before implementation |
| TCP transport | TCP/IP | Qualified | Maintain |
| Unix socket transport | Local Unix-domain socket | Gap | Add explicit socketPath transport with live/local qualification |
| Named pipe/shared memory | Windows local transports | Gap / platform-specific | Defer until Windows qualification infrastructure exists |
| LOCAL INFILE | CLIENT_LOCAL_FILES with controlled upload | Qualified | Maintain |
| Connection reset | COM_RESET_CONNECTION | Qualified | Maintain |
| Streaming/backpressure | Incremental result handling | Qualified | Maintain |
| Query diagnostics | EXPLAIN / EXPLAIN ANALYZE | Qualified | Continue version-shape qualification |
| Metadata | INFORMATION_SCHEMA and Performance Schema | Strong | Extend only where product-level use cases justify it |
| Replication protocol | Binary-log/source-replica protocol | Not a public runtime contract | Define scope before implementation |
| X Protocol / Document Store | Separate protocol family | Out of current classic-protocol scope | Reassess only if product requirements justify a second protocol stack |

## Prioritization

Recommended MySQL runtime sequence:

1. Connection attributes.
2. Connection compression.
3. Session-state tracking plus deprecated-EOF replacement.
4. Query attributes.
5. Unix-socket transport.
6. Multi-factor authentication contract.
7. Reassess replication/X Protocol scope.

The order favors capabilities that improve production runtime behavior and observability while preserving the existing single NuBloxSQL public entry point.
