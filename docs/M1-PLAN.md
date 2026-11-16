# M1 Plan — Platform foundation

Status: **Approved by the owner on 2026-11-17.** Task status is in [tracker/tasks.json](tracker/tasks.json).

## Context

M1 changes nothing a customer can see. It rebuilds the ground the paid platform stands on: data
moves from SQLite to PostgreSQL, the API gets a version and a fixed error shape, the backend is
split into the modules the parallel plan assumes, and the frontend becomes a routed app with
tests. Login (M2), wallet (M3) and payments (M4) all start from here.

Exit evidence (from `docs/MILESTONES.md`): the existing create → approve → video flow works as
before in mock mode, with data in PostgreSQL, routes under `/api/v1`, a routed frontend, and the
existing backend tests passing against PostgreSQL. Status reachable in M1: **MOCK-VERIFIED**.

All work is on the `development` branch. No fal.ai or Razorpay call is made anywhere in M1.

## Proactive discovery for M1

Checked on 2026-11-17 by reading the code and querying this machine and the package registries.
Nothing was installed or changed.

### Findings that change the plan

| # | Finding | Evidence | Effect on M1 |
| --- | --- | --- | --- |
| 1 | The API returns plain dictionaries with no declared response shapes, so its OpenAPI document describes no response fields. Generated frontend types would be empty. | `backend/app/main.py`: every route returns `dict` | T-104 must add declared response models **before** the frontend generates types. Type generation moves after T-104 |
| 2 | The type generator `openapi-typescript` 7.13.0 declares it needs TypeScript 5; the project uses TypeScript 7. | `npm view` peer dependencies; `frontend/package.json` | Needs Verification. A 15-minute trial decides: it works as a standalone command, or we pick another generator. Do not assume |
| 3 | The backend is five flat files. The parallel plan's lanes (`app/core/`, `app/jobs/`, …) do not exist yet, and no task creates them. | `backend/app/` listing | New task **T-106**: restructure into packages as a pure move, first, while tests still run on SQLite to prove nothing changed |
| 4 | Tests build the store from a SQLite file in a temp folder. On PostgreSQL every test needs a database. | `backend/tests/test_jobs.py` lines 27–32 | Tests will need Docker running. Each test gets its own empty schema. Only test setup changes; assertions stay |
| 5 | Two HTTP tests and the frontend call `/api/...` paths directly. | `test_jobs.py` lines 340–385; `frontend/src/api.ts` | Moving to `/api/v1` changes those paths in the same step, or the frontend breaks. Sets the merge order |
| 6 | Docker 29.8.2 with Compose is installed and running; no PostgreSQL is installed; port 5432 is free. | `docker info`, `which psql`, `lsof` | PostgreSQL runs in Docker for development and tests (default, D-024) |
| 7 | The backend has no linter or type checker configured. | `backend/pyproject.toml` | T-105 must choose and add them (D-025) |
| 8 | Settings are already a typed, frozen dataclass read from the environment. | `backend/app/config.py` | T-101 shrinks to adding `DATABASE_URL`. No settings library is added |
| 9 | Several packages are newer than I have used: React Router 8.5.1, SQLAlchemy 2.1.8, Alembic 1.20.1, psycopg 3.3.9, Vitest 5.1.0, TanStack Query 5.107.1. | Registry lookups | Each lane reads the installed version's documentation before writing calls (parent §4). No API is written from memory |
| 10 | `backend/data/jobs.sqlite3` holds old POC test jobs. | Directory listing | Assumed: not migrated. It is internal test data; the file is left in place, unused |

### Classified register for M1

| Class | Item |
| --- | --- |
| Confirmed | Work on `development`; `main` only at launch. Free mock tests may run; paid calls need approval |
| Assumed | Database access stays synchronous, as today (D-023). Job ids stay 32-character text. API timestamps keep their current text format. Mock stays the default provider. Old SQLite data is not migrated. Still no login, so the backend still listens on localhost only |
| Needs Verification | Finding 2 (type generator with TypeScript 7). Exact APIs of the six packages in finding 9. Whether per-test schemas keep the test run acceptably fast |
| Deferred | A hosted CI service (the repository has no remote). Asynchronous database access. Browser end-to-end tests. Any change to the fal.ai provider code |
| Out of Scope | Login, wallet, payments, scripts, banners (M2 onward) |

### Risks

| Risk | Handling |
| --- | --- |
| The move to PostgreSQL weakens the compare-and-set that stops double payment | T-103 is owned by Opus; the existing duplicate-approval and restart tests are the acceptance bar and are not edited |
| Database calls briefly block the server's event loop | Same as today with SQLite. Recorded in D-023 with the trigger for revisiting |
| Backend path change lands before the frontend follows | T-104 and the frontend client switch merge together at Gate B |
| Restructure collides with other backend work | T-106 runs alone, first; nothing else touches the backend until it is merged |

## New decisions to record (Proposed)

