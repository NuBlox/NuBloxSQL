# Repository Branch Hygiene

This is the operational policy for the NuBloxSQL repository. **`main` is the
only active integration branch.** Every development change must be based on the
current `main`, tested through the required GitHub Actions workflows, and
merged through a pull request. Confirm that `main` contains the merged work
and its checks passed before treating a task as finished.

GitHub is configured to delete head branches of merged pull requests
automatically. Leave unmerged branches and user-local modifications untouched
until their unique work is reconciled. Never force-reset `main`.

## Historical reconciliation (13 October 2026)

Two historical branches remained after the integrity hardening release:

- `rebase/configuration-change-planning` at
  `c703f1a3457bdfb9b29ecff39370e04d3b78279c` was already an
  ancestor of `main`. It has no outstanding commits.
- `fix/audit-plan-and-migration-integrity` at
  `509dc0254880d5675723af48ed5a1e15f8c00485` belonged to
  [PR #295](https://github.com/NuBlox/NuBloxSQL/pull/295).
  The PR was closed without merging because merged PRs #294 and #296
  superseded its implementation. It must **not** be merged over current
  migration and lifecycle integrity code.

**Reconciliation completed and verified on 16 October 2026.** GitHub lists
only `main` as an active branch, and
`archive/superseded-pr-295-20261013` points to the preserved superseded
commit `509dc0254880d5675723af48ed5a1e15f8c00485`. The one-time workflow
checked pinned SHAs, ancestry, closed/merged PR lineage and archival evidence
before deleting those branch refs. Its definition remains recoverable from
repository history, but the workflow itself has been retired so routine pushes
to `main` no longer trigger a write-authorized branch-cleanup job.

No production source was overwritten by reconciliation. Never delete other
unmerged branches or local work merely because they appear stale.

## Every subsequent change

1. Check the repository default branch, rulesets, open PRs and surviving
   heads; compare any old branches with `main`.
2. Create a new task branch from current `main`.
3. Implement source, regression tests and authoritative documentation.
4. Pass applicable platform, dialect, security and package/release checks.
5. Squash-merge a green PR into `main`; verify the new main SHA and source.
6. Verify the merged head branch was removed automatically and no obsolete
   work was silently discarded.
7. Give exact local Mac commands to synchronize, build and run. **A connected
   GitHub repository does not reveal the user's local working-tree status**,
   so local changes must be checked before switching branches.

## Administrator protection still required

As checked on 16 October 2026, `main` remains **unprotected** and no
repository rulesets were returned. An owner must enable a ruleset requiring
pull requests and successful required checks, with bypass limited to trusted
recovery administrators. Repository CI alone cannot prevent a direct push.
See GitHub **Settings → Rules → Rulesets → New branch ruleset**, targeting
`main`; verify enforcement using a non-admin test branch/pull request.
