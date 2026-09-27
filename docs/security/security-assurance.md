# Security assurance

NuBloxSQL treats malformed protocol input, vulnerable production dependencies, and static-analysis findings as release-quality concerns rather than optional development checks.

## Parser boundary invariants

The classic-protocol parser validates every fixed-width, string and buffer read against the current packet boundary before reading or allocating memory.

The parser therefore rejects:

- decoded lengths that exceed the bytes remaining in the current packet;
- negative, fractional or unsafe requested read lengths;
- fixed-width reads that cross the packet boundary;
- null-terminated values whose terminator exists only in a later packet.

Expected parser errors include:

```text
PARSER_READ_PAST_END
PARSER_INVALID_LENGTH
PARSER_MISSING_NULL_BYTE
```

These checks are intentionally implemented in the parser primitives so packet implementations inherit the same allocation boundary.

## Deterministic protocol fuzzing

The repository includes a deterministic classic-protocol fuzz harness:

```bash
npm run test:fuzz:protocol
```

Default campaign:

```text
FUZZ_SEED=nubloxsql-protocol-v1
FUZZ_CASES=2000
```

CI runs a larger fixed campaign on Node 24:

```text
FUZZ_SEED=nubloxsql-ci-v1
FUZZ_CASES=5000
```

The harness currently exercises:

- valid packets split across randomized network-fragment boundaries;
- malformed length-coded buffer declarations;
- packet sequence validation.

Failures print the seed and iteration so a campaign is reproducible locally:

```bash
FUZZ_SEED=nubloxsql-ci-v1 FUZZ_CASES=5000 npm run test:fuzz:protocol
```

The fuzz harness is also part of `npm run verify`, using the default deterministic campaign.

## Production dependency audit

CI runs:

```bash
npm run security:audit
```

which executes:

```bash
npm audit --omit=dev --audit-level=high
```

This gates high and critical advisories affecting production dependencies. Development-only dependencies are excluded from this production-dependency gate so the result reflects the published runtime package surface.

The audit is intentionally kept out of the local `verify` command because it requires live npm registry advisory data and is therefore not deterministic/offline-safe.

## CodeQL

`.github/workflows/codeql.yml` performs GitHub CodeQL analysis for JavaScript/TypeScript using the `security-extended` query suite.

It runs on:

- pull requests targeting `main`;
- pushes to `main`;
- a weekly scheduled scan;
- manual workflow dispatch.

The workflow requests only repository read access plus `security-events: write`, which is required to upload code-scanning results.

## Release assurance model

The security assurance layers are complementary:

1. parser unit tests enforce known malformed-input boundaries;
2. deterministic fuzzing explores combinations of framing, fragmentation and malformed lengths;
3. the production dependency audit checks known registry advisories;
4. CodeQL checks source-level security patterns;
5. the existing Node 22/24/26 and live MySQL 8.4/9.7 matrix checks compatibility and integration behaviour.

A change to parser primitives should not be merged until the normal NuBloxSQL CI matrix and the security-analysis workflow are green, or a platform-only limitation has been explicitly identified and documented.
