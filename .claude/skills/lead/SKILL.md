---
name: lead
description: Run a milestone, slice or task on Frameforge as a lead with a team of agents (scouts, builders, a merger, reviewers). Analyses the whole scope, sorts tasks into sequential, concurrent and blocked, runs them in phases in separate worktrees, and pauses after each phase. Use for "/lead M3.5", "/lead T-355", or "run this milestone with agents".
---

# Lead

Run a goal on this repository as a lead with a team of agents.

## Goal

Goal and limits: **<milestone | task ids | free text> [limits]** (the skill's arguments).

If no goal is given, run `python3 docs/tracker/sync.py`, propose the tasks it lists under "can
start now", and ask which to run.

## Roles

You are the **lead**. You plan, assign, analyse, order merges and review. You write no feature
code. You do write `docs/` (the Docs lane).

| Role | Model and effort | Does |
|---|---|---|
| Lead | Fable, medium | Plans, assigns, reads reports, orders merges, reviews, writes docs |
| Scout | Haiku, low | Read-only discovery for one task; returns a task card |
| Builder | Sonnet, medium. Opus, high, for risky work (login and sessions, wallet and ledger, Razorpay and webhooks, job charging and idempotency, consent, uploads, data migrations) | Builds one task in its worktree slot, commits on its branch, reports |
| Merger | Opus, medium | Merges approved branches into `development`, regenerates the API contract, re-runs the merged checks, updates the tracker |
| Security reviewer | Sonnet, high | Reviews merged work in sensitive areas |

Choosing a builder model: if a mistake could break a rule under "Rules" below, or touch money,
login, consent or a person's uploaded likeness, use Opus. Otherwise use Sonnet. Haiku only for
small, unambiguous tasks (root `CLAUDE.md` §7).

## 1. Orient

- Read the root `CLAUDE.md`, `docs/MILESTONES.md` (task tables and "Parallel plan"),
  `docs/DECISIONS.md` entries the goal cites, the goal's `docs/Mx-PLAN.md` if it exists, and
  `frontend/CLAUDE.md` or `backend/CLAUDE.md` for the side being changed.
- Run `git status --short`, `git branch --show-current` (must be `development`) and
  `git worktree list`.
- Run `python3 docs/tracker/sync.py`. If it does not print "cross-check passed", say so before
  anything else.
- If the work needs a browser or the API: the mock backend must be running (`.claude/launch.json`,
  entry `backend-mock`; it needs the database from `docker compose up -d db`). Say so if it is not.

## 2. Analyse the whole scope

Work out the goal's full scope before planning anything:
- a milestone means every task under it in `docs/MILESTONES.md` that is not Done in
  `docs/tracker/tasks.json`, plus the tasks its "Starts after" column names that are not Done;
- a task id means just that task.

1. Break the scope into tasks of one builder each. Use the existing T-ids; a task that does not
   exist yet is added to `docs/MILESTONES.md` first (task row and lane row).
2. Scout each task, in parallel. A scout reads and never edits, and returns a card of at most
   150 words. Skip the scout where the plan file already holds this information.

   ```
   Task: <T-id and name>
   Goal: <one line>
   Side: backend | frontend | both
   Lane: <lane from docs/MILESTONES.md>
   Touches: <files and modules>
   Hotspots: <list or none>
   Reuse: <function or component (file)>
   Depends on: <list or none>
   Sensitive: no | yes (<which>)
   Tests: <unit tests>; <browser check file>
   Suggested model: haiku | sonnet | opus (<why, if not sonnet>)
   ```

   Hotspots are files two tasks must not change at the same time. They are the integrator lanes:
   - `frontend/src/routes.tsx`, `frontend/src/api/`, `frontend/src/styles/`, `frontend/package.json`,
     `frontend/index.html`, `frontend/vite.config.ts`, `frontend/e2e/` (FE-Shell);
   - `frontend/src/components/AppShell.*` and `components/shell/` (FE-Frame); the rest of
     `frontend/src/components/` (FE-Components);
   - `backend/app/core/`, `backend/app/main.py`, `backend/pyproject.toml`, `backend/migrations/`
     (BE-Core); `backend/app/jobs/` (BE-Jobs, strictly one task at a time);
   - `frontend/src/api/openapi.json` and `schema.d.ts` (generated);
   - `docs/` and `docs/tracker/` (the lead and the merger only).
3. Classify every task:
   - **Sequential:** another task depends on it; it depends on another task in scope; it shares a
     lane or a hotspot with another task; or it is a close-out step.
   - **Concurrent:** depends on nothing still unbuilt and shares no lane or hotspot with the other
     tasks in its batch.
   - **Blocked:** waits on an owner decision (`docs/tracker/questions.json`), an owner approval
     (any fal.ai, Razorpay or real email run) or an external input. Never built; reported.
4. Order the work into **phases**. A phase is either one sequential chain or one concurrent batch.
   Never both.
   - Dependencies always come first. A task that others build on goes in a phase before the batch
     that needs it.
   - Sequential work that builds on the concurrent results goes in a phase after that batch.

## 3. Report the analysis and ask

Print three lists, then the phase plan:

```
Sequential (one after another)
  S1 <task> — why sequential (what depends on it / what it needs) — model, effort
Concurrent (side by side)
  C1 <task> — model, effort
Blocked
  B1 <task> — what it waits for

Phase plan
  Phase 1  sequential  S1 → S2        (foundation for phase 2)
  Phase 2  concurrent  C1 · C2 · C3   (slots 1–3)
  Phase 3  sequential  S3              (needs C1 and C2)
```

Ask about anything ambiguous with options. Then ask how to proceed:
- **All phases in order:** dependencies first, pausing after each phase. Recommended.
- **Only up to the first concurrent batch:** run the foundations and that batch, then stop.
- **One phase only:** the owner names which. Only allowed if everything that phase depends on is
  already on `development`.
- **Change the plan:** the owner adjusts tasks, models or order; re-print and ask again.

Build nothing until the owner answers. If the owner has already approved this exact phase plan in
plan mode, that approval is the answer for "all phases in order".

## 4. Run each phase

### Worktree slots

Every task runs in its own slot (1–8):

- **Create:** `git worktree add .claude/worktrees/<task> -b wt/<slot>-<task> development`, then
  `npm ci` in its `frontend/` (or `uv sync` in its `backend/`) if the task runs checks there.
- **Slot n's frontend dev server:** `npm run dev -- --port 517n --strictPort`. Port 5173 belongs
  to the main checkout; never use it from a slot.
- **Backend for frontend tasks:** all slots share the one mock backend on port 8000, started from
  the main checkout. A frontend builder never starts or stops it.
- **Backend tasks** that need their own API or database are run one at a time unless the lead
  gives each its own port and database name in the brief.
- **Keep at most three browser (Playwright) runs at once.**
- **Clean-up:** `git worktree remove .claude/worktrees/<task>` and `git branch -d wt/<slot>-<task>`
  once the task is merged and reviewed.

### Phases

- **Sequential phase:** one task at a time. Each task is built, merged into `development` and
  reviewed before the next starts, and the next one starts from the new `development`.
- **Concurrent phase:** start every task in the batch together. Merge them in the order you choose
  once all have reported, then review the batch as a whole.

### Every task

1. **Build.** Give the builder a brief with the nine parts from `docs/README.md` (business
   objective, technical objective, context, assumptions and constraints, file ownership, required
   interfaces, acceptance criteria, expected verification, escalation conditions), plus its slot and
   card. Point at files; never paste their contents. The builder:
   - works only in its worktree and only in its lane's files; if it must change another lane's
     file it stops and reports;
   - never edits `docs/`, `docs/tracker/` or the main checkout, and lists the doc changes it needs
     in its report;
   - follows the root `CLAUDE.md` and the side's `CLAUDE.md`;
   - commits on its branch as the repository's configured author, with no co-author line, and
     never pushes;
   - runs only lint, type check, the unit tests it touched and its own screen's browser check, on
     its slot.

   It reports in at most 300 words:

   ```
   Task / slot / branch:
   Built: one line per change
   Commits: <hashes>
   Checks: <command> — pass|fail (counts)
   Doc changes needed: <file> § <section>: <exact text>
   Risks and open questions:
   ```
2. **Analyse** the report. If anything is missing or inconsistent, send the builder back with
   precise asks. Never re-run its checks without a reason. A builder's claim is not evidence: the
   merged checks in step 3 are.
3. **Merge.** The merger checks the main checkout is clean and on `development`, then:
   - merges the approved branches into `development`, one at a time;
   - never merges `openapi.json` or `schema.d.ts` as text, but regenerates them
     (`npm run gen:api` in `frontend/`);
   - re-runs `npm run check` in `frontend/` and/or the backend mock tests after each merge, and the
     merged screens' browser checks at the end;
   - sets each merged task's status, verification and evidence in `docs/tracker/tasks.json`,
     applies the reported doc changes, and runs `python3 docs/tracker/sync.py`.

   It never pushes.
4. **Review.**
   - Read the merged diff (`git diff <before>..development`) and the merger's report. For screen
     work, look at the saved screenshots.
   - For login, wallet, payments, webhooks, charging, consent or uploads, also run a security
     review.
   - If anything is inconsistent, send the merger a fix and review again.

**After each phase, pause.** Print the status table and what was merged (commit range). Re-check
the next phase against the new `development`: a phase can expose a new dependency. Ask before
starting it.

## 5. Finish

Print:
- the whole status table: ID, task, phase, model, slot, status (using VERIFIED, MOCK-VERIFIED,
  IMPLEMENTED UNVERIFIED, BLOCKED, DEFERRED from the root `CLAUDE.md` §10);
- what was merged;
- which checks ran and their results;
- what is still blocked or open.

Write the milestone report into the milestone's `docs/Mx-PLAN.md` using the template in
`docs/README.md`.

## Rules

- The root `CLAUDE.md` governs and is never edited.
- Mock provider only. No fal.ai, Razorpay (test mode included) or real email call without the
  owner's fresh approval for that run. If the "Mock mode" pill is missing in the browser, stop.
- Never open, search, append to or edit `backend/.env`.
- Never start a task before everything it depends on is merged and reviewed.
- Never mix sequential and concurrent work in one phase.
- Never push, and never merge anywhere but `development`, unless the owner asks. `main` is for the
  final launch only.
- Commits carry no Claude co-author line.
- Run full test suites and a general code review only when the owner asks or a close-out task
  says so.
- A mock-verified result is never reported as live-verified; an emulated-browser result is never
  reported as verified on real devices.
- Print the whole status table each time a task starts or finishes.
