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
ships no `NOTICE` file. SidekickDB adds its own [`NOTICE`](NOTICE), which names
the original work and says that files were changed. SidekickDB's own changes
are listed under [Intentional divergences](#intentional-divergences) below, and
each one is in the git history with the pull request that made it.

Section 4(b) of the licence asks that modified files carry prominent notices
stating that they were changed. SidekickDB has not added per-file notices so
far: `NOTICE` says that files were changed, the intentional changes are
documented here, and every change is in the git history (every file's log
shows which commits are SidekickDB's). Some changes carry a `SidekickDB:`
comment; most changed files carry no marker, including every file changed only
by the package or configuration rename. Whether per-file notices should be
added is an open decision for the maintainers; this is a description of the
current state, not legal advice.

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
| `divergences.mjs` | Loads the divergences and attributes changed paths to them |
| `divergences/<key>.mjs` | Title and resolution hint of one divergence |
| `divergence-prs/<PR number>` | Which divergence a PR belongs to, one file per PR |
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
hints come from `scripts/upstream/divergences/<key>.mjs`). The PR numbers of
each row are files in `scripts/upstream/divergence-prs/`, not in the headings
below, so that two open PRs do not edit the same line.

### CI lockdown

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
- PR #54: `clojure.yml` has a job `clj-check-result` that always runs and
  fails unless the `clj-check` matrix passed or was skipped. The ruleset on
  `main` requires it; the matrix itself reports under a different name per
  shard and cannot be required.
- PR #71: `js.yml` Actions cache, kept under the repository's 10 GiB limit: the
  `build` job restores the turbo cache and saves it (**Save turbo build
  setup**) on `main` only, so pull requests write none; it prunes and saves
  the pnpm store only when the restore missed (step `id: pnpm-cache`). A new
  job `prune-turbo-cache` runs after `build` on `main` and deletes the
  `Linux-turbo-*` entries on `refs/heads/main` created before this commit's.
  It is the one enabled job in `js.yml` with a write right
  (`actions: write`); `scripts/upstream/check.mjs` (`JOB_RIGHTS`) allows it
  only while the job is guarded to `main` and has nothing but a fixed set
  of job and step keys, which leaves no way to use an action, a container
  or another job's steps (YAML anchors and aliases are refused). The
  `check_formatting` job's turbo step is removed (it never creates
  `client/.turbo`). The disabled jobs keep upstream's turbo steps.

Every edit is marked `# SidekickDB:` or `// SidekickDB:`.

**Resolving:** keep every SidekickDB-marked line and take upstream's other
changes. If upstream changes the condition of a disabled job, put the new
condition inside `false && (...)`. A new job that publishes, deploys, uses
secrets or write permissions gets the same treatment with a `# SidekickDB:`
comment. A new publish-only workflow gets its triggers commented out. Never
re-enable **Fetch timings**. Keep the `on:` and `concurrency:` blocks of
`clojure.yml` and `js.yml` as they are here; if upstream adds a trigger, add it
only if it cannot publish or deploy. If upstream changes the `build` job's
turbo or pnpm cache steps, keep the restore/save split, the `main`-only save
and `prune-turbo-cache`; if it renames `build`, update that job's `needs`.

### JS tests offline in CI behind a network guard

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
- `.github/workflows/sidekick-checks.yml` (PR #70): on every pull request and
  push to `main`, runs `node --test scripts/upstream/*.test.mjs`,
  `node scripts/upstream/check.mjs --base HEAD^1` and a probe that fails unless
  the guard refuses outbound requests to reserved addresses. Upstream has no
  file with this name, and it gets no exception from `check.mjs`'s rules.

**Resolving:** keep the step's two empty variables and `pnpm run test`, the
guarded `test`/`bench` scripts, and the e2e helpers that skip without
`SIDEKICK_E2E_API_URI`. A new upstream e2e suite must be gated the same way.
`check.mjs` fails if the step loses either variable or its command, or if the
client `test`/`bench` script stops using the guard.

### SDKs, CLI and MCP fail closed

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

### Dashboard decoupled from Instant services

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

### Upstream fixes taken early

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
- PR #32: instantdb/instant#2937 (IndexedDB missing or failing to open no
  longer throws, fixes instantdb/instant#2779; no `.at()` in infinite queries).
  Paths: `client/packages/core/src/{IndexedDBStorage,infiniteQuery,utils/PersistedObject}.ts`
  and `client/packages/core/__tests__/src/utils/PersistedObject.test.ts`.
- PR #35: instantdb/instant#2953 (a permission check fetches, and so
  subscribes to, only the fields its rules read plus `id`; fixes
  instantdb/instant#2951). Paths:
  `server/src/instant/{db/cel,db/instaql,model/rule}.clj` and
  `server/test/instant/{db/cel,db/instaql,db/seeks_permission_helpers,reactive/session}_test.clj`.
  In `session_test.clj` only upstream's five new tests are added: the helpers
  above them are byte-identical to the ones #2954 (PR #3) already added.
- PR #52: instantdb/instant#2956 (the Explorer row editor keeps a number
  written with an exponent, such as `1e6`). Paths:
  `client/packages/components/src/components/explorer/edit-row-dialog.tsx`
  and its new test `explorer/__tests__/edit-row-dialog.test.ts`. Upstream's
  `test:ci` script in `client/packages/components/package.json` is left out:
  SidekickDB already has it (higher up in `scripts`). When upstream merges
  #2956, keep a single `test:ci` there.
