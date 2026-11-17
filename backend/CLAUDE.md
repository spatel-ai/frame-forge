# Frameforge API (backend)

The parent [CLAUDE.md](../CLAUDE.md) governs all work here. This file adds backend specifics and
never overrides it. If the two disagree, the parent file wins; fix this file.

## How the parent file applies here

| Parent section | What it means for backend work |
| --- | --- |
| §2 Think → Validate → Decide → Execute → Verify | Follow it for every task in [docs/MILESTONES.md](../docs/MILESTONES.md). Material choices go in [docs/DECISIONS.md](../docs/DECISIONS.md) with all five parts |
| §3 Discovery | New requirements and unknowns go in [docs/tracker/requirements.json](../docs/tracker/requirements.json) with one of the five classes: Confirmed, Assumed, Needs Verification, Deferred, Out of Scope. Never turn an assumption into Confirmed silently. Anything touching cost, privacy, security, consent or core behaviour becomes a question for the owner, not a default |
| §4 Evidence | Never write a provider call, SDK function or parameter from memory. Check the installed package or the provider's documentation and record the date. If evidence cannot be had, write: "Not verified — requires documentation review, execution, or live integration testing." A mock test is not evidence of a live integration |
| §5 Alignment | Before each phase, compare the work with the requirements, the code and the contracts; drop or simplify work that no longer adds value |
| §6 Gates | All four gates (A before starting, B before integrating, C before any paid or live run, D before calling it done) apply; the checklist is in MILESTONES.md. A failed gate means correct it, cut scope or report a blocker; never bypass it |
| §7 Delegation | Each task names its owner model; Haiku never gets an ambiguous architectural decision. Use the nine-part brief in [docs/README.md](../docs/README.md). Agents give evidence; Fable never approves on an agent's word alone |
| §8 Stop conditions | All nine conditions of parent §8 apply, with its six steps for recurring failures. In particular: a provider fact cannot be verified, a change would cost money without approval, a contract is inconsistent, a security issue is found, or two fixes have failed without new evidence |
| §9 Scope | Classify improvements as required (correctness, safety, acceptance), optional or future; build only the required ones without asking |
| §10 Reporting | Report with the seven points and the five statuses. The template is in docs/README.md |

## Read before changing anything

| Document | Read it for |
| --- | --- |
| [docs/HLD.md](../docs/HLD.md) | Architecture, data model, the purchase, charging, script and banner flows |
| [docs/DECISIONS.md](../docs/DECISIONS.md) | Why each choice was made. Do not contradict a decision; propose a new one |
| [docs/MILESTONES.md](../docs/MILESTONES.md) | What to build next, who owns it, and its acceptance criteria |
| [docs/tracker/](../docs/tracker/) | Current status of tasks, questions, requirements |

Work only on tasks in the current milestone. A task marked **Optional** is not built unless the
owner asks. If a task needs something the design does not cover, stop and update the design first.

## Working in parallel (decision D-022)

Several tasks may be in progress at once. The lanes, their files and each task's "starts after"
list are in [docs/MILESTONES.md](../docs/MILESTONES.md), section "Parallel plan".

- Start a task only when every task it starts after is Done and no other task is active in its lane.
- Change only your lane's files. If you need a change in `app/core/`, `app/main.py`, `pyproject.toml` or the migrations folder, hand it to the BE-Core
  lane; do not edit those yourself.
- Work in your own git worktree and branch. Fable merges one branch at a time.
- Do not edit `docs/tracker/` from a parallel task; report your status and evidence, and the
  integrator records it at merge.
- If the task cannot be done without touching another lane's files, stop and report.

## Cost and test rule (owner, 2026-11-17; decision D-021)

- **Allowed without asking:** tests that use the mock provider and signed fixtures. They make no
  network calls.
- **Needs the owner's approval for that run** (Gate C): any call to fal.ai; any call to Razorpay,
  including test mode; anything that sets `AVATAR_PROVIDER=fal` or starts the `backend-live`
  configuration.
- Before asking, state what will run and the expected cost.
- A passing mock test is `MOCK-VERIFIED`. Only an approved real run earns `VERIFIED` for a
  provider integration.

## Stack

Python 3.13+, FastAPI, `uv`, PostgreSQL 17 in Docker, SQLAlchemy 2.1 (synchronous, D-023),
Alembic, psycopg 3, pytest, Ruff, mypy. Files on local disk. ffmpeg is optional today and required
from M5 (D-019).

Do not add a dependency without an entry in the decision log.

## Commands

```bash
docker compose up -d db                                    # from the repo root; start PostgreSQL
uv run alembic upgrade head                                # build or update the tables
uv run uvicorn app.main:create_app --factory --port 8000   # mock mode, free
./check.sh                                                 # Ruff, format check, mypy, tests (mock, free)
uv run python -m app.export_openapi                        # print the API contract; needs no database
```

Tests need the database running. Each test builds and drops its own schema, so they never touch
development data.

## Layout

```text
app/main.py            wiring only: app, lifespan, routers, error handlers, middleware
app/core/              config, database engine, error shape, request-id logging, origin check, health
app/auth/              users, sessions, email links, passwords, rate limits, current_user dependency
app/jobs/              db.py (store), service.py (lifecycle and charging), routes.py, schemas.py, errors.py, models.py
app/wallet/            ledger.py (the only writer of wallets and ledger_entries), routes, cli.py (grant)
app/payments/          Razorpay orders, verify, webhook (M4; contract stubs today)
app/providers.py       fal and mock
app/export_openapi.py  prints the API contract
migrations/            Alembic; one chain, ordered by the BE-Core lane
tests/                 conftest.py gives each test a fresh schema
```

