# Releasing SidekickDB

SidekickDB publishes two kinds of artefacts, both from GitHub Actions and both
started by hand from `main`:

| What | Workflow | Where | Credential |
|---|---|---|---|
| 17 npm packages: `@sidekickdb/{admin, cli, components, core, expo-sqlite, platform, react, react-common, react-native, react-native-mmkv, resumable-stream, solidjs, svelte, version, vue, webhooks}` and `create-sidekick-app` | `.github/workflows/sidekick-release-npm.yml` | npmjs.com | npm trusted publishing (GitHub OIDC), no npm token |
| `ghcr.io/sidekickdb/server`, `ghcr.io/sidekickdb/dashboard`, `ghcr.io/sidekickdb/postgresql` (linux/amd64 + linux/arm64) | `.github/workflows/sidekick-release-images.yml` | GitHub Container Registry | the workflow's `GITHUB_TOKEN` |

There are no npm tokens in this repository or its secrets, and none should be
added: npm accepts a publish only from the release workflow, in the
`npm-release` environment, of `SidekickDB/sidekick`. Upstream's own publish and
deploy jobs stay disabled (see `UPSTREAM.md`, CI lockdown).

The npm workflow has two jobs so that no dependency code ever runs next to the
publish credential:

- `build` (`contents: read` only): installs, builds and packs the packages
  (`sidekick-release-npm.mjs pack`) and uploads the tarballs with a manifest.
  Packing copies the repository's `LICENSE.md` and `NOTICE` into every package
  and removes them again afterwards, so each tarball carries both.
- `publish` (`id-token: write`, `npm-release` environment): no install and no
  build. It checks out only the release script, the package manifests and
  `version.ts`, checks the downloaded tarballs against them (version, names,
  order, file list, the name and version inside each tarball, and that each
  tarball has `LICENSE.md` and `NOTICE`) and runs
  `npm publish` (`sidekick-release-npm.mjs publish-tarballs`).

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
entering a code for each of the 16 packages. Re-running is safe.

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
covers all 17. A package that already has a trusted publisher fails; the script
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
   version and merge it. All 17 packages are published with that version.
2. Actions → **Release npm packages (SidekickDB)** → Run workflow, branch
   `main`, `dry_run` checked (the default). The build job runs first; then
   approve the `npm-release` deployment for the publish job, which runs
   `npm publish --dry-run` for every package. Read the log.
3. Run it again with `dry_run` unchecked.

From the command line:

```sh
gh workflow run sidekick-release-npm.yml -R SidekickDB/sidekick --ref main \
  -f dry_run=false
```

Every release goes to the `latest` dist-tag; there is no `next` channel (a
plain version published under `next` could not be promoted by re-running,
since the version would already be on npm). Until the first release, `latest`
of every package is the empty `0.0.0` placeholder from `claim-names`. A version
that is already on npm is skipped, so a run that failed halfway can be re-run as it is; a run in which
every package is already published fails and asks for a version bump.

### Version rules

- Plain `vX.Y.Z` only, no `-next.0` or other suffix, and above `v0.22.75`. The
  server decides which protocol features a client gets from the core package
  version it reports in the session's `versions` map
  (`server/src/instant/reactive/session.clj`) and cannot parse suffixed
  versions, so such clients silently lose batched messages, skip-attrs and
  presence patches. `scripts/sidekick-release-npm.mjs`
  refuses other versions.
- SidekickDB has its own version line, starting at `v2.0.0`. `version.ts` is
  SidekickDB's and does not follow upstream's version: at an upstream sync,
  keep SidekickDB's value.
- The version must stay above every minimum the server compares client
  versions against (`server/src/instant/reactive/session.clj` and
  `cli-min-version` in `server/src/instant/dash/routes.clj`). An upstream sync
  can raise one. `scripts/sidekick-release-npm.test.mjs` reads them from the
  server source and fails if the checked-in version is not above all of them;
  the release workflow runs that test before it builds. If it fails, raise
  `version.ts` above the new minimum.

## Releasing images

Actions → **Release Docker images (SidekickDB)** → Run workflow, branch `main`.

- `push` unchecked (default): builds all three images for both architectures
  and pushes nothing.
- `push` checked: pushes `<sha>-amd64` / `<sha>-arm64`, then publishes
  multi-arch tags: `latest` and `<sha>` for server and dashboard (plus
  `version`, for example `v2.0.0`, when given), and
  `postgresql-17-pg-hint-plan` and `<sha>` for postgresql. The per-arch tags
  stay in the public packages next to the multi-arch ones.

Every image has the repository's `LICENSE.md` and `NOTICE` in `/licenses/`.
The Dockerfiles are upstream's and are not changed for this: the workflow
builds from a copy of the Dockerfile with one more `COPY` step at the end.
Check a pushed image with
`docker run --rm --entrypoint ls ghcr.io/sidekickdb/server /licenses`.

A push needs two approvals of the `image-release` environment: one for the
build matrix and one for the manifest job. A malformed `version` fails every
build job before it builds anything.

```sh
gh workflow run sidekick-release-images.yml -R SidekickDB/sidekick --ref main \
  -f push=true -f version=v2.0.0
```

The self-hosting compose files default to these images: `latest` of server
and dashboard, and `postgresql-17-pg-hint-plan` of postgresql. A release that
moves `latest` is what a self-hoster gets on the next `docker compose pull`.
The server CI (`.github/workflows/clojure.yml`) runs its tests against the
postgresql image too.

## Guard rails

`node scripts/upstream/check.mjs` (run on every upstream sync) allows publish
rights only in the two release workflows above, and only while each keeps:
`workflow_dispatch` as its only trigger, `permissions: {}` at workflow level,
on every job `if: github.repository == 'SidekickDB/sidekick' && github.ref ==
'refs/heads/main'` and job-level permissions, and on every job that holds a
publish right its environment (`npm-release` / `image-release`). So the npm
build job cannot gain `id-token: write` without the check failing. Even in these
files, repository secrets and any other write permission still fail, and
calling `sidekick-release-npm.mjs` with anything but `plan` or `pack` from any
other workflow fails.
