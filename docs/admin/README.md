# GitHub administrator — branch protection

**Status (16 October 2026): ACTIVE AND VERIFIED BY GITHUB; new runtime check upgrade pending.** The repository administrator installed [main ruleset #25231727](https://github.com/NuBlox/NuBloxSQL/rules/25231727) and [legacy archive ruleset #25231728](https://github.com/NuBlox/NuBloxSQL/rules/25231728). Both report `enforcement=active`, exact branch targets, no bypass actors, and `protected=true`. The owner's first verification run exposed a false-negative caused by GitHub omitting the default `update` rule parameters; this script now handles that response. Re-run read-only `verify` to validate the complete path from the Mac.

## Rules being installed

- [Main ruleset](ruleset-main.json): exact branch `main`, PR required, both always-triggered `docs` and `Node 24 — Driver and Shell` checks required, strict up-to-date checks, disallow deletion and force pushes. Zero review approvals allows solo development via PR.
- [Archive ruleset](ruleset-archive.json): exact branch `archive/legacy-implementation-2026-10-16`, reject ordinary updates, force pushes and deletion. Pinned archived head `4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c`.
- Neither ruleset grants actor exemptions. An administrator can manually edit/disable a rule in a genuine emergency.

## Execute once on the Mac with GitHub administrator access

~~~bash
cd "$HOME/Sites/NuBlox_Development/NuBloxSQL"
git status --short
# Preserve any local uncommitted changes before the next commands.
git fetch --prune origin
git switch main
git pull --ff-only origin main
command -v gh >/dev/null || brew install gh
gh auth status || gh auth login
bash docs/admin/protect-repository.sh apply
~~~

The installer uses GitHub CLI's authenticated REST API, requires repository admin access, validates the archive SHA and the most recent green `docs` CI check, creates only absent *named* rulesets and verifies both exact rulesets and GitHub's **effective branch rules**. It cannot silently modify an existing mismatched ruleset. Both rulesets already exist; **run `verify` (not `apply`) for subsequent confirmation**. GitHub may omit an `update` rule's `parameters` when the optional upstream fetch-and-merge setting is false; that absence is a safe default, not evidence the archive lacks protection.

## Upgrade main after the first private Driver/Shell implementation

GitHub's live main ruleset was originally created when only the `docs` check existed. The new Node 24 build, unit tests and live PostgreSQL 17 job passed after PR #339, but are **not yet enforced as a required check** until the repository owner explicitly upgrades the rule.

After updating `main` on your Mac, run:

~~~bash
bash docs/admin/protect-repository.sh upgrade-main
bash docs/admin/protect-repository.sh verify
~~~

`upgrade-main` requires a successful Node check on current `main`, verifies both existing active rule targets and no-bypass policies, and only updates the known old `docs`-only required-status rule. It refuses to overwrite unknown changes. It does **not** alter the archive. Subsequent runs are read-only if both checks are already required.

## Verify without changing anything

~~~bash
bash docs/admin/protect-repository.sh verify
gh api repos/NuBlox/NuBloxSQL/rulesets --jq '[.[] | {id,name,enforcement}]'
~~~

The script requires no Python or standalone jq on the Mac. If GitHub CLI denies access, use `gh auth login` for the NuBlox owner account with administration privileges. The integration in ChatGPT cannot create rulesets and therefore cannot complete this part remotely. Never share an authentication token.

GitHub live state already confirms **both branches protected** and both active rulesets' no-bypass policies. The verifier checks effective GitHub rules without attempting destructive updates. Behavioural negative tests (rejected direct push, archive write, and failed-`docs` PR) remain optional defence-in-depth evidence; do not run unsafe mutations against the actual archive. Record verification of the new script in [issue #328](https://github.com/NuBlox/NuBloxSQL/issues/328).

The `docs` check applies to this documentation-only reset. Before restoring implementation runtime and live database tests, update the main ruleset's required checks to match the always-running new build/security workflows. GitHub [rulesets documentation](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset) identifies the `Administration: write` requirement.
