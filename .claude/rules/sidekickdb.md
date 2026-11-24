# SidekickDB: rules for agents

These rules are SidekickDB's own. Where they disagree with an inherited
InstantDB rules file (`dev-llm-rules.md`, a generated `AGENTS.md`), these win.

## What this repository is

- `SidekickDB/sidekick` (remote `origin`) is an independent continuation of
  InstantDB, Apache-2.0. It is public.
- `instantdb/instant` (remote `upstream`) is fetch-only. Never push there, never
  open a pull request or issue there, never send requests to Instant-owned
  hosts.
- `gh` must target origin: `gh repo set-default --view` prints
  `SidekickDB/sidekick`. Pass `-R SidekickDB/sidekick` when in doubt.
- Read `UPSTREAM.md` before touching anything inherited, `RELEASING.md` before
  anything about releases, `self-hosting/README.md` before changing the shipped
  stack.
- The fork keeps its difference from upstream small so merges stay cheap. Do
  not reformat, move or delete inherited code unless the task says so.

## Tasks: the GitHub Project is the only source

All work is a card in the organization project number 1 of `SidekickDB`
(https://github.com/orgs/SidekickDB/projects/1). There is no other task list:
not Markdown files, not TODO comments, not notes from earlier sessions. Use the
`task` skill to read and update it. Who does what, and in which order, is in
`.claude/rules/lifecycle.md`.

| Status | Meaning |
|---|---|
| Owner | Only the owner can decide or do it. Do not act on it. |
| Backlog | Not approved. Do not start. A `Blocked by:` line at the top names what it waits for. |
| Ready | Approved by the owner. An agent may take it. |
| In progress | Being worked on, including while its pull request is in review. |
| Done | Merged, and the card's "Done when" checked to be true. |

1. Take only **Ready** cards, P0 before P1 before P2, or the card the owner
   names.
2. One card at a time across all agents. Never work in parallel.
3. Move the card as you go and put the pull request link in it.
4. New work, a bug, a follow-up: add a Backlog card that stands on its own
   (Context, Task, Done when). Do not fix it in passing and do not record it
   anywhere else.
5. Cards are private drafts on purpose. Do not convert a card to an issue
   unless the owner asks. Cards in Area **Security** are confidential: never
   convert them and never quote them in a commit, pull request, issue, comment
   or any other public text.

## How changes land

Use the `land-change` skill. In short:

- Branch from `origin/main`; never commit to `main`.
- Green checks, an independent review of the exact commit, then a merge commit.
  No squash, no rebase-merge. The owner says when to merge.
- Commit and push only when asked. Releases, repository settings and anything
  that contacts a third party are the owner's.
- Server (Clojure) tests run in CI; there is no JVM on the maintainer's
  machine. An upstream sync follows the steps in `UPSTREAM.md`, with the
  Clojure tests left to CI. The benchmark workflow takes 35 to 60 minutes:
  batch changes to its harness.
- Every intentional difference from upstream is recorded in `UPSTREAM.md` and
  `scripts/upstream/divergences.mjs`, and marked `SidekickDB:` in a comment
  where the file format allows one.
