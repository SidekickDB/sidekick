---
name: upstream
description: Work with upstream InstantDB from the SidekickDB fork - check for new upstream commits, merge upstream main, or take an open upstream pull request early. Use when a card mentions an upstream PR or issue number, a sync, or a merge conflict in an inherited file.
---

# Upstream

`UPSTREAM.md` is the authority. Read the section named below before acting and
follow its commands; this file only says which section and what not to do.

- `upstream` = `instantdb/instant`, fetch only. Its push URL is `DISABLED`.
  Never push, comment, or open pull requests or issues there.
- Reading upstream on GitHub is fine: `gh pr view <n> -R instantdb/instant`,
  `gh issue view <n> -R instantdb/instant`.
- Never send requests to Instant-owned hosts.

## Is there anything new?

```sh
node scripts/upstream/sync.mjs --report
```

Fetches and reports only: new upstream commits, the areas they touch, and which
SidekickDB divergences they overlap.

## Sync (merge upstream main)

`UPSTREAM.md`, "The routine": report, merge, resolve, after the merge. Always a
merge commit, never a rebase. For each conflict, find the file under
"Intentional divergences": every entry says how to resolve it. Afterwards work
through "Re-check after every sync" and update the "Last synced upstream
commit" table. A sync pull request follows the routine's own test
instructions.

## Take an open upstream pull request early

`UPSTREAM.md`, "Cherry-picking open upstream PRs", is the procedure: fetch
`pull/<N>/head`, cherry-pick one commit at a time keeping the author, add the
`Upstream-PR:` and `Upstream-Commit:` trailers, run
`scripts/upstream/normalize-rename.mjs` if it touches `client/`, and compare
`git patch-id --stable` with upstream's.

To look before deciding:

```sh
git fetch --no-tags upstream pull/<N>/head   # nothing is written upstream
git log --oneline upstream/main..FETCH_HEAD  # the PR's commits
git diff upstream/main...FETCH_HEAD --stat
```

Some clones also have older fetches as `upstream-pr/<N>`; they go stale, so
fetch again.

Before taking one, check:

- Is it already on `main` in some form?
- Does it have tests? Do not take one without.
- Does it change a stored format or protocol (IndexedDB schema version,
  migrations, wire messages)? Then do not take it early: a format that differs
  from upstream's makes every later sync painful. Wait for upstream to merge it.

Record what was taken under "Upstream fixes taken early" so the next sync knows
the change will arrive again.