`core` never imports from a feature package; a test enforces it. A feature registers its own error
handlers and router from `main.py`. New features follow the `jobs` package's shape. Target modules
are listed in HLD §3.

## Rules that protect money

Breaking one of these can charge a customer wrongly or pay fal.ai twice.

1. **Only the `wallet` module changes a balance.** No other code writes to `wallets` or
   `ledger_entries`.
2. **Ledger rows are never updated or deleted.** A correction is a new row.
3. **A job's status change and its ledger entry commit in one transaction.** See the table in
   HLD §5.2. If you add a status change, decide its wallet effect in the same change.
4. **Status changes stay compare-and-set.** `UPDATE … WHERE id = ? AND status = ?`, and act only
   if one row changed.
5. **Never retry a paid call whose outcome is unknown.** Fail the job and flag it for staff. For
   the video submission, capture the hold (the owner's decision on Q-19, D-005: the customer is
   charged). For the voice call, return the 10 credits (D-048: no voice reached the customer). A
   clear failure releases the hold or returns the voice charge.
6. **Credits and paise are integers.** No `float` for money, in code, JSON or the database.
7. **Credits are granted only by the one crediting routine**, after signature, `captured` status
   and amount have all been checked. Never from a value the browser sent. The one exception is
   the development-only grant command (`app/wallet/cli.py`), which refuses to run unless
   `AVATAR_ENV=development` and still writes through the ledger.
8. **Verify the Razorpay webhook signature on the raw body before reading it.** Dedupe on the
   event id header.
9. **Every money-moving action is idempotent.**
10. **Banners never change the price.** The joining step must not touch the wallet except for the
    single `capture` when the job completes.

## Rules for scripts, templates and joining

1. A job stores its own copy of the script text. Never read a job's script through `script_id`.
2. A saved script goes through the same checks as a pasted one: length, language, alphabet.
3. Only admins create or retire templates. Templates are retired, never deleted.
4. Measure every clip with `ffprobe` when it is added; refuse anything that is not a playable
   video within the length setting.
5. **The joining step calls no paid service and may be retried.** This is the opposite of a
   fal.ai submission. Keep the two code paths separate so the "never retry" rule is not weakened.
6. Measure the AI video before joining. Do not assume its picture size, frame rate or sound
   format; they are not documented (requirement R-67).
7. Keep the AI video file after joining. If joining fails for good, it is what the customer gets.
8. Pass file paths to ffmpeg as arguments, never through a shell string.

## Rules that protect customers

1. Every query for a job, media file, script, wallet or payment filters by the logged-in user.
   Another user's resource returns 404, not 403.
2. Passwords are hashed with Argon2id and never logged. Session tokens are stored hashed.
3. Secrets come from environment variables only. Never commit `.env`. Never return a secret, a
   stack trace or a provider's raw error to the browser.
   `backend/.env` holds the Razorpay key id and secret and is off-limits to every agent and
   assistant: never open, print, copy, grep, source or edit it, by any tool or shell command.
   `.claude/settings.json` denies it to Claude Code's file tools. Read `backend/.env.example` for
   variable names. If a task seems to need a real value, stop and ask the owner.
4. Do not log photos, script text, emails, full payment identifiers, or request bodies of auth and
   payment routes.
5. Uploaded images are re-encoded before storage, as today.
6. A job cannot be created without recorded consent (from M5).

## API conventions

- Contract first: a milestone's routes are written into the OpenAPI document (tasks T-200, T-300,
  T-400, T-500, T-600) before backend or frontend work on them begins.
- Routes under `/api/v1` (from M1).
- Errors: `{"detail": "<message for the user>", "code": "<machine_code>"}`. For an input error, also
  return `"fields": {"<field>": "<message>"}` naming each field at fault, so the interface can show
  the message under that field (D-029, [docs/UX.md](../docs/UX.md) section 7).
- Error messages are read by customers: plain words, what went wrong, what to do next. Never a
  technical term, an exception name or an internal id.
- Status codes: 400 bad link or signature, 401 not logged in, 402 not enough credits, 403 not
  allowed, 404 missing or not yours, 409 wrong state, 422 invalid input, 429 too many requests or
  the daily video limit, 500 unexpected error, 501 not built yet, 502 payment provider
  unavailable, 503 database unavailable. The error `code` is what clients branch on; the codes in
  use are listed in the M2, M3 and M4 plans.
- A change to a response is a contract change: update the frontend types in the same work.
- Database changes go through Alembic migrations only. Never edit an applied migration.

## Tests

- Write the test with the code. Money paths need a test for the repeat case (same request twice)
  and the race case (two requests at once).
- Each test names the requirement it covers (for example `R-10`) in its docstring, so a
  requirement can be traced to its test.
- Tests never touch fal.ai or Razorpay over the network.

## When you finish a task

1. Set its `status`, `verification` and `evidence` in
   [docs/tracker/tasks.json](../docs/tracker/tasks.json). `verification` is one of the parent
   file's five statuses, stated honestly. When working in parallel, report these instead and the
   integrator records them at merge.
2. If you made or changed a decision, add it to [docs/DECISIONS.md](../docs/DECISIONS.md) and run
   `python3 docs/tracker/sync.py`, which rebuilds `decisions.json`. When working in parallel,
   report the decision instead; the integrator records it.
3. If you found a new requirement or unknown, add it to `requirements.json` or `questions.json`.
4. Report with the template in docs/README.md, including what was not run.
5. Ask the owner whether to refresh the dashboard from the tracker files.
