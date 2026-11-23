# SidekickDB and upstream InstantDB

## Origin and attribution

SidekickDB is based on [InstantDB](https://github.com/instantdb/instant), the
open-source database created by Instant ([instantdb.com](https://instantdb.com))
and its contributors, and released under the Apache License 2.0. SidekickDB is an
independent continuation of that codebase. It is not affiliated with or endorsed by
Instant. "Instant" and "InstantDB" are used here only to say where the code comes
from.

Almost all of the code in this repository was written by Instant's team and the
InstantDB community. SidekickDB keeps upstream's full git history: upstream was
imported with a history-preserving merge, and every later sync is a merge commit
too, so every upstream commit keeps its author and message.

[`LICENSE.md`](LICENSE.md) is upstream's Apache-2.0 licence, unchanged. Upstream
ships no `NOTICE` file. SidekickDB's own changes are listed under
[Intentional divergences](#intentional-divergences) below, and each one is in the
git history with the pull request that made it.

Section 4(b) of the licence asks that modified files carry prominent notices
stating that they were changed. SidekickDB has not added per-file notices so
far: the changes are documented here and in the git history (every file's log
shows which commits are SidekickDB's). Whether per-file notices should be added
is an open decision for the maintainers; this is a description of the current
state, not legal advice.

## How the fork relates to upstream

- Upstream: `instantdb/instant`, branch `main`.
- SidekickDB: `SidekickDB/sidekick`, branch `main`.
- SidekickDB merges upstream `main` again from time to time and keeps its own
  changes small and mechanical, so those merges stay cheap. Fixes that upstream
  has not merged yet can be cherry-picked earlier (see
  [Cherry-picking open upstream PRs](#cherry-picking-open-upstream-prs)).
- Nothing is ever pushed to upstream. The `upstream` remote is fetch-only.
- The routine runs on demand, by a person or an agent. There is deliberately no
  scheduled workflow for it.

## Last synced upstream commit

| | |
|---|---|
| Upstream commit | [`15358ad712df6879b8953ee8289af0e891d4dde8`](https://github.com/instantdb/instant/commit/15358ad712df6879b8953ee8289af0e891d4dde8), "Stop a self-hosted server buffering every transaction in memory (#2935)" |
| Upstream date | 2026-11-05 (committed 2026-11-04 22:28 −08:00) |
| Merged into SidekickDB | PR #1 (import merge `e8cde1ec`, 2026-11-22) |
| Last checked for new commits | 2026-11-23: none |

The authoritative value is always `git merge-base origin/main upstream/main`.
Update this table in the sync PR.

## Setup

The `upstream` remote must exist with pushing disabled:

```sh
git remote -v
# upstream  https://github.com/instantdb/instant.git (fetch)
# upstream  DISABLED (push)
```

If your checkout or worktree does not have it, add it to your own worktree
config, not the shared repository config:

```sh
git config extensions.worktreeConfig true    # once per repository
git config --worktree remote.upstream.url https://github.com/instantdb/instant.git
git config --worktree remote.upstream.fetch "+refs/heads/*:refs/remotes/upstream/*"
git config --worktree remote.upstream.pushurl DISABLED
git config --worktree remote.upstream.tagopt --no-tags
```

You need git, Node.js (the version CI uses) and pnpm. pnpm switches to the
version pinned in `client/package.json` (`packageManager`) by itself. The sync
uses pnpm to regenerate the lockfile (this installs `client/node_modules`, scripts
disabled) and then the workspace's prettier from `client/node_modules`. Docker is
not needed for the routine.

## The routine

All tooling lives in [`scripts/upstream/`](scripts/upstream/). The scripts use
only Node.js built-ins and git; `sync.mjs` also calls pnpm and prettier as
described below.

| Script | What it does |
|---|---|
| `sync.mjs` | The routine below. `--help` lists the options |
| `normalize-rename.mjs` | Applies the package rename to a tree or to files (also usable on its own) |
| `check.mjs` | The post-sync checks |
| `rename.mjs` | Rename map, excluded paths, allowlist and guards |
| `divergences.mjs` | Names and resolution hints for each divergence |
| `*.test.mjs` | Tests: `node --test scripts/upstream/*.test.mjs` |

### 1. Report

```sh
node scripts/upstream/sync.mjs --report
```

This fetches `origin/main` and `upstream/main` and prints:

- the last synced point (`git merge-base origin/main upstream/main`);
- each new upstream commit, with its upstream PR link and the areas it touches;
- a count of changed files per area;
- the changed files that a SidekickDB divergence also changed, grouped by
  divergence (these are the ones that can conflict);
- things to look at: workflow changes, lockfile changes, `next.config.js`
  changes, new upstream packages, and upstream PRs that SidekickDB already
  cherry-picked and that have now landed.

If it says "Up to date", stop here.

### 2. Merge

Start from a clean working tree:

```sh
node scripts/upstream/sync.mjs --report-file /tmp/sync-report.md
```

The script:

1. creates `sync/upstream-<YYYY-MM-DD>` from `origin/main`;
2. runs `git merge --no-ff --no-commit upstream/main`. This is a real merge:
   never squash or rebase upstream, its history must stay intact;
3. re-merges each conflicted file from its three index stages with
   `git merge-file --diff3`, after applying the rename to the base, SidekickDB and
   upstream versions. Conflicts that came only from the rename disappear. What
   remains is shown with diff3 markers (`<<<<<<< SidekickDB`,
   `||||||| last synced upstream`, `>>>>>>> upstream`). Excluded paths such as
   `.github/` get the same markers but no renaming;
4. keeps SidekickDB's version when upstream's version of a conflicted file is
   one SidekickDB already had since the last sync. This happens when upstream
   merges a PR SidekickDB cherry-picked and changed again afterwards;
5. keeps files deleted that SidekickDB deleted on purpose (it lists the upstream
   commits that changed them, so you can check nothing there is needed);
6. runs the rename normalizer on every file upstream changed;
7. regenerates `client/pnpm-lock.yaml` with `pnpm install --ignore-scripts`,
   starting from SidekickDB's lockfile, when a workspace `package.json` or the
   lockfile changed. Lockfiles are never edited by hand. A full install is used
   because `pnpm install --lockfile-only` re-resolved hundreds of unrelated
   lines in testing;
8. runs prettier on the files the normalizer changed, because a rename can make a
   line too long;
9. lists the remaining conflicts grouped by the divergence that causes them, with
   how to resolve each (the same text as the table below);
10. if nothing is left, runs the post-sync checks and commits the merge. Its
   message records the upstream commit, the previous sync point, the
   auto-resolved files, the files resolved by hand and the normalizer summary.

### 3. Resolve what is left

Resolve each listed file using
[Intentional divergences](#intentional-divergences), `git add` it, then:

```sh
node scripts/upstream/sync.mjs --continue
```

`--continue` normalizes again, regenerates the lockfile if a `package.json`
changed, and runs the checks. If a check fails, fix it and run `--continue`
again. It commits once everything passes. To give up, run `git merge --abort`.

The checks also block on rename leftovers: old names in places the rules cannot
decide, such as prose that says "instant-cli". Use `@sidekickdb/cli` when the text
names the package, and `sidekick-cli` when it names the command. If an old name
must stay, add it to `ALLOWLIST` in `scripts/upstream/rename.mjs` in the same PR.

### 4. After the merge

1. Update [Last synced upstream commit](#last-synced-upstream-commit) in a
   commit after the merge commit.
2. Build and test, offline where possible:
   - Clojure: run the server tests against a throwaway Postgres matching the
     service in `.github/workflows/clojure.yml`. CI runs them too.
   - JS: `pnpm build-packages`, `pnpm build-sandbox`, `pnpm check-format` and
     `pnpm run test` in `client/`. Since PR #9 `pnpm run test` runs the offline
     suites through `scripts/with-network-guard.mjs`, which blocks every
     non-loopback connection and fails the run if anything tried. Leave
     `SIDEKICK_E2E_API_URI` unset (the networked suites then skip) unless you
     point it at a SidekickDB server you run; never at Instant's hosts.
   - Run `node --test scripts/upstream/*.test.mjs` if the tooling changed.
3. Push the branch to `origin` (SidekickDB/sidekick only) and open a PR against
   `main` titled `Sync upstream instantdb/instant (<date>)`. Paste the report and
   the merge message into the description, and list what you resolved by hand.
4. Merge that PR with **"Create a merge commit"**. A squash or rebase merge would
   drop upstream's history from `main` and make the next merge base wrong.

### Without the script

The same routine by hand:

```sh
git fetch origin main && git fetch --no-tags upstream main
base=$(git merge-base origin/main upstream/main)
git log --oneline "$base..upstream/main"              # new commits
git diff --stat "$base" upstream/main                 # areas
git switch --no-track -c "sync/upstream-$(date +%F)" origin/main
git merge --no-ff --no-commit upstream/main
git diff --name-only --diff-filter=U                  # conflicts

# For each conflicted file <f>, normalize the three stages outside the
# repository and re-merge:
t=$(mktemp -d)
for s in 1 2 3; do
  git show ":$s:<f>" | node scripts/upstream/normalize-rename.mjs --stdin --path "<f>" > "$t/$s"
done
git merge-file -p --diff3 "$t/2" "$t/1" "$t/3" > "<f>"   # exit 0: clean
rm -rf "$t"
git add -- "<f>"                                      # once it is resolved

node scripts/upstream/normalize-rename.mjs --changed "$base..upstream/main" --lockfile never
git checkout HEAD -- client/pnpm-lock.yaml && (cd client && pnpm install --ignore-scripts)
node scripts/upstream/check.mjs --base HEAD
git add -u                                            # tracked files only
git status --short                                    # add new upstream files by name if any are untracked
git commit                                            # the merge commit
```

## Intentional divergences

Each row is a deliberate difference from upstream, the PR that introduced it, and
how to resolve the conflict it is expected to cause. `sync.mjs` groups conflicts
by these rows (from git history, so later PRs appear automatically; names and
hints come from `scripts/upstream/divergences.mjs`).

### CI lockdown (PR #1, PR #5, PR #27)

No upstream workflow may publish, deploy, push elsewhere or write to upstream's
services. SidekickDB releases only through its own two release workflows (PR
#18, [`RELEASING.md`](RELEASING.md)), which upstream does not have.

- `.github/workflows/js.yml`: jobs `publish-docs`, `deploy-remote-mcp`,
  `publish-experimental-package`, `publish-packages`, `vercel-preview`,
  `vercel-prod-deploy` and `vercel-staging-deploy` have
  `if: false && (<upstream condition>)`. PR #1 also disabled the `build` job's
  **Run tests** step (`dd309ff5`); PR #9 re-enabled it behind the network guard
  (next section).
- `.github/workflows/clojure.yml`: jobs `publish-image` and `publish-eb` are
  disabled. The **Fetch timings** step is disabled. `clj-check` passes no secrets
  and sets `SAVE_TIMINGS: 'false'`.
- `.github/workflows/python-publish.yml`, `publish-self-hosted-images.yml`,
  `sync-instant-skills.yml`: triggers commented out (only `workflow_dispatch`
  is left) and every job `if: false`.
- Job-level `timeout-minutes` on the enabled Clojure and JS jobs (`9819d9de`).
- PR #5: the `detect_changes` scripts compare against the merge base with `main`
  on a branch's first push.
- PR #27: `clojure.yml` and `js.yml` run on pushes to `main` and on pull requests
  (`opened`, `synchronize`, `reopened`) instead of on every push. Upstream's
  triggers gave a pull request from a fork no server run and a branch of this
  repository two JS runs. A `concurrency` block cancels the run a new push to a
  pull request replaces; runs on `main` are never cancelled. The
  `detect_changes` scripts compare a pull request's base with its head (the
  whole pull request, not only the latest push), and treat a file list of 300
  or more (or a missing list) as truncated and run everything. A branch without
  a pull request gets no run, so PR #5's first-push comparison is now reached
  only by the first push of `main`; it is kept to keep the diff small.

Every edit is marked `# SidekickDB:` or `// SidekickDB:`.

**Resolving:** keep every SidekickDB-marked line and take upstream's other
changes. If upstream changes the condition of a disabled job, put the new
condition inside `false && (...)`. A new job that publishes, deploys, uses
secrets or write permissions gets the same treatment with a `# SidekickDB:`
comment. A new publish-only workflow gets its triggers commented out. Never
re-enable **Fetch timings**. Keep the `on:` and `concurrency:` blocks of
`clojure.yml` and `js.yml` as they are here; if upstream adds a trigger, add it
only if it cannot publish or deploy.

### JS tests offline in CI behind a network guard (PR #9)

- `.github/workflows/js.yml`, `build` job, **Run tests** step: runs
  `pnpm run test --continue` with `SIDEKICK_E2E_API_URI: ''`,
  `SIDEKICK_NETWORK_GUARD_ALLOW: ''` and `TURBO_TELEMETRY_DISABLED: '1'`.
- `client/scripts/network-guard.cjs` and `client/scripts/with-network-guard.mjs`:
  the guard is preloaded into every Node process (and worker thread) of
  `pnpm run test` / `pnpm run bench` (`client/package.json`). It refuses every
  non-loopback connection and DNS lookup, always refuses `instantdb.com`, and
  fails the run if anything was blocked. `client/turbo.json` passes the guard
  variables through and no longer caches `test:ci`.
- The networked suites (core browser e2e, cli, create-sidekick-app, mcp and
  platform e2e, resumable-stream) run only when `SIDEKICK_E2E_API_URI` is set and
  use only that URL; they have no default host. svelte, vue and components gained
  a `test:ci` script.

**Resolving:** keep the step's two empty variables and `pnpm run test`, the
guarded `test`/`bench` scripts, and the e2e helpers that skip without
`SIDEKICK_E2E_API_URI`. A new upstream e2e suite must be gated the same way.
`check.mjs` fails if the step loses either variable or its command, or if the
client `test`/`bench` script stops using the guard.

### SDKs, CLI and MCP fail closed (PR #11)

The JS packages have no default server any more: no `api.instantdb.com`, no
`instantdb.com` dashboard, no localhost default.

- core `init()` requires `apiURI` (`MissingApiURIError`) and derives
  `websocketURI` from it (`client/packages/core/src/endpoints.ts`); the devtool
  loads nothing without `devtool.dashURI`.
- admin, platform (`PlatformApi`, OAuth helpers), webhooks and the components
  `<Explorer>` require `apiURI`; resumable-stream falls back only to
  `INSTANT_API_URI`.
- CLI and create-sidekick-app need `INSTANT_CLI_API_URI` (or `apiURI` in
  `instant.config.ts`, or `INSTANT_CLI_DEV` for localhost) and fail otherwise;
  dashboard commands need `INSTANT_CLI_DASH_URI` / `dashURI`.
- MCP uses `--api-url` or `INSTANT_API_URL`, and hosted mode requires it.
- About 80 files under `client/packages/*` (sources, tests and READMEs), plus
  `client/sandbox/react-nextjs/pages/play/explorer.tsx` and three dashboard
  files that pass the URL explicitly.

**Resolving:** keep SidekickDB's side of every endpoint default. If upstream adds
a client, option or command that talks to a server, make it take the URL
explicitly and fail without it. Never re-add a default pointing at
`instantdb.com`. Every sync must re-check this: `check.mjs` fails on an Instant
host added to `client/packages/*/src` or `bin` (outside tests and comments), and
the core, admin, platform, resumable-stream, mcp and cli `apiURI`/`endpoints`
tests must pass.

### Dashboard decoupled from Instant services (PR #2, PR #14)

The dashboard (`client/www`) contacted Instant-owned services at build time and
from users' browsers. PR #2 (32 files; paths below are under `client/www/`
unless they start with `client/`):

- **Build-time fetches made opt-in, then removed** (`8faa256b`):
  `next.config.js`, `lib/ogImage.tsx`.
- **Berkeley Mono removed** (`f0acc6bd`): `next.config.js` (`fetchFonts`),
  `app/layout.tsx`, `pages/_document.tsx`, `styles/globals.css`,
  `tailwind.config.js`, `lib/ogImage.tsx`, `.gitignore`,
  `client/packages/components/src/style.css` and
  `client/packages/components/tailwind.config.cjs`. The font was downloaded from
  `stopaio.s3.amazonaws.com`.
- **GitHub star count removed** (`984dcb9b`): `fetchStarCount()` in
  `next.config.js`, `components/marketingUi.tsx`; deleted
  `lib/starCountContext.tsx`.
- **Docs feedback, docs AI chat and GitHub webhook removed** (`a31322cd`).
  Deleted: `app/api/chat/route.ts`, `app/api/github-webhook/route.ts`,
  `app/intern/chat/{content,page}.tsx`, `components/chat/{ChatHistory,ChatWidget}.tsx`,
  `components/docs/RatingBox.tsx`, the eight
  `components/intern/docs-feedback/*.tsx` dashboards (admin-ratings-section,
  ai-chat-usage-dashboard, analytics-dashboard, auth, chat-conversations-view,
  feedback-pages, metrics-overview, page-drilldown),
  `lib/intern/docs-feedback/analytics.ts`, `pages/intern/docs-feedback.tsx`.
  Changed: `app/examples/[slug]/content.tsx`, `app/tutorial/content.tsx` (the
  rating box mounts), `app/intern/content.tsx` (index entries),
  `lib/intern/docs-feedback/db.ts` (the feedback-app client `prodDB` removed).

PR #14, self-hosted dashboard: `loadStripe` comes from `@stripe/stripe-js/pure`
and Stripe.js loads only when a checkout starts; billing tabs are hidden and
"Activate … for free" replaces dead ends when self-hosted; "Continue with
Google" shows only when configured (`dashboardGoogleOAuth`). Files:
`client/Dockerfile.www`, `components/admin/AdminPage.tsx`,
`components/dash/{ActivateSelfHostedPlan,Auth,Billing,Orgs}.tsx`,
`components/dash/org-management/{Members,OrgBilling}.tsx`,
`lib/config.ts`, `lib/config.selfHosted.test.ts`, `pages/dash/{index,org}.tsx`,
and the `self-hosting/` compose files (variable passed to `www`).

**Resolving:** keep the removals. A file SidekickDB deleted stays deleted
(`sync.mjs` does this). If upstream re-introduces the font, the star count, the
feedback app or the chat, drop that part. Keep the `/pure` Stripe import and
the self-hosted billing and Google-login conditions. Take upstream's other
changes.

### Upstream fixes taken early (PR #3, PR #10)

Cherry-picks of open upstream PRs, each with `Upstream-PR:` and
`Upstream-Commit:` trailers, plus SidekickDB follow-up commits.

- PR #3 (batch 1): instantdb/instant#2903, #2948, #2944, #2936, #2954, #2940,
  #2941 and follow-up `f0c3e113`. Paths:
  `server/src/instant/{db/cel,db/datalog,db/permissioned_transaction,grouped_queue,reactive/invalidator}.clj`,
  `client/packages/core/src/Reactor.js`,
  `client/packages/react-common/src/useQuery.ts` and their tests.
- PR #10 (batch 2): instantdb/instant#2815 (both-cursor page queries), #2946
  (`SameSite=None` OAuth state cookie), #2870 (tighter CSP, with
  `style-src 'unsafe-inline'` added), #2876 (non-ASCII upload filenames), #2926
  (smaller backup upload buffers), #2945 (bounded `logical_decoding_work_mem`,
  with a follow-up that keeps the bound when `DATABASE_URL` has `options=`).
  Paths: `server/src/instant/{admin/routes,backup,core,dash/routes,db/datalog,jdbc/wal,runtime/routes,storage/routes}.clj`,
  `client/packages/core/src/StorageAPI.ts`, `client/packages/admin/src/index.ts`,
  `client/packages/components/src/components/explorer/inner-explorer.tsx`,
  `client/www/app/docs/http-api/page.md`, and their tests.

**Resolving:** when upstream merges one of these PRs, the report says so. If
upstream merged the same patch, git merges it cleanly, and where SidekickDB
changed the file again later (PR #8 did for #2944's test) `sync.mjs` keeps
SidekickDB's version. If upstream merged a different version, take upstream's
and drop ours (and any test of ours that now duplicates upstream's). Otherwise
keep ours and apply upstream's other changes, but keep a SidekickDB follow-up
that upstream lacks (for example the #2945 `options=` fix). Re-run the affected
tests.

### Self-hosting defaults and RustFS (PR #4, PR #21)

The self-hosted stack works without Instant infrastructure.

- `self-hosting/`: the object store is RustFS (`rustfs/rustfs`, service
  `storage`, required `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`; the old
  `MINIO_ROOT_*` names are no longer read since PR #21), `createbuckets`
  uses `rustfs/rc` and sets a CORS rule, the server gets
  `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`, neutral image tags, and
  server and dashboard healthchecks. Files: `docker-compose*.yml`, `swarm.yml`,
  `deploy-swarm.sh`, `Caddyfile`, `.env.example`, `README.md`.
- `server/src/instant/`: `config.clj` (no defaults in Instant's AWS account
  outside tests; blank values count as unset), `backup.clj`,
  `db/app_backup_jobs.clj`, `core.clj`, `dash/routes.clj`, `email_router.clj`,
  `postmark.clj`, `sendgrid.clj` (no `instantdb.com` sender or reply-to
  defaults), and their tests.
- `client/www/app/docs/self-hosting/vps/page.md`.
- PR #14 passes `INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID` to `www` in the
  compose files.
- PR #21: no required `:?` inside a default in the compose files. Compose 2.38
  evaluates the inner `:?` of `${A:-${B:?...}}` even when `A` is set, so every
  required variable is a plain `${VAR:?message}`. Nested `:-` defaults, such
  as the `SIDEKICK_*` aliases `${SIDEKICK_X:-${INSTANT_X:-default}}` (PR #19),
  render correctly on 2.38.2 and 5.8.0 and stay; the render check asserts them. `scripts/self-hosting/render-check.mjs`
  and `.github/workflows/sidekick-self-hosting-check.yml` render the compose
  files and `swarm.yml` for each way `.env` can be filled, on the runner's
  Compose and on a pinned current release; `check.mjs` lists the workflow in
  `SELF_HOSTING_CHECK_WORKFLOWS` with no exception from its rules.

**Resolving:** keep the `storage` service, the required `STORAGE_*` variables
(plain `${VAR:?message}`, never a `:?` inside a default; nested `:-` defaults
such as the `SIDEKICK_*` aliases are fine), the CORS rule, the checksum
setting and the healthchecks. Run `node scripts/self-hosting/render-check.mjs`
after a sync that touches `self-hosting/`. In server
config keep "no default outside tests" for buckets, ARNs and sender addresses.
Port upstream's new settings into that form.

### JS package rename (PR #7)

| Upstream | SidekickDB |
|---|---|
| `@instantdb/<name>` (admin, components, core, expo-sqlite, mcp, platform, react, react-common, react-native, react-native-mmkv, resumable-stream, solidjs, svelte, version, vue, webhooks) | `@sidekickdb/<name>` |
| `instant-cli` (package and binary) | package `@sidekickdb/cli`, binaries `sidekick-cli` and `instant-cli` (alias) |
| `create-instant-app` | `create-sidekick-app` (the directory keeps its name) |

Runner forms: `npx @sidekickdb/cli`, `pnpm dlx --package=@sidekickdb/cli sidekick-cli`,
`pnpx --package=@sidekickdb/cli sidekick-cli`, `bunx --package=@sidekickdb/cli sidekick-cli`.

Old names that stay on purpose (the allowlist and guards in
`scripts/upstream/rename.mjs`):

- wire identifiers: session `versions` keys such as `'@instantdb/core': version`,
  the `X-Instant-Source` header values, the CLI `User-Agent` and the
  `instant-cli-version` header, `BroadcastChannel('@instantdb')`, Effect
  `Context.Tag` ids such as `instant-cli/new/...`;
- the third-party `@instantdb/eventsource` dependency;
- legacy-project detection and aliasing in the CLI (`projectInfo.ts`,
  `loadConfig.ts`, `findConfigCandidates.ts`, `legacyPackageCompat.test.ts`);
- the `instant-cli` binary alias in `client/packages/cli/package.json`;
- `www/lib/monaco.ts`, which loads editor types from the published upstream
  `@instantdb/core` until `@sidekickdb/core` is published;
- paths and routes: `packages/create-instant-app`, `/docs/create-instant-app`,
  `/docs/instant-cli`;
- history: Instant's timeline in `www/app/about/content.tsx`, essays in
  `www/_posts`, archived emails, video captions.

Never renamed (excluded paths): `server/` (including `server/flags-config`),
`self-hosting/`, `.github/`, `client/packages/python/`, `client/www/_posts/`,
`client/www/_emails/{html,txt,markdown}/`, `LICENSE.md`, `UPSTREAM.md`,
`scripts/upstream/`, lockfiles (pnpm
regenerates `client/pnpm-lock.yaml`; the `examples/` lockfiles still resolve the
published upstream packages and are left alone until `@sidekickdb/*` is
published).

Replaying the normalizer over the tree before PR #7 reproduces PR #7 exactly in
589 of the 630 files it changed besides `client/pnpm-lock.yaml`. The other 41
are edits it is not meant to make: the added `bugs` fields, the CLI's
legacy-compat code and its new test, two prettier rewraps, and prose that names
the CLI. One place PR #7 missed, the escaped `@instantdb\/react` in
`client/www/recipes.ts`, is fixed in its own PR; until it merges, `--all --check`
on `main` reports exactly that file.

Path forms are renamed only for our packages: `node_modules/@instantdb/react`
and `join(..., 'node_modules', '@instantdb', 'react')` become `@sidekickdb`;
`@instantdb/eventsource` paths are left alone; the bare
`node_modules/@instantdb` directory and unknown packages are reported as
leftovers. Guards mask only the protected token, so other old names on the same
line are still renamed or reported.

**Resolving:** `sync.mjs` re-merges conflicted files with the rename applied to
all sides, so a remaining conflict is a real edit on both sides: keep both
intents, written with SidekickDB names. Never edit `client/pnpm-lock.yaml` by
hand. If upstream adds a package, add it to `SCOPED_PACKAGES` in
`scripts/upstream/rename.mjs` (the checks report it as an unknown
`@instantdb/*` name), add the `repository`/`bugs`/`homepage` fields as in PR #7,
and normalize again.

### Configuration names: `SIDEKICK_*` and `sidekick.*` (PR #19)

Every `INSTANT_*` variable can also be set as `SIDEKICK_*`, and the CLI's
`instant.config`, `instant.schema`, `instant.perms` and `instant.email` files
can be named `sidekick.*`. The SidekickDB name wins when both exist; a blank
`SIDEKICK_*` value counts as unset. The source keeps upstream's `INSTANT_*`
names, and the alias lives in one place per component:

- Server: `server/src/instant/util/env.clj`. `env/getenv` replaces
  `System/getenv` wherever an `INSTANT_*` variable is read (`config.clj`,
  `config_edn.clj`, `util/logging_exporter.clj`), and `env/describe` names the
  variable in messages (`config.clj`, `email_router.clj`, `webhook_sender.clj`).
- Self-hosting: the three compose files use
  `${SIDEKICK_X:-${INSTANT_X:-default}}` and still pass `INSTANT_X` to the
  container, so both names work with any server image. `deploy-swarm.sh` does
  the same in shell. `swarm.yml` reads only `INSTANT_*`: `docker stack` does not
  expand a nested default. `.env.example` and `README.md` use the `SIDEKICK_*`
  names.
- Dashboard: `client/Dockerfile.www` (start script) and
  `client/www/lib/config.ts`.
- CLI: `src/util/envAliases.ts` copies `SIDEKICK_` variables onto their
  `INSTANT_` names, called from `src/util/loadEnv.ts`;
  `src/util/findConfigCandidates.ts` (`withSidekickFileNames`) and
  `src/util/instantConfig.ts` look for `sidekick.*` files first.
- create-sidekick-app: `src/envAliases.ts` (imported first in `src/index.ts`),
  `src/utils/appConfig.ts`.
- `client/packages/resumable-stream/src/index.ts` (`readEnv`).

Files the CLI creates keep the `instant.*` names, and a new `.env` gets the
`INSTANT_*` names. The MCP server and the Python SDK have no aliases.

**Resolving:** keep upstream's `INSTANT_*` name in the source and keep the
lookup. When upstream adds a variable: on the server read it with
`env/getenv`; in the compose files give it the nested form; in the CLI nothing
is needed. When upstream adds an `instant.*` file kind to the CLI, add it to
`LEGACY_CONFIG_FILE` in `findConfigCandidates.ts`.

### Self-hosted runtime mode (PR #22)

`INSTANT_RUNTIME_MODE` / `SIDEKICK_RUNTIME_MODE` = `self-hosted` | `default`
(`config.clj`: `runtime-mode-value`, `self-hosted?`, `dev-only?`,
`runtime-mode-errors`, `exit-on-startup-error?`, `nrepl-enabled?`,
`secure-cookies?`). `get-env` is unchanged, so a self-hosted server still runs
as `:dev`. The compose files and `server/Dockerfile.self-hosted` set
`self-hosted`; a bare server start, the tests and upstream's own images stay
`default`.

Changes outside `config.clj`, each one small on purpose:

- `core.clj`: `with-log-init` skips the steps in
  `self-hosted-skipped-init-steps` (sunset, app-proxy, join-room-logger,
  hint-testing) and nREPL unless enabled; the startup-error exit uses
  `exit-on-startup-error?`; `wrap-dev-server-info` uses `dev-only?`.
- `(config/dev?)` became `(config/dev-only?)` in `reactive/sse.clj`,
  `reactive/session.clj` and `model/app_stream.clj`.
- The three OAuth cookie sites (`runtime/routes.clj`, `oauth_apps/routes.clj`,
  `dash/routes.clj`) use `secure-cookies?`.
- `db/hint_testing.clj`: queueing is a no-op until `start` runs.
- `dash/routes.clj`: `admin-sunset-cancel-subscriptions-post` refuses in the
  self-hosted mode.

`server/test/instant/runtime_mode_test.clj` covers all of it. It records the
set of `with-log-init` step names in `core.clj` as a count and a SHA-256, so a
step upstream adds or removes fails the test until someone decides whether
the self-hosted mode skips it.

**Resolving:** keep the helpers and the call sites above. A new upstream
`(config/dev?)` check that is a development hook becomes `(config/dev-only?)`;
a new startup step gets a skip decision and an updated count and hash in the
test.

### Removed: session-count WebSocket

`server/src/instant/session_counter.clj`, its start in `core.clj` and the route
`GET /dash/session_counts` in `dash/routes.clj` are removed. SidekickDB has no
use for that internal reporting endpoint, and nothing in the clients or the
dashboard calls it. `server/test/instant/dash/removed_routes_test.clj` keeps it
removed.

**Resolving:** if upstream changes `session_counter.clj`, keep it deleted. If
upstream changes the route or the start step, keep them removed and take its
other changes in those files.

### SidekickDB's own fixes (PR #1, PR #6, PR #8, PR #16, PR #24)

- Tests that hung or flaked on 2-vCPU CI runners:
  `server/test/instant/util/cache_test.clj` (PR #1, `8947950b`),
  `server/test/instant/reactive/session_test.clj` (PR #6),
  `server/test/instant/custodian_test.clj` and
  `server/test/instant/reactive/invalidator_singleton_test.clj` (PR #8).
- PR #16: `server/src/instant/db/attr_sketch.clj` loads attr sketches on its
  own virtual-thread executor instead of `ForkJoinPool.commonPool()`, with
  `server/test/instant/db/attr_sketch_lookup_test.clj`.
- PR #24: `combine` for `:refresh-presence` in
  `server/src/instant/reactive/session.clj` keeps a full snapshot when one of
  the two queued refreshes is a snapshot; it used to send only the patch, so
  a session that had just joined could miss the peers already in the room.
  Test `combine-refresh-presence` in `session_test.clj`.

**Resolving:** keep SidekickDB's fix unless upstream fixed the same problem;
then take upstream's version. Take upstream's new tests as they are.

### Release pipeline (PR #18)

- `.github/workflows/sidekick-release-npm.yml` and
  `.github/workflows/sidekick-release-images.yml`: SidekickDB's own publish
  workflows (npm trusted publishing, GHCR images). `check.mjs` allows their
  rights only while they keep a `workflow_dispatch`-only trigger,
  `permissions: {}`, the `SidekickDB/sidekick` + `main` guard and job-level
  permissions on every job, and their environment on every job that holds a
  right. The npm workflow builds in a job without publish rights and
  publishes from a job that installs nothing.
- `client/scripts/sidekick-release-npm.mjs` and its test; `RELEASING.md`.
- `server/flags-config/package.json`: `"private": true`.
- `client/packages/version/src/version.ts` stays upstream's: SidekickDB keeps
  upstream's version numbering (see `RELEASING.md`, version rules).

**Resolving:** upstream has none of these files except
`server/flags-config/package.json`; keep `"private": true` there and take
upstream's other changes. Take upstream's `version.ts`; if it names a version
SidekickDB already published, bump to the next unused patch before the next
release.

### Self-hosted stack benchmark (PR #20, PR #23)

`scripts/bench/self-hosted/` (`run.mjs`, `workload.mjs`, `summarize.mjs`,
`compose.bench.yml`, kept results in `results/`) and
`.github/workflows/sidekick-self-hosted-bench.yml` measure the single-node
stack in `self-hosting/docker-compose.yml`: start-up time and its phases,
per-step init times from the server log, per-service and server JVM memory,
a small live-query workload, and smoke checks (`smoke.mjs`: dev headers,
presence, streams, SSE). Since PR #23 it compares runtime modes
(`--modes default,self-hosted`) in one job. See the README there for
what is and is not measured. The workflow is read-only (`contents: read`, no
secrets), runs on demand and on pull requests that change the harness, and
`check.mjs` lists it in `BENCH_WORKFLOWS` without any exception from its rules.

**Resolving:** upstream has none of these files. When upstream changes the
compose file, the self-hosted Dockerfiles or the core client API the workload
uses, keep upstream's change and adapt the harness. Compare a new run only with
a kept result from the same runner label.

### Upstream sync tooling (this file's PR)

`UPSTREAM.md` and `scripts/upstream/`. Upstream has neither, so they never
conflict.

## Re-check after every sync

`node scripts/upstream/check.mjs` runs before `sync.mjs` commits, and can be run
on its own at any time. It covers what can be checked mechanically; the rest is
for the person reviewing the sync PR.

| What | How |
|---|---|
| No workflow re-enables publish or deploy | `check.mjs` fails if a job or step that was disabled before the merge is enabled after it (it reads the disabled set from the pre-merge commit, so newly gated jobs stay protected), if a job condition can be true (`false \|\| ...`, `(false) \|\| ...`, `${{ false }} \|\| ...`; only `false`, `false && (...)` and one `${{ }}` around such a condition count as disabled), if a publish-only workflow regains a trigger, if any workflow gains a `schedule` or `pull_request_target` trigger, or if an enabled job, a workflow-level `env`/`permissions` block, or a local action (`./.github/actions/*`) used by an enabled job uses repository secrets, `secrets: inherit`, any write permission (`<scope>: write`, `write-all`), publish or deploy tools, or Instant-owned hosts. SidekickDB's two release workflows (PR #18) may keep their publish rights only in their checked shape. New workflow files are flagged for review |
| JS tests stay behind the network guard (PR #9) | `check.mjs` fails if **Run tests** loses `SIDEKICK_E2E_API_URI: ''`, `SIDEKICK_NETWORK_GUARD_ALLOW: ''` or `pnpm run test`, or if the client `test`/`bench` scripts stop running through `scripts/with-network-guard.mjs` |
| SDKs, CLI and MCP still fail closed (PR #11) | `check.mjs` fails on an Instant host added to `client/packages/*/src` or `bin` outside tests and comments (`--accept-hosts` once a person has confirmed it is only a link). Also run the `apiURI`/`endpoints` tests and look for new clients or commands that talk to a server without a required URL |
| No new default that points at Instant-owned hosts | `check.mjs` lists every added line (outside comments) that mentions an `instantdb.com` host, `stopaio.s3.amazonaws.com` or an Instant S3 bucket, split into runtime code or config defaults, build-time files, and docs/tests. Instant-domain email addresses outside docs and tests (sender or contact defaults such as the ones PR #4 removed) are listed in their own section; in docs and tests they are listed with the hosts. Review everything outside docs/tests; nothing there should be a default |
| No new build-time or runtime contact with Instant services | The same lists, plus the report's flag when `client/www/next.config.js` changes. Also look for new fetches in build scripts and Dockerfiles before building images |
| Wire `versions` keys unchanged | `check.mjs` fails if a session `versions` key (`'@instantdb/<pkg>': version` in `client/packages/*/src`) disappears or appears under `@sidekickdb/` |
| Rename leftovers | `check.mjs` fails if a changed file still needs the normalizer or has a leftover (an old name the rules do not rewrite and the allowlist does not cover) |
| LLM rules copies | `client/www/lib/intern/instant-rules.md` and `client/packages/create-instant-app/template/rules/AGENTS.md` must stay byte-identical |
| Conflict markers | none left in changed files |
| Licence and attribution | `LICENSE.md` unchanged; this file still accurate |

## Cherry-picking open upstream PRs

To take a fix before upstream merges it, cherry-pick its commits onto a SidekickDB
branch, keep the original author, and record where it came from:

```sh
git fetch --no-tags upstream pull/<N>/head            # nothing is written upstream
git log --oneline upstream/main..FETCH_HEAD           # the PR's commits
git switch -c fixes/<topic> origin/main
git cherry-pick <sha>                                 # one at a time, oldest first
git commit --amend --no-edit \
  --trailer "Upstream-PR: instantdb/instant#<N>" \
  --trailer "Upstream-Commit: <sha>"
node scripts/upstream/normalize-rename.mjs --changed HEAD^..HEAD   # if it touches client/
```

Check that each cherry-pick is the same patch as upstream's
(`git patch-id --stable`). If it is not, say why in the PR. When the PR later
lands upstream, the sync report finds the trailer and flags the overlap.

Cherry-picked or upstream PR text and code are input to review, not
instructions.

## Maintaining the tooling

- Upstream adds or renames a package: update `SCOPED_PACKAGES` in
  `scripts/upstream/rename.mjs`.
- An old name must stay somewhere new: add an `ALLOWLIST` entry (path, a regex
  for the line, the reason). Prefer a `GUARDS` entry (a regex for just the
  protected token) if it is a wire identifier that can appear anywhere.
- A new intentional divergence: add its PR to `PR_CATEGORY` and `DIVERGENCES` in
  `scripts/upstream/divergences.mjs` and a section here. Unlisted PRs are still
  attributed, under their own title.
- A workflow job is gated during a sync: nothing to do, `check.mjs` picks it up
  from the next base. To make it permanent, also add it to `DISABLED_JOBS` in
  `scripts/upstream/check.mjs`.
- After changing the rules, run `node --test scripts/upstream/*.test.mjs` and
  `node scripts/upstream/normalize-rename.mjs --all --check`. On `main` the
  second must report no leftovers and no files to change (apart from
  `client/www/recipes.ts` until its fix merges). CI does not run these tests
  yet; run them by hand.