| ID | Decision | Why |
| --- | --- | --- |
| D-023 | Synchronous SQLAlchemy with psycopg; the job store keeps its current five methods | Smallest change: the service and its tests keep working unchanged. Async is deferred until blocking is measured as a problem |
| D-024 | PostgreSQL runs in Docker for development and tests; each test uses its own schema | Docker is already installed; identical on every machine; tests run against the real database engine |
| D-025 | Backend tooling: Ruff for lint and format, a type checker chosen at install after confirming it supports the code as written | None exists today; M1 must provide one check command |
| D-026 | Frontend tests: Vitest with React Testing Library and jsdom; the API module is mocked directly | Vitest supports the project's Vite 8; no extra mocking server is needed for one client module |

## Phases and steps

Two lanes run side by side after Phase 0. Each step ends with its mock tests passing and a
one-line entry in the tracker.

### Phase 0 — Gate A and setup (Fable)

1. Record this plan as `docs/M1-PLAN.md`; add T-106 and D-023 to D-026 to the docs and tracker.
2. Gate A checklist: requirements still wanted, acceptance criteria written, owners assigned,
   package facts verified (step 3).
3. Run the type-generator trial (finding 2) in a scratch folder against a sample OpenAPI file.
   Record the result; if it fails, record the replacement as a decision before Phase 4.
4. Baseline: run the existing backend tests once (mock, free) and record the count.

### Phase 1 — Restructure and shell (parallel)

| Step | Task | Owner | What happens | Done when |
| --- | --- | --- | --- | --- |
| 1B | T-106 | Sonnet | Move `config.py` → `app/core/`, `db.py` + `service.py` → `app/jobs/`, `providers.py` → `app/providers/`; `main.py` keeps wiring. Imports updated; no logic edits | Same tests, same count, still on SQLite |
| 1F | T-110 | Sonnet | Add React Router; create `routes.tsx`, the app shell (header with the mock badge and AI notice), the `features/create/` folder, `styles/tokens.css`. `App.tsx` logic moves unchanged | App runs and behaves as before; type check and lint pass |

### Phase 2 — Database foundation (backend lane)

| Step | Task | Owner | What happens | Done when |
| --- | --- | --- | --- | --- |
| 2a | T-101 | Sonnet | `docker-compose.yml` with PostgreSQL; `DATABASE_URL` added to `Settings` and `.env.example`; start-up steps documented | Database starts from the documented steps; app refuses to start with a clear message when it is unreachable |
| 2b | T-102 | Sonnet | SQLAlchemy model for `jobs` matching today's 13 columns; Alembic set up; first migration | An empty database is built by `alembic upgrade head` alone |

### Phase 3 — Port the job store (backend lane)

| Step | Task | Owner | What happens | Done when |
| --- | --- | --- | --- | --- |
| 3 | T-103 | Opus | `JobStore` keeps `create`, `get`, `list_by_status`, `transition`, `close`, now on PostgreSQL. `transition` stays one `UPDATE … WHERE id AND status` that reports whether exactly one row changed. Test fixture creates a schema per test | Every existing test passes on PostgreSQL with assertions untouched, including second-approval-rejected and both restart tests |

### Phase 4 — Versioned API (backend lane) with frontend test setup alongside

| Step | Task | Owner | What happens | Done when |
| --- | --- | --- | --- | --- |
| 4B | T-104 | Sonnet | Routes move to `/api/v1`; declared response models for config and job; one error handler producing `{detail, code}` for every error including validation; request id on each log line and response; `/healthz` checks the database | A test asserts the error shape on every error path; OpenAPI lists every response field |
| 4F | T-112 | Haiku | Vitest, React Testing Library, jsdom; first tests for the create form's validation; one command for lint + type check + tests | Command passes |

### Phase 5 — Join the lanes

| Step | Task | Owner | What happens | Done when |
| --- | --- | --- | --- | --- |
| 5a | T-113 | Sonnet | Generate API types from the backend's OpenAPI; replace hand-written types; client calls `/api/v1` | No hand-written response type remains |
| 5b | T-111 | Sonnet | Create flow on `/create` and `/create/:jobId` using TanStack Query; polling only in the three in-progress statuses; job id in the address instead of browser storage | Reloading at any step resumes the job; tests cover each status screen |
| 5c | T-105 | Haiku | Ruff and the type checker configured; one backend command for lint + type check + tests; documented in `backend/CLAUDE.md` | Command passes |

### Phase 6 — Gates B and D (Fable)

1. Gate B: merge backend then frontend into `development`, mock tests after each merge.
2. Run the whole flow in the browser in mock mode: create, listen, approve, watch the video,
   reload mid-way. Confirm the "Mock mode" badge is showing first.
3. Gate D: evidence against each acceptance criterion; milestone report in the parent file's
   seven-point format; tracker and dashboard updated; commit.

## What can run in parallel

Phase 1: steps 1B and 1F. Phases 2–3 (backend) alongside step 4F (frontend tests). The API
contract for M2 (T-200) can be written by Fable at any point. Phase 5 needs both lanes.
The backend lane itself is serial: T-106 → T-101 → T-102 → T-103 → T-104.

