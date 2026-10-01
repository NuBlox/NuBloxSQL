# NuBloxSQL SQL Core v1 Compatibility Contract

This document defines the stable cross-dialect contract family identified at runtime by `@nublox/sql-core` `CONTRACT_VERSION === '1.0'`.

## Purpose

SQL Core is a contract vocabulary, not a driver wrapper. MySQL and PostgreSQL remain first-class native adapters with their own protocol, type, cursor, cancellation and metadata semantics.

A concept belongs in SQL Core v1 only when it is proven by both canonical adapters or is necessary cross-dialect policy vocabulary.

## Frozen portable contracts

### Dialect identity and services

Adapters expose:

- dialect family and display identity;
- boolean capability discovery;
- identifier quoting;
- positional placeholder generation;
- catalog/schema/name object identity without asserting that vendor namespace models are equivalent.

### Operation control

The portable v1 operation policy consists of:

- relative `timeout` in milliseconds;
- structural cancellation signal (`SqlAbortSignal`).

Absolute deadlines are not part of the v1 portable contract because they are not yet exposed consistently by both canonical adapters.

### Bounded result policy

Portable resource-limit vocabulary is:

- `maxRows`;
- `maxResultBytes`;
- `maxRowBytes`.

Adapters choose the protocol-safe failure mechanism. SQL Core standardises the policy names, not the wire recovery strategy.

### Execution and results

Portable execution requests contain SQL plus positional parameters.

Portable results distinguish:

- row-producing results with field metadata;
- command results with affected-row / row-count / insert-id information when the vendor exposes those concepts.

Vendor-specific command tags, server status flags, warnings, portal state and native field metadata remain adapter extensions.

### Transactions

The v1 transaction vocabulary freezes:

- `read-uncommitted`;
- `read-committed`;
- `repeatable-read`;
- `serializable`;
- optional read-only policy.

Adapters retain vendor-specific additions such as PostgreSQL deferrable transactions.

### Errors

The portable error categories are:

- connection;
- authentication;
- timeout;
- cancelled;
- constraint;
- deadlock;
- serialization;
- syntax;
- resource-limit;
- protocol;
- state;
- unknown.

Portable error details preserve native code, SQLSTATE, retryability, resource-limit evidence and the original cause where available. Vendor-native error fields remain available through adapter extensions.

## Deliberately excluded from v1

The following are not frozen SQL Core v1 concepts:

- named parameter maps;
- a generic multi-result container;
- universal absolute deadlines;
- vendor cursor/portal wire models;
- CDC or replication protocols;
- multiple-active-result semantics;
- native type codecs;
- authentication mechanisms;
- TLS configuration shapes;
- vendor-specific observability payloads.

Their exclusion is intentional. Adding them later requires evidence that they are genuinely portable rather than convenient abstractions for one adapter.

## Adapter compatibility requirements

An adapter claiming SQL Core v1 compatibility must:

1. provide a valid dialect descriptor accepted by `assertDialectDescriptor()`;
2. preserve vendor-specific semantics rather than silently emulating unsupported behavior;
3. expose operation timeout/cancellation policy where the operation supports cancellation;
4. expose bounded-result controls using the portable resource-limit names when those controls are supported;
5. map portable transaction options without hiding vendor-specific extensions;
6. preserve native error codes / SQLSTATE where provided by the server;
7. keep vendor-only data in adapter-specific fields or explicit extension points;
8. pass the repository SQL Core v1 adapter contract suite.

## Compatibility policy

After stable `@nublox/sql-core@1.0.0`, breaking changes to this frozen contract require a new major version. Adapter-specific additive APIs do not require a SQL Core major change unless the shared contract itself changes.