- PR #80: instantdb/instant#2943 (after a local write, or a rejected or
  timed-out mutation, notify only the live queries the write can affect;
  fixes instantdb/instant#2942). Paths:
  `client/packages/core/src/{Reactor.js,notifyScope.ts}` and
  `client/packages/core/__tests__/src/notifyScope.test.ts`. In
  `_cleanupQuery`, `this._queryFootprints.delete(hash)` sits after the
  `_dataForQueryMemo` deletes from #2940: keep both lines.

**Resolving:** when upstream merges one of these PRs, the report says so. If
upstream merged the same patch, git merges it cleanly, and where SidekickDB
changed the file again later (PR #8 did for #2944's test) `sync.mjs` keeps
SidekickDB's version. If upstream merged a different version, take upstream's
and drop ours (and any test of ours that now duplicates upstream's). Otherwise
keep ours and apply upstream's other changes, but keep a SidekickDB follow-up
that upstream lacks (for example the #2945 `options=` fix). Re-run the affected
tests.

### Self-hosting defaults and RustFS

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
- PR #13: no well-known credentials. `POSTGRES_PASSWORD`,
  `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` are required in
  `docker-compose.yml`, `docker-compose.with-caddy.yml` and `swarm.yml` (no
  `pass` or `rustfsadmin` fallback), `.env.example` leaves them blank, and
  `deploy-swarm.sh` requires its secrets and URLs from the environment
  (no `changeme` placeholders). `docker-compose.local.yml` keeps its
  defaults and binds every port to `127.0.0.1`. The server gets
  `mem_limit: ${SERVER_MEMORY_LIMIT:-2g}` (a memory limit in `swarm.yml`)
  and a default `JAVA_OPTS` (`-XX:MaxRAMPercentage=60` plus the two native
  memory flags upstream set in `server/docker-compose.yml`).
- PR #13, server: `auth/jwt.clj` and `auth/oauth.clj` prefetch Google's JWKS
  and discovery document at boot only when
  `config/dashboard-google-oauth-configured?`; both still fetch on first use.
  `config.clj` reads `INSTANT_DNS_OVER_HTTPS_URLS` (`parse-dns-over-https-urls`:
  a comma-separated list of DoH endpoints, or `system`; unset means Cloudflare
  and Google; an invalid value fails at startup). `webhook_sender.clj` takes
  its resolvers from that setting; a failed DoH lookup never falls back to the
  system resolver, which is used only with `system`. Tests in `jwt_test.clj`,
  `oauth_test.clj`, `config_test.clj` and `webhook_sender_test.clj`.
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
- Postgres is not published beyond the host: `docker-compose.yml` binds port
  8890 to `${POSTGRES_BIND_ADDRESS:-127.0.0.1}` and `swarm.yml` has no
  published port (swarm ignores a host address). Upstream publishes
  `8890:5432` on all interfaces in both.
- PR #34: the development stack `server/docker-compose-dev.yml` publishes
  Postgres (8890), the server (8888) and nREPL (6005) on `127.0.0.1` only.
  `NREPL_BIND_ADDRESS` stays `0.0.0.0` inside the container so the published
  port reaches nREPL. Upstream publishes all three on all interfaces.
- PR #36: the step 1 `pg_dump` in `UPGRADE_DB.md` reads `POSTGRES_USER` and
  `POSTGRES_DB` from the container, like steps 3 and 4. Upstream hard-codes
  `-U instant` and the database `instant`. The intro paragraph says nothing
  needs substituting, and the step 2 comment no longer names the database
  `instant`.
- PR #43: the compose files, `swarm.yml` and `.env.example` default to
  `ghcr.io/sidekickdb/{server,dashboard,postgresql}` instead of
  `ghcr.io/instantdb/*`, and the Postgres service of
  `.github/workflows/clojure.yml` uses `ghcr.io/sidekickdb/postgresql`.
- `deploy-swarm.sh` runs under bash with `set -euo pipefail`, passes every
  variable `swarm.yml` reads (one list, `STACK_VARS`; upstream passed a few and
  dropped email, S3, Postgres user and database and the rest), and renders
  before it connects. Before deploying it checks over ssh that the external
  secret `server_config` exists and otherwise stops with the commands to
  create it once; it never creates or replaces it. `README.md` documents the
  secret. `scripts/self-hosting/deploy-swarm.test.mjs` (run by
  `sidekick-self-hosting-check.yml`) runs the script with stand-ins for
  `docker` and `ssh` and fails when `swarm.yml` reads a variable it does not
  pass.
- PR #84: the default weight limit of each app's datalog query cache in
  `reactive/store.clj` is `config/query-cache-max-bytes`, a quarter of the
  maximum heap, at most upstream's fixed 500 MiB, so it is smaller only on
  heaps under 2 GiB. `INSTANT_QUERY_CACHE_MAX_BYTES` sets it; an invalid value
  fails in `config/init`. The `:datalog-cache-max-weight` flag still wins.
  The compose files, `swarm.yml`, `deploy-swarm.sh`, `.env.example` and
  `README.md` carry the variable; tests in `config_test.clj`. If upstream
  changes that default, keep the call to `config/query-cache-max-bytes`.
- PR #94: the Postgres `command:` of the three compose files and `swarm.yml`
  ends with `-c jit=off` (`README.md`, "Postgres JIT"). Upstream leaves JIT
  on. `render-check.mjs` asserts the flag and the two-node smoke test fails
  unless the running Postgres answers `show jit` with `off`. At a sync, keep
  the flag; if upstream adds `-c` flags, add them next to it.

**Resolving:** keep the `storage` service, the required `STORAGE_*` variables
(plain `${VAR:?message}`, never a `:?` inside a default; nested `:-` defaults
such as the `SIDEKICK_*` aliases are fine), the CORS rule, the checksum
setting, the healthchecks and the unpublished Postgres port (127.0.0.1 in
`docker-compose.yml`, none in `swarm.yml`), the `127.0.0.1:` prefix on
every port in `server/docker-compose-dev.yml`, the `pg_dump` in
`UPGRADE_DB.md` that reads `POSTGRES_USER` and `POSTGRES_DB`, and the
`ghcr.io/sidekickdb` image defaults (if upstream changes an image tag, release
the same tag from SidekickDB first). Run
`node scripts/self-hosting/render-check.mjs`
after a sync that touches `self-hosting/`. In server
config keep "no default outside tests" for buckets, ARNs and sender addresses.
Port upstream's new settings into that form.
When upstream adds a variable to `swarm.yml`, add it to `STACK_VARS` in
`deploy-swarm.sh` (the test names it), and keep the `server_config` check.
Keep the required `POSTGRES_PASSWORD` and the memory and `JAVA_OPTS` defaults
(PR #13); if upstream changes its JVM flags in `server/docker-compose.yml`,
consider the same change in the default `JAVA_OPTS`. In `jwt.clj` and
`oauth.clj` keep the `dashboard-google-oauth-configured?` condition around the
boot prefetch and take upstream's other changes. In `config.clj` and
`webhook_sender.clj` keep `INSTANT_DNS_OVER_HTTPS_URLS` and keep a failed DoH
lookup final (no system fallback); if upstream changes the resolvers, port
the change into that form.

### JS package rename

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
`client/www/recipes.ts`, is fixed in PR #17 (its two regexes match
`@sidekickdb\/react`); since then `--all --check` on `main` reports no files.

Path forms are renamed only for our packages: `node_modules/@instantdb/react`
and `join(..., 'node_modules', '@instantdb', 'react')` become `@sidekickdb`;
`@instantdb/eventsource` is not renamed but reported wherever it appears (see
"Own copy of eventsource in admin"); the bare
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

### Configuration names: `SIDEKICK_*` and `sidekick.*`

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

### Self-hosted runtime mode

`INSTANT_RUNTIME_MODE` / `SIDEKICK_RUNTIME_MODE` = `self-hosted` | `default`
(`config.clj`: `runtime-mode-value`, `self-hosted?`, `dev-only?`,
`runtime-mode-errors`, `exit-on-startup-error?`, `nrepl-enabled?`,
`secure-cookies?`). `get-env` is unchanged, so a self-hosted server still runs
as `:dev`. The compose files and `server/Dockerfile.self-hosted` set
`self-hosted`; a bare server start, the tests and upstream's own images stay
`default`.

Changes outside `config.clj`, each one small on purpose:

- `core.clj`: `with-log-init` skips the steps in
  `self-hosted-skipped-init-steps` (app-proxy, join-room-logger,
  hint-testing) and nREPL unless enabled; the startup-error exit uses
  `exit-on-startup-error?`; `wrap-dev-server-info` uses `dev-only?`.
- `(config/dev?)` became `(config/dev-only?)` in `reactive/sse.clj`,
  `reactive/session.clj` and `model/app_stream.clj`.
- The three OAuth cookie sites (`runtime/routes.clj`, `oauth_apps/routes.clj`,
  `dash/routes.clj`) use `secure-cookies?`.
- `db/hint_testing.clj`: queueing is a no-op until `start` runs.
- `core.clj` `stop`: the WebSocket drain comes from
  `config/shutdown-drain-opts` when it returns one (self-hosted, 20 s, or
  `INSTANT_SHUTDOWN_DRAIN_SECONDS`), else upstream's `dev?` choice; covered by
  `shutdown_drain_test.clj`.

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

### Removed: wind-down (sunset) stage

Upstream built a global wind-down of Instant Cloud into the server: a stage
(`signups-closed`, `read-only`, `disabled`) read from the `sunset-stage` flag
of the config app, which closes sign-ups, app creation and checkout and then
makes every app read-only or unreadable. SidekickDB removed it from the server
and the dashboard; no code reads that flag, so setting it has no effect.

- Deleted: `server/src/instant/sunset.clj`, `server/test/instant/sunset_test.clj`.
- `flags.clj`: the sunset section. `model/app.clj`: `get-status` is the app's
  own status; no `apply-sunset-stage`, no gate in `create!`. `model/org.clj`
  and `model/instant_subscription.clj`: no `paid-features-free`.
- `dash/routes.clj`: no `/dash/sunset` routes, no sign-up, app-creation,
  claiming or checkout gate tied to the stage, no `sunset` block and no
  `effective_status` in the dashboard responses.
- `util/exception.clj` (three error types), `backup.clj` (final-backup step),
  `core.clj` (startup step), `stripe.clj`, `stripe_webhook.clj` and
  `reactive/store.clj` (helpers only the wind-down used).
- Tests: `server/test/instant/app_status_test.clj` (new),
  `dash/removed_routes_test.clj`, `runtime_mode_test.clj`.
- Dashboard (`client/www`), deleted: `pages/intern/sunset.tsx` (operator
  page), `components/SunsetBanner.tsx`, `lib/sunset.ts`.
- Dashboard, edited: `components/dash/MainDashLayout.tsx` (notice, redirect
  to the backups tab), `pages/dash/index.tsx`, `components/dash/TopBar.tsx`,
  `pages/dash/new.tsx`, `pages/dash/onboarding.tsx` (app creation gate),
  `components/dash/Billing.tsx`, `components/dash/org-management/OrgBilling.tsx`,
  `components/admin/AdminPage.tsx` (billing closed, paid features free),
  `components/dash/Auth.tsx` (sign-ups closed), `lib/types.ts` (`SunsetStage`,
  `SunsetInfo`, `effective_status`, `sunset`), and the banners in
  `components/marketingUi.tsx`, `components/docs/Layout.jsx` and
  `components/new-landing/Hero.tsx`.

The per-app status (`apps.status`, `set-status!`, `assert-write-allowed!`,
`assert-read-allowed!`, the `app-status-changed` event), backups and the flags
machinery are upstream's and stay.

**Resolving:** keep the five files deleted and delete again whatever upstream
adds for the wind-down (readers of `sunset-stage`,
`sunset-app-creation-allowed-emails` or `final-backup-status`, `/dash/sunset`
routes, gates tied to the stage, `paid-features-free`, the `sunset` field of
the dashboard responses and its dashboard readers, the cancel reason
`sunset`). Take upstream's other changes in these files. The three tests above
must pass and
`git grep -n -i sunset -- server/src client/www/components client/www/pages client/www/lib`
must print only the essay word count in `allExactCounts.json`.

### Removed: WebSocket playground

The unused inherited debug endpoint `GET /dash/ws_playground` and its handler
(`ws-playground-get`, `id-atom`) are removed from `dash/routes.clj`, together
with the `instant.lib.ring.websocket` require and the `WebSocketChannel` import
that only it used. Nothing in the clients or the dashboard calls it.
`server/test/instant/dash/removed_routes_test.clj` keeps it removed.

**Resolving:** if upstream changes the handler or the route, keep them removed
and take its other changes in the file.

### SidekickDB's own fixes

- Tests that hung or flaked on 2-vCPU CI runners:
  `server/test/instant/util/cache_test.clj` (PR #1, `8947950b`),
  `server/test/instant/reactive/session_test.clj` (PR #6),
  `server/test/instant/custodian_test.clj` and
  `server/test/instant/reactive/invalidator_singleton_test.clj` (PR #8),
  `child-tracked-futures-are-canceled` in
  `server/test/instant/util/async_test.clj` (PR #69).
- PR #93: `.github/workflows/clojure.yml` turns off Postgres JIT for the
  test database. `on-delete-cascade-perf` in
  `server/test/instant/db/transaction_test.clj` sometimes hit the 30 s query
  timeout. With JIT on, its 1,365-CTE entity query was measured at 3.6 s when
  its cost estimate crossed `jit_above_cost` (9,556 functions compiled); that
  it passes 30 s once `jit_optimize_above_cost` is crossed is inferred, not
  measured. Keep the setting if upstream rewrites the "Prepare database" step.
- PR #12 (instantdb/instant#2932, no upstream fix): a refresh cancelled by
  the receive timeout no longer removes the session's queries.
  `server/src/instant/reactive/{query,session,store}.clj`: a cancelled
  recompute keeps its query, the queries of a failed or cancelled refresh
  are marked stale with their result hash retracted
  (`rs/mark-refresh-failed!`), and the refresh is retried after 500 ms, 1 s
  and 2 s with jitter (flag `:refresh-retry-delays-ms`). A query whose
  refresh is cancelled `:refresh-timeout-limit` (3) times in a row is
  removed and the client gets an error shaped like a failed `add-query`.
  Tests in `server/test/instant/reactive/session_test.clj` and
  `store_test.clj`. Keep ours unless upstream fixes #2932 itself.
- PR #16: `server/src/instant/db/attr_sketch.clj` loads attr sketches on its
  own virtual-thread executor instead of `ForkJoinPool.commonPool()`, with
  `server/test/instant/db/attr_sketch_lookup_test.clj`.
- PR #24: `combine` for `:refresh-presence` in
  `server/src/instant/reactive/session.clj` keeps a full snapshot when one of
  the two queued refreshes is a snapshot; it used to send only the patch, so
  a session that had just joined could miss the peers already in the room.
  Test `combine-refresh-presence` in `session_test.clj`.
- PR #44: `server/dev-postgres/Dockerfile` gets an entrypoint,
  `sidekick-entrypoint.sh`, that starts Postgres with
  `output_plugin_libraries=pgoutput,test_decoding,wal2json`. PostgreSQL 17.12
  refuses an output plugin that is not in that list, and the server's
  replication slots use `wal2json`, so without it the server never starts
  against an image built from the current `postgres:17`.
- PR #49: the hourly refresh of cached signing keys in
  `server/src/instant/auth/jwt.clj` uses `doseq`; upstream's `for` built a
  lazy seq that was thrown away, so the refresh never ran. Test
  `scheduled-refresh-refreshes-expiring-keys` in
  `server/test/instant/auth/jwt_test.clj`.
- PR #63: team invites (`dash/routes.clj`, `team-member-invite-email` and
  `team-member-invite-send-post`) and app-transfer invites
  (`superadmin/routes.clj`, `transfer-app-invite-email` and
  `app-transfer-send-invite-post`) are structured letters sent with
  `email-router/send-structured!`, after `email-router/assert-sender!` and
  before the invite is stored. Upstream calls `postmark/send!`, which sends
  nothing without a Postmark token, and gives the transfer invite the sender
  `teams@pm.instantdb.com` and a link to instantdb.com.
- PR #76: a request that matches no route gets the 404 from `not-found` in
  `server/src/instant/core.clj`. Upstream's `add-security-headers` and
  `wrap-dev-server-info` turned the nil from an unmatched route into a map
  with headers and no status, so `routes` never reached `not-found` and
  Undertow answered an empty 200. Both now use `some->`, and the 404 gets
  the security headers too. Tests `unmatched-routes-are-not-found` in
  `server/test/instant/core_test.clj` and `sunset-routes-are-gone` in
  `server/test/instant/dash/removed_routes_test.clj`.
- PR #90: the essay live preview route,
  `client/www/pages/api/intern/posts/watch/[slug].ts`, answers 404 unless
  `NODE_ENV` is `development`. It and `getPostBySlug` in
  `client/www/lib/posts.ts` take only a slug of letters, digits, `_` and `-`
  (`isPostSlug`). Test `client/www/__tests__/posts.test.ts`.
- PR #92: the self-hosted catch-all redirect in `client/www/next.config.js`
  also leaves `/platform/oauth` alone. The server sends platform OAuth users
  to `/platform/oauth/start`, the consent page, and upstream's list sent it to
  `/dash`. Test `client/www/__tests__/self-hosted-redirects.test.ts`.
- PR #85: `ensure-attrs-on-system-catalog-app` in
  `server/src/instant/system_catalog_migration.clj` reads the system catalog
  attrs and inserts the missing ones in one transaction on the write pool,
  after `pg_advisory_xact_lock(hashtext('instant-system-catalog-migration'))`.
  Upstream read and inserted without a lock, so of two nodes starting at once
  on an empty database one could insert attrs the other had just inserted,
  hit the `prevent_update_system_catalog_ident` trigger and exit at startup.
  Test `concurrent-boots-insert-catalog-attrs-once` in
  `server/test/instant/system_catalog_migration_test.clj`.

**Resolving:** keep SidekickDB's fix unless upstream fixed the same problem;
then take upstream's version. Take upstream's new tests as they are. For the
Postgres image, drop the entrypoint only if upstream's image allows `wal2json`
some other way; check by starting the self-hosting stack.

### Release pipeline

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
- `client/packages/mcp/package.json`: `"private": true`. The MCP server is
  outside SidekickDB's scope and is not published.
- `client/packages/version/src/version.ts` is SidekickDB's: its own version
  line, starting at `v2.0.0` (see `RELEASING.md`, version rules).
- The released npm tarballs and images carry `LICENSE.md` and `NOTICE`. Both
  are added at release time by SidekickDB's own script and workflow; no
  package directory and no Dockerfile is changed for it.

**Resolving:** upstream has none of these files except
`server/flags-config/package.json` and `client/packages/mcp/package.json`;
keep `"private": true` in both and take upstream's other changes. In
`version.ts` keep SidekickDB's version, not upstream's. `check.mjs` (and
`node --test client/scripts/sidekick-release-npm.test.mjs`) fails if
upstream raised a server version minimum above SidekickDB's version; raise
`version.ts` above that minimum in that case.

### Self-hosted stack benchmark

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

### Two-node smoke test

`scripts/smoke/two-node/` (`run.mjs`, `smoke.mjs`, `compose.two-node.yml`)
and `.github/workflows/sidekick-two-node-smoke.yml` boot two server nodes
against one Postgres with `self-hosting/docker-compose.yml` and an override
that sets `SWARM_SERVICE_NAME=server`, a shared `tasks.server` network alias
and one shared `override.edn`, so the nodes find each other through the same
`init-hz` swarm branch as the replicas of `swarm.yml`. It checks that a write
on one node reaches a subscriber on the other, that a stream written on one
node can be read on the other, both in both directions, and that presence is
shared. The README there says what is and is not the same as a
swarm deployment. The workflow is read-only (`contents: read`, no secrets; the
image is built with `push: false` and loaded locally), runs on demand and on
pull requests that change self-hosting or clustering files, and `check.mjs`
lists it in `TWO_NODE_SMOKE_WORKFLOWS` without any exception from its rules.

**Resolving:** upstream has none of these files. When upstream changes the
compose file, `swarm.yml`, the self-hosted Dockerfile or how `init-hz` in
`server/src/instant/reactive/ephemeral.clj` discovers peers, keep upstream's
change and adapt the override or `run.mjs`.

### Security policy

`SECURITY.md`: SidekickDB's own policy, reports through GitHub private
vulnerability reporting on `SidekickDB/sidekick`.

**Resolving:** upstream has no `SECURITY.md`. If it adds one, keep
SidekickDB's.

### README header

`README.md`: the top of the file is SidekickDB's plain-text header (name, one
line on what it is, the relation to Instant, a link to this file). Upstream's
logo, Discord and stars badges and row of instantdb.com links are removed.
The two diagrams further down (`compression.svg`, `architecture.svg`) load
from upstream's own copies in `client/www/public/readmes/` by relative path,
not from instantdb.com.

**Resolving:** keep SidekickDB's header and do not take back the logo, badges
or link row. Keep the relative diagram paths. The text below the header is
SidekickDB's too since PR #56 (next section).

### No Python starter

SidekickDB releases no Python SDK. `create-sidekick-app` therefore does not
offer or bundle the `python-script` starter, which installs Instant's
`instantdb` package from PyPI:

- `client/packages/create-instant-app/src/projectBase.ts`: the base is in
  `unavailableProjectBases` and filtered out of `projectBases` and
  `bundledProjectBases`. Its config entry and the Python handling in
  `index.ts` and `backendConfig.ts` stay as upstream wrote them.
- `client/packages/create-instant-app/src/cli.ts`: no `--python` option, flag
  mapping or menu entry.
- `client/www/data/docsNavigation.js`: no entry for the Python page.
  `client/www/app/docs/start-python/page.md` has a note that it describes
  Instant's package, and no scaffold command; `docs/backend/page.md` says the
  same in one sentence.

**Resolving:** keep the list, the missing option and the docs note. Take
upstream's changes to the Python handling as they are; it stays unreachable.
If upstream adds another starter that installs a package SidekickDB does not
release, add it to `unavailableProjectBases`.

### Starters come with the package

`create-sidekick-app` downloads no starter at run time:

- `client/packages/create-instant-app/src/projectBase.ts`: every offered base
  is `bundled: true`. Upstream bundles some and clones the rest from
  `instantdb/instant` when the tool runs.
- `client/packages/create-instant-app/src/scaffold.ts`: the download
  fallback, reached only when a bundled template is missing, uses
  `SidekickDB/sidekick`.
- `examples/bun-react`: `@sidekickdb/react` is `latest`, and `bun.lock` is
  deleted: it resolved upstream's packages, and the tool deletes lockfiles
  from a new project anyway.
- `vercel-ai-sdk` is in `unavailableProjectBases` next to `python-script`
  (PR #58): not offered and not bundled. The starter is built on Instant's
  hosted services: without a model key it sends the user's prompt to
  `api.instantdb.com/examples/mma`, and its preview creates apps through the
  platform API without a server URL. The example itself is unchanged.
- `examples/ai-chat/src/lib/mockModel.ts`: the `User-Agent` of its Wikipedia
  requests names SidekickDB's repository, not Instant.

**Resolving:** keep every base bundled, including a base upstream adds, and
keep SidekickDB's repository in the fallback (a unit test fails when an
offered base is not bundled). Keep `bun-react` on `latest` and delete
`bun.lock` again if upstream changes it. Keep `vercel-ai-sdk` unavailable
until the example works against a SidekickDB server with no request to an
Instant-owned host; keep the `User-Agent` edit in `ai-chat`.

### Brand: READMEs, package descriptions, CLI text and starters

What a visitor of the repository or of a package's npm page reads presents the
project as SidekickDB:

- `README.md`: the body is SidekickDB's own text. It links to the docs pages
  in `client/www/app/docs`, names self-hosting as the way to get started and
  credits InstantDB's authors for the design.
- `client/packages/*/README.md` of the 17 published packages: a plain-text
  header (package name, one line on the relation to InstantDB) instead of
  Instant's logo, badges and link row; docs links to this repository;
  "SidekickDB" for "Instant" in prose. Code samples and identifiers
  (`Instant-Signature`, `instant.schema.ts`, `InstantError`) are unchanged.
- `client/packages/*/package.json` of the same packages: `description`.
- `self-hosting/README.md`, `client/README.md`, `server/README.md`: title and
  first lines.
- `CONTRIBUTING.md`: SidekickDB's own; upstream has none.
- PR #61: what `sidekick-cli` and `create-sidekick-app` print.
  `create-instant-app/src/utils/title.ts` shows a plain-text title, not
  upstream's logo banner. Printed strings in `client/packages/cli/src` and
  `create-instant-app/src` say "SidekickDB"; text that named a server feature
  says what it is ("shared dev credentials", "managed by the server", "Server
  verified"). The welcome comment `platform/src/perms.ts` writes into a new
  permissions file is changed too. Identifiers, `X-Instant-*` headers, the
  `instant-cli` alias and generated file names are upstream's (docs links:
  see below).
- PR #62: what `create-sidekick-app` writes into a new project. The 11
  starters it offers (under `examples/`) say "SidekickDB" in READMEs, page
  titles, UI text and comments, and six of them no longer load Instant's logo
  from www.instantdb.com. The Expo title is "My SidekickDB App" in the starter
  and in `create-instant-app/src/scaffold.ts`, which replaces it. The agent
  rules (`client/www/lib/intern/instant-rules.md` and its identical copy
  `create-instant-app/template/rules/AGENTS.md`) say "SidekickDB" and do not
  mention the Python SDK.
- Upstream's community invite links: the seven offered starters whose README
  invited feedback on upstream's Discord now point at this repository's issue
  tracker, and `client/packages/components/src/config.ts` no longer exports
  `discordInviteUrl`, `discordOAuthAppsFeedbackInviteUrl` and
  `bugsAndQuestionsInviteUrl` (nothing imported them from the package; the
  dashboard keeps its own copies in `client/www/lib/config.ts`).
  The CLI's "unexpected job type" error (`client/packages/cli/src/old.js`)
  asks for an issue here instead of a message on upstream's Discord.
- Docs links in what the CLI and `create-sidekick-app` print and write, the
  headers `platform/src/perms.ts` and `schema.ts` generate (and their tests),
  the agent rules and the 12 starters under `examples/` point at
  `https://sidekickdb.co/docs/...` with upstream's path, anchor and `.md`
  suffix. Other instantdb.com links there are removed: "get started for free
  at https://instantdb.com" in `examples/vercel-ai-sdk/src/prompts/system.txt`.
  The `docs-host` rule in `scripts/upstream/rename.mjs` (paths in
  `DOCS_HOST_PATHS`) rewrites such links, so `sync.mjs` applies it to every
  side of a conflict and `check.mjs` to upstream's new lines; any other
  instantdb.com link in those paths is an `instant-site-link` leftover.
  `api.instantdb.com` is a different host and is not touched here. To
  resolve such a leftover, remove the link or name the user's SidekickDB
  dashboard in words; never invent a URL. If upstream adds a starter that
  `create-sidekick-app` offers, add it to `DOCS_HOST_PATHS`.

**Resolving:** keep SidekickDB's text. When upstream changes what a README
says (a new API, a new SDK, a changed command), write that change into
SidekickDB's text by hand. In a `package.json` keep SidekickDB's `description`
and take upstream's other changes. For printed text keep SidekickDB's wording,
give a string upstream adds the same treatment, and update the tests that
assert it. In the starters and the rules file keep SidekickDB's name and add no
image from instantdb.com; copy the rules file to its template copy after
every edit. If upstream edits a starter's "Got any feedback or questions?"
sentence, keep SidekickDB's line pointing at the issue tracker; if upstream
changes the three invite constants in `components/src/config.ts`, drop them
again.

SDK source and server error links: in `client/packages/*/src` of admin, core,
react, react-common, react-native, solidjs, svelte and vue, every docs link
(`@see`, "To learn more", the `queryOnce` error in `core/src/Reactor.js`)
points at `https://sidekickdb.co/docs/...` with upstream's path and anchor, as
do the two `:doc-urls`/message links in `server/src/instant/util/exception.clj`.
The `init` doc comments say "Find your `appId` in your SidekickDB dashboard"
instead of linking to Instant's hosted dashboard. The appId errors in
`core/src/Reactor.js` and `admin/src/index.ts` and the missing-store error in
`react-native/src/Storage.native.ts` say "SidekickDB". The example addresses in
the admin doc comments are at example.com, and the unexpected-error text in
`components/src/components/explorer/edit-namespace-dialog.tsx` asks the user to
share the details with the administrator of their server. These edits carry no
`SidekickDB:` comment (one per doc comment would be noise). Left as upstream's:
`'Instant Signature did not validate'` in `webhooks/src/index.ts`, because the
same file compares the message as a string and it names the `Instant-Signature`
header; the `knownKeys` entry for `https://api.instantdb.com`; the instantdb.com
addresses in test data; identifiers and `X-Instant-*` headers.

Server emails and messages: the dashboard and team sender names default to
"SidekickDB" (`config.clj`, and `self-hosting/.env.example`, which also says
the app sender name is unused because app emails use the app's title). The
team-invite and app-transfer emails say "[SidekickDB]" in the subject and
"SidekickDB" as link text; the custom-sender verification email says "this
server" and `postmark-user-note` names SidekickDB. Without a superuser email
the rate-limit error asks users to contact the administrator of this server.
The schema errors in `model/schema.clj` link to `config/dashboard-origin`
instead of www.instantdb.com/dash. The signup-denied message says "this
deployment" and the login-code log banner reads "SIDEKICKDB DASHBOARD LOGIN
CODE". Each edit has a `SidekickDB:` comment.

**Resolving the SDK links:** upstream edits these doc comments often, so a sync
that touches a line next to a swapped link conflicts. Take upstream's line and
swap the host again (`instantdb.com/docs` or `www.instantdb.com/docs` becomes
`sidekickdb.co/docs`); give a docs link upstream adds the same treatment, and
reword a new `instantdb.com/dash` or other non-docs instantdb.com link without
a URL. In `exception.clj` take upstream's change and keep the host swap.

### NOTICE file

`NOTICE`: SidekickDB's own attribution notice. It names InstantDB as the
original work, says that SidekickDB is not affiliated with Instant and that
files were changed.

**Resolving:** upstream has no `NOTICE`. If it adds one, keep its attribution
notices and SidekickDB's text in the same file (section 4(d) of the licence).

### Own copy of eventsource in admin

`@sidekickdb/admin` no longer depends on `@instantdb/eventsource`, a package in
Instant's npm scope. That package is the MIT-licensed `eventsource` 4.0.0 (by
Espen Hovlandsdal, github.com/EventSource/eventsource) with one addition: a
`messageEvent` init option, which admin uses to pass `MessageEventPolyfill`
because the Vercel edge runtime defines a `MessageEvent` that throws. Public
`eventsource` has no such option (up to 5.1.5).

- `client/packages/admin/src/eventsource/`: the `src` of
  `@instantdb/eventsource@4.1.0-2` from the npm registry tarball, unchanged
  apart from `ReaderLike` and `BodyChunk` in `types.ts`, which are taken from
  `eventsource` 5.1.5 so the code type-checks with TypeScript 5.9 (marked
  `SidekickDB:`). Its MIT `LICENSE` and a `.prettierrc.json` with the
  original formatting are next to it, and `NOTICE` names it. The `LICENSE`
  ships in the package tarball (admin packs `src/`), as does `NOTICE`.
- `client/packages/admin/src/index.ts` and `subscribe.ts` import
  `./eventsource/index.ts`; `client/packages/admin/package.json` depends on
  `eventsource-parser` (the copy's only dependency) instead.
- `client/packages/admin/__tests__/src/subscribe.test.ts` runs `subscribe`
  against a stub `fetch` with a throwing global `MessageEvent`, and admin's
  `test:ci` now runs vitest, so CI covers the streaming path.
- `scripts/upstream/rename.mjs`: `@instantdb/eventsource` is in
  `VENDORED_SCOPED`, so `check.mjs` reports it (`vendored-package`) in any
  file upstream changes, including a dependency line in a `package.json`.

**Resolving:** the copy does not follow upstream. If upstream bumps or
changes `@instantdb/eventsource` (a new version in `package.json`, a new
import, a new option at a call site), keep the dependency out and the imports
on `./eventsource/index.ts`; diff the new version's `src` against the copy
(`npm pack @instantdb/eventsource@<version>`) and bring over what admin needs,
keeping `messageEvent`. If upstream moves to public `eventsource`, check that
`MessageEventPolyfill` still reaches the edge runtime before following.
`client/pnpm-lock.yaml` is regenerated by pnpm.

### Upstream sync tooling

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
| SidekickDB's own checks pass (PR #70) | `sidekick-checks.yml` is green on the sync PR: tooling tests, `check.mjs` and the network guard self-check |
| SDKs, CLI and MCP still fail closed (PR #11) | `check.mjs` fails on an Instant host added to `client/packages/*/src` or `bin` outside tests and comments (`--accept-hosts` once a person has confirmed it is only a link). Also run the `apiURI`/`endpoints` tests and look for new clients or commands that talk to a server without a required URL |
| No new default that points at Instant-owned hosts | `check.mjs` lists every added line (outside comments) that mentions an `instantdb.com` host, `stopaio.s3.amazonaws.com` or an Instant S3 bucket, split into runtime code or config defaults, build-time files, and docs/tests. Instant-domain email addresses outside docs and tests (sender or contact defaults such as the ones PR #4 removed) are listed in their own section; in docs and tests they are listed with the hosts. Review everything outside docs/tests; nothing there should be a default |
| No new build-time or runtime contact with Instant services | The same lists, plus the report's flag when `client/www/next.config.js` changes. Also look for new fetches in build scripts and Dockerfiles before building images |
| Wire `versions` keys unchanged | `check.mjs` fails if a session `versions` key (`'@instantdb/<pkg>': version` in `client/packages/*/src`) disappears or appears under `@sidekickdb/` |
| Rename leftovers | `check.mjs` fails if a changed file still needs the normalizer or has a leftover (an old name the rules do not rewrite and the allowlist does not cover) |
| LLM rules copies | `client/www/lib/intern/instant-rules.md` and `client/packages/create-instant-app/template/rules/AGENTS.md` must stay byte-identical |
| SidekickDB's version is above the server's version minimums | `check.mjs` fails and names the minimum (file, line, enclosing def) if `version.ts` is not above every version string literal (`x.y.z`, optional `v` and `-dev`) in `server/src/instant/reactive/session.clj` and `server/src/instant/dash/routes.clj`, whatever its name or form, and if either file has no version literal. Not seen: a minimum assembled at runtime, written as a version map by hand, or defined in another server file |
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
- A new intentional divergence: add `scripts/upstream/divergences/<key>.mjs`
  (`export default { title, resolve }`; the file name is the key), a section
  under "Intentional divergences" with no PR number in its heading (directly
  before "Upstream sync tooling", which stays last), and a file for the PR in
  `scripts/upstream/divergence-prs/`. A PR for an existing divergence needs
  only that file. Unlisted PRs are still attributed, under their own title.
- `divergence-prs/<PR number>`: one file per PR, holding its key, written once
  `gh pr create` has returned the number
  (`echo '<key>' > scripts/upstream/divergence-prs/<PR number>`, then
  `git add` that file). A PR with two
  concerns lists both keys on the one line and needs an entry in `SPLIT` in
  `divergences.mjs` that picks one by path.
- Why this layout: two PRs that each record a divergence add different key
  files and different PR files, so the tooling data merges without a conflict,
  in a local `git merge` and on GitHub alike. The prose in this file still
  conflicts when two such PRs add text in the same place (two new sections
  before "Upstream sync tooling", or text in the same section): resolve it by
  hand and keep both. `divergences.mjs` refuses to load, and
  `divergences.test.mjs` fails, on a PR file whose name is not a number, whose
  content is not one or two keys (a conflict marker, a stray character), or
  that names an unknown key, a key twice or a split that `SPLIT` does not know.
- A workflow job is gated during a sync: nothing to do, `check.mjs` picks it up
  from the next base. To make it permanent, also add it to `DISABLED_JOBS` in
  `scripts/upstream/check.mjs`.
- After changing the rules, run `node --test scripts/upstream/*.test.mjs` and
  `node scripts/upstream/normalize-rename.mjs --all --check`. On `main` the
  second must report no leftovers and no files to change (apart from
  `client/www/recipes.ts` until its fix merges). CI runs the tests
  (`sidekick-checks.yml`) but not the normalizer check; run that by hand.
