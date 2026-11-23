---
name: upstream
description: Work with upstream InstantDB from the SidekickDB fork - check for new upstream commits, merge upstream main, or take an open upstream pull request early. Use when a card mentions an upstream PR or issue number, a sync, or a merge conflict in an inherited file.
---

# Upstream

`UPSTREAM.md` is the authority. Read the section named below before acting;
this file only says which section and what not to do.

- `upstream` = `instantdb/instant`, fetch only. Its push URL is `DISABLED`.
  Never push, comment, or open pull requests or issues there.
- Reading upstream on GitHub is fine: `gh pr view <n> -R instantdb/instant`,
  `gh issue view <n> -R instantdb/instant`.
- Never send requests to Instant-owned hosts.

## Is there anything new?

```sh
git fetch upstream
git log --oneline $(git merge-base origin/main upstream/main)..upstream/main
```

## Sync (merge upstream main)

`UPSTREAM.md`, "The routine": report, merge, resolve, after the merge. The
script is `scripts/upstream/sync.mjs`. Always a merge commit, never a rebase.
For each conflict, find the file under "Intentional divergences": every entry
says how to resolve it. Afterwards work through "Re-check after every sync" and
update the "Last synced upstream commit" table.

## Take an open upstream pull request early

`UPSTREAM.md`, "Cherry-picking open upstream PRs". Open upstream PRs are local
refs `upstream-pr/<number>`.

```sh
git diff $(git merge-base upstream/main upstream-pr/<n>)..upstream-pr/<n> --stat
git merge-tree --write-tree origin/main upstream-pr/<n>   # read-only: does it conflict?
```

Before taking one, check:

- Is it already on `main` in some form?
- Does it have tests? Do not take one without.
- Does it change a stored format or protocol (IndexedDB schema version,
  migrations, wire messages)? Then do not take it early: a format that differs
  from upstream's makes every later sync painful. Wait for upstream to merge it.

Record what was taken under "Upstream fixes taken early" so the next sync knows
the change will arrive again.

## Watch list

Not taken, to look at again at each sync: #2913, #2924 (large query performance
changes tied to specific upstream apps), #2854 (changes the IndexedDB schema
version).
