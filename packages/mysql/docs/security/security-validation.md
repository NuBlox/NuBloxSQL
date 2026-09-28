# Security validation

NuBloxSQL treats parser, protocol and dependency security as continuously validated release criteria rather than one-off review activities.

## Static application security testing

GitHub CodeQL analyzes the JavaScript/TypeScript codebase on pull requests, pushes to `main`, a weekly schedule and manual dispatch. The workflow uses the `security-extended` query suite so security-relevant data-flow and code-quality findings are surfaced through GitHub code scanning.

The CodeQL workflow is intentionally separate from the normal compatibility matrix so static analysis does not need a live MySQL service.

## Production dependency audit

The security workflow installs dependencies with lifecycle scripts disabled and runs:

```bash
npm audit --omit=dev --audit-level=high
```

High and critical vulnerabilities in the production dependency graph therefore fail the security job. Development-only packages remain outside this production gate because they are not shipped in the `@nublox/mysql` runtime dependency surface.

## Deterministic packet/parser fuzzing

`test/security/fuzz-parser-boundaries.js` continuously exercises two externally influenced boundaries:

1. MySQL classic-protocol packet framing and parser fragmentation.
2. The inbound logical-packet allocation limiter.

The harness uses a deterministic xorshift32 generator. Every run reports the seed, making a failing corpus reproducible without persisting sensitive or untrusted input artifacts.

The parser corpus varies:

- packet count;
- payload size;
- payload bytes;
- network chunk boundaries;
- truncated input;
- packet sequence identifiers;
- buffer and UTF-8 packet-terminated decode paths.

The allocation-limiter corpus varies configured limits, declared packet lengths, payload availability and network fragmentation. Oversized declarations must fail only with the expected fatal `PROTOCOL_INBOUND_PACKET_TOO_LARGE` error.

CI currently runs 10,000 parser cases and 10,000 limiter cases per security workflow execution with payloads bounded to 2 KiB. This intentionally targets state-machine and framing correctness without turning ordinary pull-request CI into a long-running coverage-guided fuzz service.

### Local reproduction

Run the default deterministic corpus:

```bash
node test/security/fuzz-parser-boundaries.js
```

Run a larger corpus or reproduce a specific seed:

```bash
NUBLOX_FUZZ_ITERATIONS=50000 \
NUBLOX_FUZZ_MAX_PAYLOAD=4096 \
NUBLOX_FUZZ_SEED=1314214476 \
node test/security/fuzz-parser-boundaries.js
```

All knobs must be positive safe integers except the seed, which may be any unsigned 32-bit integer.

## Security release gate

A change is not considered security-validated merely because the normal unit and live-server compatibility jobs pass. The security workflow must also complete successfully so that production dependency audit, parser fuzzing and CodeQL analysis remain part of the evidence for the release candidate.
