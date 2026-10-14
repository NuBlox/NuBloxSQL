# Repository Scripts

This directory contains repository-level qualification and maintenance scripts.

- `run-suite.js` executes ordered Node.js suites from JSON manifests.
- `suites/platform.json` defines cross-cutting package/platform contract tests.
- `suites/release.json` defines release qualification checks.
- `check-*.js` files enforce focused release, package, architecture and capability contracts.
- `CloudConnectionQualification.js` contains the optional managed-cloud PostgreSQL/MySQL/SQL Server
  read-only TLS qualification contract and error-redaction policy.
- `qualify-cloud-connection.js` is the explicit opt-in, secrets-injected
  live endpoint CLI. See [cloud qualification setup](../docs/architecture/UNIVERSAL-DATABASE-DRIVER.md#opt-in-live-managed-cloud-qualification);
  it never runs against real cloud endpoints in normal PR CI.

Scripts are not part of the published `nubloxsql` package runtime.

The historical `tool/` directory is obsolete and must not be recreated.
