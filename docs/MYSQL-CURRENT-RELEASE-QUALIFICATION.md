# NuBloxSQL — Current MySQL release qualification matrix

**Classification:** engineering qualification, not a commercial production release.

## Version policy

The existing [legacy/baseline version and TLS workflow](../.github/workflows/mysql-version-qualification.yml)
continues to qualify the pinned 8.0.44 compatibility target and 8.4.11
baseline. MySQL 8.0 reached end of life in April 2026 and remains **legacy
compatibility evidence only**; it must not be advertised as a newly supported
production release on the basis of those jobs.

The new [current-release workflow](../.github/workflows/mysql-current-support.yml)
qualifies three exact MySQL Community Server tags on isolated local TCP
and adds independent certificate-verified TLS jobs for the two maintained LTS
releases. The Innovation release has **no TLS support qualification yet**:

| MySQL image | Release track | CI qualification |
| --- | --- | --- |
| `mysql:8.4.13` | 8.4 Long-Term Support | Full native regression, package preflight, local soak/restart, verified TLS identity and authentication |
| `mysql:9.7.4` | 9.7 Long-Term Support | Same native and certificate-verified TLS checks |
| `mysql:26.10.0` | October 2026 Innovation | Local TCP regression/soak/restart; **TLS not qualified** |

The official MySQL Docker images are pinned to exact patch releases, never
floating `latest` or `lts` tags. A job verifies both the server's actual
`SELECT VERSION()` and the native greeting before qualification.

## Test and evidence contract

Each isolated Ubuntu / Node.js 22 job installs SQL stored-procedure fixtures,
executes the full native driver test suite and release preflight, runs bounded
prepared/cursor/pool/authentication workloads and a timed pooled-read soak,
then deliberately kills and restarts its **throwaway** server during a
prepared statement request. The pre-existing recovery harness verifies the
in-flight command fails closed, prepared handles are revoked, no application
SQL is replayed, and the pool creates a new authenticated physical session.

The restart runner validates its Docker container image and requires both CI
and an explicit destructive-fixture opt-in. It must never be invoked against
production, shared development, or customer databases.

Per-version redacted local qualification JSON is uploaded to
`mysql-current-release-<version>-<run-id>` artifacts. LTS verified-TLS
benchmarks use separate `mysql-current-tls-<version>-<run-id>` groups.
The `mysql-current-qualification-evidence` job requires all five job groups
and independently validates **11 same-revision reports**: three local
benchmarks, three timed soaks, three restart reports, and two LTS TLS
benchmarks. It rejects missing or duplicate evidence, incorrect MySQL
versions, stale commits, unexpected SQL errors, insufficient soak duration,
TLS identity/authentication failures and incomplete restart recovery.

Retain commit SHA, Actions run URL, observed server version, Node version,
transport profile, workload samples, resource bounds and restart assertions.
**A workflow definition alone is not evidence of a passed version.** Verify
each pinned job and the single matrix evidence decision before claiming
qualification. Innovation TLS is explicitly marked not qualified.

PR and main-push tests run a 5-second minimum soak per version; scheduled
Wednesday runs require 120 seconds. Neither constitutes multi-day endurance,
availability or recovery SLA evidence. Verified TLS on the Innovation release, other host OS/architectures,
cloud DBaaS, replication/failover, independent security assessment and
operator guidance remain separate release blockers.

## Release gate alignment

- **G1:** repeatable functional qualification now extends beyond one version.
- **G4/G11:** a real server crash is exercised, but automated failover and
  operational recovery are not certified.
- **G6:** short repeated-soak and restart evidence grows; multi-day stability
  remains incomplete.
- **G8:** the test matrix broadens, but there is no general cross-platform,
  TLS or managed-cloud compatibility guarantee.

The authoritative [commercial release register](RELEASE.md) continues to mark
NuBloxSQL experimental/pre-commercial. Do not change a gate to complete
without independently reviewed version-specific evidence and the remaining
release/security/commercial requirements.
