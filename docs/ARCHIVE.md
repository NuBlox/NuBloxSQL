# Preserved implementation archive and recovery

## What was preserved?

Before the documentation-first reboot, the complete repository was captured as a separate Git branch:

- **Archive ref:** `archive/legacy-implementation-2026-10-16`
- **Commit:** `4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c`
- **Tree:** `d4cf114ac07cd3128eab645beb6f9721ef62c920`
- **Verified source files:** 635 blobs in the tracked legacy tree
- **Contents:** the previous Driver, Shell, Workbench, tests, releases, workflows, product/architecture docs and database-profession register

[Browse archived source](https://github.com/NuBlox/NuBloxSQL/tree/archive/legacy-implementation-2026-10-16).

The archive was verified against the original main SHA **before any reset**. Because it is a Git branch rather than an enforced immutable tag, repository administrators should protect it against deletion and force pushes. Its historic commit remains accessible from Git history even after the default branch advances.

## Inspect on your Mac without rewriting main

~~~bash
cd "$HOME/Sites/NuBlox_Development/NuBloxSQL"
git fetch origin
git show origin/archive/legacy-implementation-2026-10-16:package.json
git show origin/archive/legacy-implementation-2026-10-16:docs/product/BLUEPRINT.md
git diff --stat main origin/archive/legacy-implementation-2026-10-16
~~~

If you need a local read-only working branch for legacy investigations:

~~~bash
git switch -c inspect/legacy-2026-10-16 origin/archive/legacy-implementation-2026-10-16
# Inspect; do not push changes to the archive branch.
git switch main
~~~

## Restoring selected work

Restore **individual files or ideas onto a new feature branch**, only after requirements and validation criteria are agreed. Copying everything from the archive back onto main would recreate the same problem. Do not force-reset main to the archive.

## Existing public packages and legal history

Earlier npm v1 artefacts, release records and historical licence grants are not revoked or replaced by this documentation reset. The new default branch deliberately has **no package manifest and no publishing workflow**, so it cannot be mistaken for a functioning new release. The exact historical licence remains in this repository's LICENSE.

## Branch-protection installer

The [GitHub administrator procedure](admin/README.md) provides two exact ruleset manifests and a verification script for `main` and this archive. The script must be run through the repository owner's admin-authenticated GitHub CLI session. **Committing the installer is not evidence of live GitHub protection.** See [issue #328](https://github.com/NuBlox/NuBloxSQL/issues/328).

## Future archive hardening

The repository owner should configure ruleset protection for `main` and `archive/legacy-implementation-2026-10-16`, then ideally add an annotated archival tag using local Git once its target SHA is verified. Do not delete the archive to make the branch list look empty: the archive is intentionally retained.
