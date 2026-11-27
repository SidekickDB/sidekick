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
- The upstream write guard enforces this; see "Upstream write guard" below.
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
4. New work, a bug, a follow-up: propose it to the `planner` agent. Do not
   add the card yourself, do not fix it in passing and do not record it
   anywhere else. The planner reviews it, escalates to the owner when needed,
   and adds the card only if it makes sense ("New cards go through the
   planner" in `.claude/rules/lifecycle.md`).
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
- Every intentional difference from upstream is recorded in `UPSTREAM.md`,
  `scripts/upstream/divergences/<key>.mjs` and a file
  `scripts/upstream/divergence-prs/<PR number>` (`UPSTREAM.md`, "Maintaining
  the tooling"), and marked `SidekickDB:` in a comment where the file format allows
  one.

## Upstream write guard

`.claude/settings.json` has two layers that stop an agent from writing to
upstream. Neither replaces the rule above; both are there for mistakes.

- **Hook** (`.claude/hooks/upstream-write-guard.mjs`, a `PreToolUse` hook on
  every Bash command). It splits the command like a shell, so a quoted
  description is text, not a target. It blocks:
  - any `gh` command that targets a repository of the owner `instantdb`,
    unless it only reads (`pr view`, `pr diff`, `pr list`, `pr checks`,
    `issue view`, `issue list`, `repo view`, `search` and similar). The target
    counts in every spelling: `-R`, `--repo`, `--repo=`, `-R` before the
    subcommand, a quoted value, any letter case, `github.com/` or `https://`
    in front, a pull request or issue URL, and `GH_REPO`. This covers the
    less common writes too (`pr ready`, `pr lock`, `pr update-branch`,
    `issue delete`, `issue transfer`, `issue pin`, `issue develop`, ...);
  - `gh api`, `curl` and `wget` with a write method or a body against
    `repos/instantdb/...` or `orgs/instantdb/...`, and a `gh api graphql`
    mutation whose text names `instantdb`;
  - `git push` to the remote `upstream` or to a GitHub URL of `instantdb`,
    and setting the upstream push URL to anything but `DISABLED`;
  - these commands also inside `&&`, `;`, pipes, `$(...)`, backticks,
    `bash -c`, `eval`, here-documents and wrappers such as `env` or `timeout`;
  - a command that mentions `instantdb` or `upstream` and that it cannot
    parse, or a target it cannot resolve (`-R "$X"`). A crash or bad input
    also blocks (`onFailure: "block"`).
  Commands that do not mention `instantdb` or `upstream` are not inspected.
  Tests: `node --test .claude/hooks/upstream-write-guard.test.mjs`.
- **Deny rules** (`permissions.deny`), which also apply when hooks are off.
  They match command text, so they are coarse: `gh pr` and `gh issue` writes
  with the literal text `-R instantdb/instant` or `--repo instantdb/instant`,
  `git push upstream`, and any `git push` whose text contains
  `instantdb/instant`.

Accepted, not blocked:

- A `git push` to a branch whose name contains `instantdb/instant` is blocked
  by the deny rule. Name the branch differently.
- A command whose own text quotes `-R instantdb/instant` (for example in a
  `--body` value or a `grep` pattern) is blocked by a deny rule even when it
  targets `SidekickDB/sidekick`. Pass pull request and issue text with
  `--body-file`; a description that merely names `instantdb/instant` is not
  blocked.
- What the guard cannot see: a `git push` with no remote named, which follows
  the branch configuration (the upstream push URL is `DISABLED`); `gh` run
  without `-R` in a checkout whose default repository is upstream; a target
  held in a variable set outside the command (`GH_REPO` exported earlier); a
  GraphQL mutation by node ID; programs started another way (a script file,
  `python`, `node`); tools other than Bash, such as MCP connectors.

If every Bash command is blocked with an error that the guard script is
missing, the checkout the session started in is older than the guard: the
owner updates that checkout.
