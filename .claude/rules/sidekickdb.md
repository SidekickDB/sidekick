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
upstream. Neither replaces the rule above. Both catch mistakes, not deliberate
evasion.

- **Hook** (`.claude/hooks/upstream-write-guard.mjs`, a `PreToolUse` hook on
  every Bash command). It splits the command like a shell, so a quoted
  description is text, not a target. Commands that do not contain the text
  `instantdb` or `upstream` are not inspected. It blocks:
  - any `gh` command that targets the owner `instantdb` or one of its
    repositories, unless it only reads (`pr view`, `pr diff`, `pr list`,
    `pr checks`, `issue view`, `issue list`, `repo view`, `project view`,
    `search` and similar). The target counts in every spelling: `-R`,
    `--repo`, `--repo=`, `-R` before the subcommand, `--owner`, `--org`, a
    quoted value, any letter case, `github.com/` or `https://` in front, a
    pull request or issue URL, and `GH_REPO` set in the same command. This
    covers the less common writes too (`pr ready`, `pr lock`,
    `pr update-branch`, `issue delete`, `issue transfer`, `issue pin`,
    `issue develop`, `repo fork`, `repo set-default`, ...). Values of `--body`,
    `--title` and similar text flags are never targets;
  - `gh api`, `curl` and `wget` with a write method or a body (bundled short
    options such as `curl -sX POST` or `-sd` included) against a REST path
    with `instantdb` as one of its segments: `repos/instantdb/...`,
    `orgs/instantdb`, `user/starred/instantdb/...`,
    `user/following/instantdb`, also with `//`, `./` or `%2F` in the path;
  - `git push`, `git subtree push` and `git lfs push` to the remote
    `upstream` or to a GitHub URL of `instantdb` (HTTPS, SSH, scp form, with
    or without a port);
  - `git config`, `git -c` and `git remote set-url` that point any remote at
    an `instantdb` GitHub URL (`remote.upstream.url` and
    `remote.upstream.fetch` excepted), set a `url.<instantdb URL>.insteadOf`
    or `pushInsteadOf` key, set a push remote to `upstream`, or change or
    unset the upstream push URL to anything but `DISABLED`; and
    `git remote add` with an `instantdb` URL (use the setup in `UPSTREAM.md`);
  - these commands also inside `&&`, `;`, pipes, subshells, functions
    written as `f() {...}`, `$(...)`, backticks, `<(...)`, `$(...)` in an
    unquoted here-document, `bash -c`, `eval`, `find -exec`, `xargs`, and
    wrappers such as `env`, `timeout`, `nohup`, `nice` and `command`;
  - a shell (`sh`, `bash`, `zsh`, ...) that reads its commands from standard
    input (a pipe, a here-document, `<(...)`, `-s`), when the command mentions
    `instantdb` or `upstream`: the guard cannot see what it would run;
  - a command that mentions `instantdb` or `upstream` and that it cannot
    parse, or whose target it cannot resolve (`-R "$X"`, `git push "$R"`).
  Tests: `node --test .claude/hooks/*.test.mjs`, also run in CI by
  `sidekick-checks.yml`.
- **Deny rules** (`permissions.deny`), which also apply when hooks are off.
  They match command text, so they are coarse: `gh pr` and `gh issue` writes
  with the literal text `-R instantdb/instant` or `--repo instantdb/instant`,
  `git push upstream`, and any `git push` whose text contains
  `instantdb/instant`.

How it is registered: `.claude/settings.json` runs an inline `node -e` loader
with `onFailure: "block"`. The loader lives in the settings file itself, so it
cannot be missing where the registration exists. It runs the guard from
`${CLAUDE_PROJECT_DIR}` (the checkout the session started in), or else from
the git toplevel of the directory the command runs in. If neither has the
guard, it lets the command through with a warning and only the deny rules
apply. A guard that exists but crashes, times out or exits with anything but
0 or 2 blocks the command. So does a loader that fails, and Claude Code itself
when `node` cannot be started.

Claude Code version: `onFailure` needs 2.1.295 or later, and the hook runs for
Monitor commands from 2.1.314. The documentation does not say how an older
version treats `onFailure`; treat the hook as failing open there (a crash or a
timeout lets the command through) and update Claude Code.

If every Bash command is blocked by the hook (for example `node` is missing,
or the guard in the start checkout is broken): leave the worktree with
`ExitWorktree`, or have the owner update or repair the checkout the session
started in, then start a new session.

Accepted, not blocked:

- A `git push` to a branch whose name contains `instantdb/instant` is blocked
  by the deny rule. Name the branch differently.
- A command whose own text quotes `-R instantdb/instant` (for example in a
  `--body` value or a `grep` pattern) is blocked by a deny rule even when it
  targets `SidekickDB/sidekick`. Pass pull request and issue text with
  `--body-file`; a description that merely names `instantdb/instant` is not
  blocked.
- A command that mentions `upstream` only in a comment is still parsed, so an
  unresolved target there (`git push "$REMOTE" # upstream`) is blocked.
- `gh repo sync <fork> --source instantdb/instant` is blocked although it
  writes only to the fork.

What the guard cannot see:

- a `git push` with no remote named, which follows the branch configuration
  (the upstream push URL is `DISABLED`);
- `gh` without `-R` in a checkout whose default repository is upstream, and a
  target in a variable set outside the command (`GH_REPO` exported earlier);
- GraphQL (`gh api graphql`, `curl .../graphql`): mutations address objects
  by node ID, so the guard does not inspect them;
- REST paths by ID (`repositories/<id>/...`), `uploads.github.com`, and
  clients other than `gh`, `git`, `curl` and `wget` (`hub`, `http`, `xh`,
  `git send-email`);
- programs started another way: a script file (`bash script.sh`), `python`,
  `node`, `npx`, `watch`, `script`, `caffeinate`, `xargs -I{}` with the
  target on stdin, aliases and `function f { ... }`;
- text split so the literal word is absent: `instant''db`, `$'\x69...'`,
  `${O}db`, `$(echo gh)`, base64 piped to a shell;
- tools other than Bash, such as MCP connectors.
