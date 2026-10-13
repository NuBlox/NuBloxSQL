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

The narrowly scoped
[`reconcile-obsolete-branches.yml`](../../.github/workflows/reconcile-obsolete-branches.yml)
workflow performs this reconciliation with `contents: write` only on the
trusted repository `main` branch. The workflow checks **exact expected commit
SHAs**. For the ancestor branch it verifies Git ancestry. For the superseded
branch it checks the closed PR and the merged replacement PR lineage, then
creates the immutable archival tag
`archive/superseded-pr-295-20261013` **before** deleting the branch ref.
Any failed qualification or changed head preserves the branch. The workflow
is safe to repeat; after cleanup it finds neither branch.

The archival tag preserves the superseded branch commit for later audit,
without leaving another active branch. No production source is overwritten by
the cleanup.

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

As of this reconciliation, `main` is **not protected** by GitHub rulesets.
An owner must enable a ruleset requiring PRs and successful required checks;
repository workflow checks alone do not prevent a direct push.
