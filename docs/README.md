# Project documents

The parent [CLAUDE.md](../CLAUDE.md) governs the project. These documents apply it.

| Document | What it answers |
| --- | --- |
| [HLD.md](HLD.md) | What are we building and how do the parts fit together? |
| [DECISIONS.md](DECISIONS.md) | Why was each choice made, and what else was considered? |
| [MILESTONES.md](MILESTONES.md) | In what order is it built, who owns each task, and how do we know it is finished? |
| [M1-PLAN.md](M1-PLAN.md) | The phases, steps and discovery findings for milestone 1 |
| [M1.5-PLAN.md](M1.5-PLAN.md) | The build plan for the approved designs: phases, parallel work, discovery findings |
| [M2-PLAN.md](M2-PLAN.md) | Accounts and login: owner answers, discovery, API contract, phases |
| [M3-PLAN.md](M3-PLAN.md) | Wallet and charging: owner's prices, discovery, API contract, phases |
| [UX.md](UX.md) | What must every screen look and behave like? The design system and the interaction standards |
| [tracker/](tracker/) | What is the status right now? |
| [../backend/CLAUDE.md](../backend/CLAUDE.md) | Rules for backend work |
| [../frontend/CLAUDE.md](../frontend/CLAUDE.md) | Rules for frontend work |

## Tracker files

| File | One row per | Values |
| --- | --- | --- |
| `tracker/milestones.json` | Milestone | status: Planned, In progress, Done |
| `tracker/tasks.json` | Task | status: To do, In progress, Blocked, Done. verification: see below |
| `tracker/decisions.json` | Decision | status: Confirmed, Proposed, Needs owner |
| `tracker/questions.json` | Question for the owner | status: Open, Answered. handling: Needs your answer, Default applies unless you object |
| `tracker/requirements.json` | Requirement | class: Confirmed, Assumed, Needs Verification, Deferred, Out of Scope |

Use the values exactly as written; the dashboard counts them by exact text.

After editing MILESTONES.md or DECISIONS.md, run `python3 docs/tracker/sync.py`. It rebuilds
`tasks.json`, `milestones.json` and `decisions.json` from the markdown, keeps each task's status,
verification and evidence, and cross-checks every ID, owner, lane and dependency. Edit a task's
status, verification and evidence directly in `tasks.json`.

### Verification statuses (parent CLAUDE.md §10)

| Value | Meaning |
| --- | --- |
| VERIFIED | Confirmed by real execution or appropriate evidence |
| MOCK-VERIFIED | Tested successfully using controlled mocks. Not evidence that a live provider works |
| IMPLEMENTED, UNVERIFIED | Exists, but its behaviour has not been demonstrated |
| BLOCKED | A dependency, credential, approval or capability is missing |
| DEFERRED | Deliberately excluded from current scope |

A task not yet started has no verification value.

"Confirmed" is used only for what the owner stated. An engineering assumption is never moved to
Confirmed without the owner saying so.

## Delegation brief (parent CLAUDE.md §7)

Every substantial task handed to another agent carries these nine parts:

```text
Task:                 <ID and title from MILESTONES.md>
Business objective:   <what the customer or owner gets>
Technical objective:  <what must exist when done>
Available context:    <documents and files to read first>
Assumptions and constraints: <including the cost and test rule>
File ownership:       <files this task may change; no one else changes them meanwhile>
Required interfaces:  <API contract, function signatures, table columns>
Acceptance criteria:  <the "Accepted when" column, plus the requirement IDs>
Expected verification: <which mock tests to run and what evidence to return>
Escalation conditions: <when to stop and report instead of continuing>
```

The agent returns evidence (test output, file paths), not a claim of completion.

## Milestone report (parent CLAUDE.md §10)

```text
Milestone:
What was implemented:
Why it was necessary:
What was verified:
Which tests were executed:
What remains unverified:
Known risks or limitations:
Next justified action:
Status: VERIFIED | MOCK-VERIFIED | IMPLEMENTED, UNVERIFIED | BLOCKED | DEFERRED
```

## Designs

[Frameforge App Designs](https://claude.ai/artifact/3UF9Uf2hTWHw1TGm3ZERjz)

The screen designs for every customer screen, on a design canvas. UX.md is the written standard;
the canvas is the picture. The link is private to its owner until shared.

The same 23 screens are kept in [design/](design/) as one `.dc.html` file each, with
`canvas.json` (the board layout) and `BRIEF.md` (the rules they were drawn to). Agents building a
screen read the matching file there. The owner approved the designs (Q-20, D-028).

## Dashboard

[Avatar Platform Tracker](https://claude.ai/artifact/E95obUDjLQk1aJzqNZXuPb)

The dashboard shows a copy of the five tracker files. It does not update by itself: after the
tracker files change, ask Claude to refresh the dashboard, which uploads the new files. The link
is private to its owner until shared from the page's Share menu.
