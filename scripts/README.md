# Repository Scripts

This directory contains repository-level qualification and maintenance scripts.

- `run-suite.js` executes ordered Node.js suites from JSON manifests.
- `suites/platform.json` defines cross-cutting package/platform contract tests.
- `suites/release.json` defines release qualification checks.
- `check-*.js` files enforce focused release, package, architecture and capability contracts.

Scripts are not part of the published `nubloxsql` package runtime.

The historical `tool/` directory is obsolete and must not be recreated.
