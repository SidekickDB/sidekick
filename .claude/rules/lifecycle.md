# How a task moves

One board, four roles, six steps. Nothing else.

## Roles

| Role | Who | Does | Never |
|---|---|---|---|
| Owner | the maintainer | Decides what is worth doing, moves cards to Ready, says when to merge, does releases and settings | |
| Planner | `planner` agent | Turns ideas, bugs and findings into cards that stand on their own; checks facts; proposes priority and order | Writes code, moves a card to Ready |
| Implementer | the working agent | Takes one Ready card, makes the change, opens the pull request | Reviews its own work, merges without the owner's word |
| Reviewer | `reviewer` agent | Reviews the exact head commit of a pull request, read-only | Edits, pushes, comments on GitHub, merges |

One agent can hold different roles on different cards, never two roles on the
same card.

## Steps

| Step | Board status | Who | Leaves the step when |
|---|---|---|---|
| 1. Idea | none yet | anyone | told to the planner |
| 2. Plan | Backlog | planner | the card has Context, Task, Done when, with facts checked in the code |
| 3. Approve | Owner or Backlog → Ready | owner | the owner moves it to Ready (or archives it) |
| 4. Build | In progress | implementer | pull request open, checks green, link on the card |
| 5. Review | In progress | reviewer | APPROVE for the current head commit; any new push needs a new review |
| 6. Merge | Done | owner says, implementer runs | merge commit on `main`, "Done when" on the card is true |

Cards with status **Owner** are decisions or actions only the owner can take;
they skip steps 4 to 6 unless the decision creates follow-up work, which is a
new card.

## Rules

1. No work without a card; no card without a check of its facts.
2. One card in progress at a time.
3. A review finding is fixed in the same pull request if it belongs to the
   card. Anything else becomes a new Backlog card.
4. A card is Done only when its "Done when" is observably true, not when the
   pull request is merged.
5. A card that turns out wrong or not worth doing is archived with one line
   saying why. Archiving is a normal outcome.
