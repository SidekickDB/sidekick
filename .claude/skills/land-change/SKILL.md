---
name: land-change
description: The SidekickDB pattern for getting a change onto main - branch, checks, pull request, CI, independent review, merge commit. Use whenever a card needs a code, docs, workflow or config change in this repository.
---

# Landing a change

One card, one branch, one pull request.

## 1. Branch

```sh
git fetch origin
git switch -c <area>/<short-name> origin/main
```

Never commit to `main`.

## 2. Change

- Smallest change that does the card. No drive-by cleanups; new findings become
  Backlog cards (`task` skill).
- Inherited (upstream) files: keep the edit small and mark it with a
  `SidekickDB:` comment saying why, where the format allows comments.
- An intentional difference from upstream is recorded in two places:
  `UPSTREAM.md` under "Intentional divergences" (with how to resolve it at the
  next sync) and `scripts/upstream/divergences.mjs`.
- New workflow file: name it `sidekick-*.yml`, pin actions to full commit SHAs
  (verify each SHA exists; dereference annotated tags), and add it to
  `KNOWN_WORKFLOWS` in `scripts/upstream/check.mjs`.

## 3. Check locally

```sh
node scripts/upstream/check.mjs          # no publishing job enabled, no Instant-owned host added
node --test scripts/upstream/*.test.mjs  # if scripts/upstream changed
```

For client changes, after `pnpm install` in `client/`:

```sh
(cd client/packages/<pkg> && pnpm exec tsc --noEmit)   # or client/www; types of the package you changed
(cd client && pnpm run check-format)
```

Do not run `pnpm build` in `client/` to check your work.

Server (Clojure) tests run in CI only. Compose files are rendered in CI too
(`sidekick-self-hosting-check.yml`); Compose versions differ, so do not trust a
local render alone.

## 4. Pull request

Commit and push only when asked.

```sh
git push -u origin <branch>
gh pr create -R SidekickDB/sidekick --base main --title "<type(scope): summary>" --body "<what, why, how it was checked>"
```

The repository is public: nothing confidential in titles, descriptions, commit
messages or comments. Put the PR link in the card.

## 5. Checks and review

- `gh pr checks <n> --watch`. Fix red checks; do not re-run until green without
  understanding the failure.
- Get an independent review of the exact head commit (a separate reviewer agent
  that sees the diff, not your reasoning). A new push needs a new review.

## 6. Merge

Only on the owner's word (the command asks for confirmation), and only as a
merge commit:

```sh
gh pr merge <n> -R SidekickDB/sidekick --merge
```

Never `--squash` or `--rebase`: upstream history and authorship are kept
intact. The branch is deleted automatically. Move the card to Done.
