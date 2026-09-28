# @nublox/sql-core

`@nublox/sql-core` defines vendor-neutral contracts and small runtime primitives for NuBloxSQL dialect adapters.

It is intentionally transport-free. Database protocols, authentication, wire formats, native type codecs, replication/change-data-capture implementations and server-specific behaviour belong in dialect adapters.

## Initial contract surface

The v0 contract covers:

- dialect identity and capability discovery;
- dialect services for identifier quoting and placeholders;
- neutral object naming across catalog/schema/database differences;
- execution request/result shapes;
- operation cancellation/deadline options;
- transaction options;
- portable field metadata;
- portable error classification vocabulary;
- adapter extension points.

A contract should not be treated as stable merely because MySQL can implement it. Shared contracts are expected to be challenged by at least one materially different SQL dialect before they are promoted as stable cross-dialect API.

## Independence

This package is part of NuBloxSQL and has no dependency on any other NuBlox project. It must remain independently testable, versionable and publishable.

## Status

`0.1.x` is an architectural foundation. Additive and breaking refinements are expected while the second dialect validates the abstractions.