## Files

- New: `docker-compose.yml`, `backend/migrations/`, `backend/app/core/`, `backend/app/jobs/`,
  `backend/app/providers/`, `frontend/src/routes.tsx`, `frontend/src/api/`,
  `frontend/src/features/create/`, `frontend/src/styles/`, `docs/M1-PLAN.md`
- Changed: `backend/app/main.py`, `backend/pyproject.toml`, `backend/.env.example`,
  `backend/tests/test_jobs.py` (setup and paths only), `frontend/package.json`,
  `frontend/src/App.tsx`, `frontend/vite.config.ts`, `README.md`, `.claude/launch.json`,
  both child `CLAUDE.md` files, `docs/MILESTONES.md`, `docs/DECISIONS.md`, `docs/tracker/`
- Untouched: `backend/app/providers.py` logic (moved, not edited), the parent `CLAUDE.md`

Reused as they are: the compare-and-set in `JobStore.transition`, the whole `JobService`
lifecycle, `MockProvider`, the image re-encoding, the frontend's `request()` error handling and
polling rule.

## Verification

- After every step: the backend mock tests (free). From Phase 3 they run against PostgreSQL in
  Docker.
- Phase 6 browser run in mock mode, as described above.
- Not run in M1: anything against fal.ai. The live integration stays unverified, as recorded.

## Approval record

The owner approved this plan on 2026-11-17. That approval confirmed the decisions M1 relies on:
D-001 (keep the POC), D-002 (PostgreSQL), D-011 (frontend stack), D-012 (API shape) and D-022
(parallel lanes). All other Proposed decisions stay Proposed.

Step 5a is tracked as task T-113. The owner's approval is tracked as task T-010.

## Phase 0 results (2026-11-17)

| Check | Result | Status |
| --- | --- | --- |
| Baseline backend tests | 30 passed in 0.86 s, mock provider, on SQLite | MOCK-VERIFIED |
| Type generator with TypeScript 7 (finding 2) | `openapi-typescript` 7.13.0 **cannot be installed** beside TypeScript 7.0.2: npm refuses the peer dependency. Run on its own with `npx openapi-typescript@7.13.0 <openapi.json> -o <file>` it generates the file, and the project's TypeScript 7.0.2 type-checks that file and rejects a wrong type as expected | VERIFIED by execution |
| Response shapes in OpenAPI (finding 1) | Confirmed: the generated OpenAPI lists only the upload body and validation errors; no job or config fields | VERIFIED by execution |

Consequence for step 5a (T-113): the generator is run with `npx` at a pinned version from an npm
script. It is not added to `package.json` dependencies. The generated file is committed, so a
normal install and build never need the generator.

## Milestone report (2026-11-17)

**Status: MOCK-VERIFIED.** Everything below ran with the mock provider. Nothing reached fal.ai or
Razorpay. The live fal.ai integration remains unverified, as before M1.

| Point | Report |
| --- | --- |
| What was implemented | Backend split into `core` and `jobs` packages; PostgreSQL 17 in Docker with Alembic; the job store on PostgreSQL; routes under `/api/v1` with declared response shapes, one error shape, request ids and `/healthz`; Ruff, mypy and `check.sh`. Frontend: router and shell, feature folders, generated API types, the create flow on `/create` and `/create/:jobId` with TanStack Query, Vitest |
| Why it was necessary | Login, wallet and payments need a database with row locks, a versioned contract both sides build to, and separate packages so lanes can work in parallel |
| What was verified | Backend: 56 tests against PostgreSQL, including 12 threads approving one job with exactly one winner; no existing assertion changed. Frontend: 32 tests. In headless Chrome against the real backend and database: 20 checks covering redirect, not-found, validation, create, audio review, approve, video, reload at each step, polling stopping, the stored-job redirect, a missing job, and 360 px width |
| Which tests were executed | `backend/check.sh` (Ruff, format, mypy, pytest); `npm run check` and `npm run build`; a scripted browser run. All free |
| What remains unverified | Anything on fal.ai. The picture inside the mock video was not inspected; the file was served and the player loaded it. The 5-second database connect timeout against a host that drops packets. Background-tab polling |
| Known risks or limitations | Database calls block the event loop briefly (D-023). Tests need Docker running and take about 2.8 s instead of 0.9 s. Tests are not type-checked. One lint warning carried over from the original preview code. Still no login, so the backend must stay on localhost |
| Next justified action | Owner answers Q-02 (login method) so M2 can pass Gate A. T-200 (auth contract) and T-507 (banner-joining module) depend on nothing else and can start |

Review findings raised and closed inside the milestone: the compose project name (one database
across worktrees), 422 responses declared with the wrong shape, and `core` importing from a
feature package. The last two are now guarded by tests.

Deviations from the plan: `providers.py` was left in place rather than moved into a package; the
stored job id was kept as a fallback next to the address, so a returning visitor still lands on
their job.
