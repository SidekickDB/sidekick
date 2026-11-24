---
name: task
description: Work with the SidekickDB task board (GitHub org project 1), the only source of tasks. Use to see what to work on, start or finish a card, change its status, or (planner only) add a card. Everyone else proposes new work, a bug or a follow-up to the planner agent.
---

# Task board

Board: organization `SidekickDB`, project number `1`. Cards are private draft
items, not issues. Rules for which card may be taken are in
`.claude/rules/sidekickdb.md`.

## Read

```sh
gh project item-list 1 --owner SidekickDB --limit 200 --format json \
  --jq '.items[] | select(.status=="Ready") | "\(.priority) \(.area) | \(.title)"' | sort
```

Each item has `id` (the project item, `PVTI_…`), `content.id` (the draft,
`DI_…`), `title`, `status`, `area`, `priority`, `content.body`. Read the whole
body before starting: it is the task.

## Move a card

Field and option ids change when the board is edited, so look them up each
time instead of hardcoding them:

```sh
gh project field-list 1 --owner SidekickDB --format json   # field ids, option ids
gh project view 1 --owner SidekickDB --format json --jq .id # project id
gh project item-edit --id <PVTI_…> --project-id <project id> \
  --field-id <Status field id> --single-select-option-id <option id>
```

- Start: `In progress`.
- Pull request open: stay `In progress`, add a `PR: <link>` line at the top
  of the body (above `Blocked by:` if there is one).
- Merged and the card's "Done when" checked to be true: `Done`.

## Edit a card's text

```sh
gh project item-edit --id <DI_…> --title "<title>" --body "<full new body>"
```

`--body` replaces the whole body. Pass the title too: older `gh` versions
clear it otherwise.

## Add a card

Only the `planner` agent adds cards. Everyone else hands the proposal to the
planner (what, where, why) and never runs `gh project item-create`. The
planner reviews it first: add, merge into an existing card, drop, or escalate
to the owner. The rules are under "New cards go through the planner" in
`.claude/rules/lifecycle.md`.

A new card is **Backlog** (or **Owner**, when the owner said yes and it stays
the owner's to decide or do); the owner moves it to Ready. The planner's
command:

```sh
gh project item-create 1 --owner SidekickDB --title "<title>" --body "<body>" --format json
```

Then set Status (`Backlog` or `Owner`), an Area and a Priority with the
commands under "Move a card".

The body must stand on its own. Someone who has read nothing else must be able
to do the task from it:

```markdown
PR: <link>                      (once a pull request exists)
Blocked by: <card title>        (only if blocked)

## Context
What is true today and why it matters, with file:line evidence.

## Task
What to change, concretely.

## Done when
An observable check.

## Notes
Optional: risks, size, links.
```

Do not point at local files, chat logs or other documents instead of writing
the facts down. Check the facts in the code before writing them.

## Archive a card

Archiving is the owner's decision, except for a duplicate you have merged into
another card. Write the reason as the very first line of the body
(`Archived: <reason>`, above `PR:` and `Blocked by:`), then:

```sh
gh project item-archive 1 --owner SidekickDB --id <PVTI_…>
```

Archived cards can be restored; nothing is deleted.

## Never

- Convert a card to an issue, or make the project public, unless the owner
  asks. The repository is public; cards are not.
- Quote or summarise an Area **Security** card anywhere outside the board.
- Start a card that is not Ready.
- Add a card unless you are the planner and have reviewed the proposal.
