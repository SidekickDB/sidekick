# Releasing SidekickDB

SidekickDB publishes two kinds of artefacts, both from GitHub Actions and both
started by hand from `main`:

| What | Workflow | Where | Credential |
|---|---|---|---|
| 18 npm packages: `@sidekickdb/{admin, cli, components, core, expo-sqlite, mcp, platform, react, react-common, react-native, react-native-mmkv, resumable-stream, solidjs, svelte, version, vue, webhooks}` and `create-sidekick-app` | `.github/workflows/sidekick-release-npm.yml` | npmjs.com | npm trusted publishing (GitHub OIDC), no npm token |
| `ghcr.io/sidekickdb/server`, `ghcr.io/sidekickdb/dashboard`, `ghcr.io/sidekickdb/postgresql` (linux/amd64 + linux/arm64) | `.github/workflows/sidekick-release-images.yml` | GitHub Container Registry | the workflow's `GITHUB_TOKEN` |

There are no npm tokens in this repository or its secrets, and none should be
added: npm accepts a publish only from the release workflow, in the
`npm-release` environment, of `SidekickDB/sidekick`. Upstream's own publish and
deploy jobs stay disabled (see `UPSTREAM.md`, CI lockdown).

## One-time setup (repository owner)

Do these once, in this order. Steps 2 and 3 run on your own machine, logged in
to npm with the account that owns the `sidekickdb` org. They need a recent npm
11 with the `npm trust` command (`npm install -g npm@latest`); they do not need
`pnpm install`.

### 1. GitHub environments

In **Settings → Environments** of `SidekickDB/sidekick`, create `npm-release`
and `image-release`. For each one:

- **Required reviewers**: add yourself, so every release waits for your click.
- **Deployment branches and tags**: Selected branches, add `main`.

The workflows would create the environments on their first run otherwise, but
without those protections.

### 2. Claim the npm names (first publish)

npm can only attach a trusted publisher to a package that exists, so each name
first gets a `0.0.0` placeholder:

```sh
git switch main && git pull
cd client
npm whoami                                              # the sidekickdb org owner
node scripts/sidekick-release-npm.mjs claim-names --dry-run
node scripts/sidekick-release-npm.mjs claim-names
```

The script skips names that already exist (`create-sidekick-app` does) and
publishes only a `package.json` and a README for the others, with
`--access public`. npm asks for 2FA itself: a one-time code, or a browser link.
If the browser page offers to skip 2FA for a few minutes, accepting it saves
entering a code for each of the 17 packages. Re-running is safe.

### 3. Trust the release workflow

```sh
node scripts/sidekick-release-npm.mjs trust --dry-run
node scripts/sidekick-release-npm.mjs trust
```

This runs, for every package:

```sh
npm trust github <package> --repository SidekickDB/sidekick \
  --file sidekick-release-npm.yml --environment npm-release --allow-publish --yes
```

npm asks for 2FA on the first call and offers to skip it for 5 minutes, which
covers all 18. A package that already has a trusted publisher fails; the script
lists failures at the end. Check one with `npm trust list @sidekickdb/core`.

Equivalent by hand: npmjs.com → package → **Settings** → **Trusted publishing**
→ GitHub Actions, organisation `SidekickDB`, repository `sidekick`, workflow
`sidekick-release-npm.yml`, environment `npm-release`.

Optional, afterwards: in each package's settings on npmjs.com, set
**Publishing access** to "Require two-factor authentication and disallow
tokens". Trusted publishing keeps working; every token-based publish is
refused.

### 4. Make the images public (after the first image push)

GHCR creates `server`, `dashboard` and `postgresql` under the SidekickDB org
as private packages. For each: github.com/orgs/SidekickDB/packages → package →
**Package settings** → **Change visibility** → Public. The images carry an
`org.opencontainers.image.source` label, so GitHub links them to this
repository.

## Releasing npm packages

1. Open a PR that changes `client/packages/version/src/version.ts` to the new
   version and merge it. All 18 packages are published with that version.
2. Actions → **Release npm packages (SidekickDB)** → Run workflow, branch
   `main`, `dry_run` checked (the default). Approve the `npm-release`
   deployment. The run builds, packs and runs `npm publish --dry-run` for every
   package; read the log.
3. Run it again with `dry_run` unchecked.

From the command line:

```sh
gh workflow run sidekick-release-npm.yml -R SidekickDB/sidekick --ref main \
  -f dist_tag=latest -f dry_run=false
```

`dist_tag` is `latest` or `next`. A version that is already on npm is skipped,
so a run that failed halfway can be re-run as it is; a run in which every
package is already published fails and asks for a version bump.

### Version rules

- Plain `vX.Y.Z` only, no `-next.0` or other suffix, and above `v0.22.75`. The
  server decides which protocol features a client gets from the core package
  version it reports in the session's `versions` map
  (`server/src/instant/reactive/session.clj`) and cannot parse suffixed versions, so such clients silently lose batched
  messages, skip-attrs and presence patches. `scripts/sidekick-release-npm.mjs`
  refuses other versions.
- SidekickDB keeps upstream's numbering line (`version.ts` comes from upstream
  and moves with upstream syncs). If an upstream sync brings a version
  SidekickDB already published, bump to the next unused patch before releasing.

## Releasing images

Actions → **Release Docker images (SidekickDB)** → Run workflow, branch `main`.

- `push` unchecked (default): builds all three images for both architectures
  and pushes nothing.
- `push` checked: pushes `<sha>-amd64` / `<sha>-arm64`, then publishes
  multi-arch tags: `latest` and `<sha>` for server and dashboard (plus
  `version`, for example `v1.0.67`, when given), and
  `postgresql-17-pg-hint-plan` and `<sha>` for postgresql.

```sh
gh workflow run sidekick-release-images.yml -R SidekickDB/sidekick --ref main \
  -f push=true -f version=v1.0.67
```

The self-hosting compose files still default to `ghcr.io/instantdb/*` images.
Switch their defaults (and the self-hosting docs) to `ghcr.io/sidekickdb/*`
after the first image release is public.

## Guard rails

`node scripts/upstream/check.mjs` (run on every upstream sync) allows publish
rights only in the two release workflows above, and only while each keeps:
`workflow_dispatch` as its only trigger, `permissions: {}` at workflow level,
and on every job `if: github.repository == 'SidekickDB/sidekick' && github.ref
== 'refs/heads/main'`, its environment (`npm-release` / `image-release`) and
job-level permissions. Even there, repository secrets and any other write
permission still fail, and calling `sidekick-release-npm.mjs` with anything but
`plan` from any other workflow fails.
