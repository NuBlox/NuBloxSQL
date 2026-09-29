# @nublox/postgresql 0.2.0-rc.1

First NuBloxSQL PostgreSQL release candidate with a native connection and simple-query runtime.

## Included

- native TCP connection lifecycle
- SSLRequest negotiation and TLS upgrade policy
- StartupMessage handling
- cleartext, MD5 and SCRAM-SHA-256 authentication
- SCRAM server-signature verification
- server parameter and backend-key capture
- ReadyForQuery transaction-state tracking
- simple-query protocol
- row metadata, row data and command completion decoding
- common text result decoding for booleans, integers, floating/numeric values and JSON/JSONB
- structured PostgreSQL errors and notices
- connection/query timeout and AbortSignal hooks
- TypeScript declarations
- live PostgreSQL 18 CI smoke coverage

## Deliberate RC exclusions

The following remain post-RC milestones: extended query protocol, prepared statements, binary format parameters/results, CancelRequest-based non-destructive cancellation, pooling, COPY, LISTEN/NOTIFY helpers, logical replication and production performance tuning.

## Compatibility target

The RC uses PostgreSQL frontend/backend protocol 3.x. PostgreSQL 18 advertises protocol 3.2 while protocol 3.0 remains broadly supported; the driver keeps protocol-version handling explicit so later capability negotiation can evolve without changing the public connection API.
