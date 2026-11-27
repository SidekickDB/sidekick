# How a task moves

One board, four roles, six steps. Nothing else.

## Roles

| Role | Who | Does | Never |
|---|---|---|---|
| Owner | the maintainer | Decides what is worth doing, moves cards to Ready, says when to merge, does releases and settings | |
| Planner | `planner` agent | Reviews every proposed card and is the only one who adds cards; checks facts; escalates to the owner; proposes priority, order and what to archive | Writes code, moves a card to Ready, archives anything but a merged duplicate, adds a card that should have been escalated |
| Implementer | the working agent | Takes one Ready card, makes the change, opens the pull request | Reviews its own work, merges without the owner's word, adds cards |
| Reviewer | `reviewer` agent | Reviews the exact head commit of a pull request in a temporary worktree | Edits, pushes, comments on GitHub, merges |

One agent can hold different roles on different cards, never two roles on the
same card.

## Steps

| Step | Board status | Who | Leaves the step when |
|---|---|---|---|
| 1. Idea | none yet | anyone | told to the planner |
| 2. Plan | none yet → Backlog or Owner | planner | the proposal is reviewed, escalated if needed, and the card has Context, Task, Done when, with facts checked in the code |
| 3. Approve | Owner or Backlog → Ready | owner | the owner moves it to Ready (or archives it) |
| 4. Build | In progress | implementer | pull request open, checks green, link on the card |
| 5. Review | In progress | reviewer | APPROVE for the current head commit; any new push needs a new review |
| 6. Merge | In progress → Done | owner says, implementer runs | merge commit on `main` and "Done when" on the card checked to be true |

Cards with status **Owner** are decisions or actions only the owner can take;
they skip steps 4 to 6 unless the decision creates follow-up work, which is
proposed to the planner.

## New cards go through the planner

Nobody adds a card to the board directly. Only the `planner` agent creates
cards, and only after it has reviewed the proposal.

1. **Propose.** Whoever finds new work, a bug or a follow-up tells the
   planner: what, where (file:line or command output), why it matters. No
   card yet, and no note anywhere else.
2. **Review.** The planner checks the facts, looks for a duplicate, and asks:
   is it true, does anyone need it, is it one piece of work? It ends with one
   verdict:

   | Verdict | When | What happens |
   |---|---|---|
   | Add | Checked defect or follow-up inside work the owner already agreed to | The planner adds the card, status Backlog |
   | Merge | An existing card covers it | The planner extends that card, no new card |
   | Drop | Not true, speculative, or too small to be a card | No card; one line saying why goes back to the proposer |
   | Escalate | See below | No card until the owner answers |

3. **Escalate** to the owner, before adding anything, when the proposal:
   - needs a decision or action only the owner can take (scope, brand,
     release, settings, money, anything that contacts a third party);
   - changes what the project is or does for its users, as opposed to
     repairing agreed behaviour;
   - is in Area Security;
   - would become more than three cards from one request (for example
     splitting a large card): the owner sees the list first;
   - leaves the planner unsure that it is worth doing.

   The planner returns the question with its recommendation; the session
   that called it puts the question to the owner. On a yes that session
   calls the planner again with the proposal, the planner's earlier report
   and the owner's answer, and the planner adds the card (Backlog, or Owner
   when it stays the owner's to do). On a no, nothing is added. An agent
   that cannot call the planner itself puts the proposal in its report.

The planner adds a P0 (harms users or the project's standing now) at once,
also when it would otherwise escalate, Area Security included, and names it
first in its report so the owner hears in the same turn. Nobody else adds a
P0 either.

## Rules

1. No work without a card; no card without the planner's review of its
   facts.
2. Several cards may be In progress at once, each with its own implementer,
   branch and worktree. The guards:
   - one card per implementer at a time;
   - never two roles on the same card (see "Roles");
   - an implementer changes only what its card needs, never files for other
     cards; a finding outside the card is proposed to the planner;
   - after another pull request merges to `main`, an open pull request may
     have to merge `main`, rerun its checks and get a new review of its new
     head before it can merge.
3. A review finding is fixed in the same pull request if it belongs to the
   card. Anything else is proposed to the planner.
4. A card is Done only when its "Done when" is observably true, not when the
   pull request is merged.
5. A card that turns out wrong or not worth doing is archived by the owner,
   or on the owner's word, with one line saying why. The one exception: the
   planner archives a duplicate it has merged into another card. Archiving is
   a normal outcome.
