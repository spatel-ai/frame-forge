# Decision Log — Frameforge

Every decision records the five parts the parent [CLAUDE.md](../CLAUDE.md) §2 asks for: the
choice, the alternatives considered, the reason, the trade-off, and how it will be validated.

A decision has one of four statuses:

- **Confirmed** — stated or approved by the owner. A proposal becomes Confirmed only when the owner
  approves it; engineering never marks its own proposal Confirmed. D-001, D-002, D-011, D-012 and
  D-022 were confirmed when the owner approved the M1 plan on 2026-11-17.
- **Proposed** — recommended by engineering; becomes Confirmed when the owner approves these docs.
- **Needs owner** — affects cost, privacy, security, consent or core behaviour, so it waits for
  the owner's answer to the linked question in [tracker/questions.json](tracker/questions.json).
- **Superseded** — replaced by a later decision, named in the status line. Kept for history.

A note in brackets after the status word (for example "Confirmed (owner answered Q-19)") is
allowed; the tracker records only the word.

When a decision changes, add a new entry that supersedes the old one; do not rewrite history.
[tracker/decisions.json](tracker/decisions.json) is rebuilt from this file by
`python3 docs/tracker/sync.py`; never edit it by hand.

---

## D-001 — Evolve the POC in place; do not rewrite

**Status:** Confirmed · 2026-11-17 · Area: both

**Choice:** Keep FastAPI, React, the job state machine and its tests. Add users, wallet and payments around them.

**Alternatives:** Start a new codebase on a different stack (for example Next.js + NestJS, or Django).

**Why:** The existing compare-and-set job lifecycle already prevents duplicate paid requests and survives restarts, and its tests pass in mock mode. That is the hardest part to get right. A rewrite would discard it for no requirement we have.

**Trade-off:** We inherit a single-file frontend and a hand-written SQLite store, both reworked in M1.

**Validation:** The existing backend tests pass unchanged in behaviour after each M1 task.

---

## D-002 — PostgreSQL replaces SQLite, with SQLAlchemy 2 and Alembic

**Status:** Confirmed · 2026-11-17 · Area: backend

**Choice:** PostgreSQL for all data. SQLAlchemy 2 for access, Alembic for migrations.

**Alternatives:** Stay on SQLite; MySQL.

**Why:** A wallet needs several writers working safely at once: a payment webhook, an approval and the poller can all touch one wallet in the same second. PostgreSQL gives row locks, `CHECK` constraints that hold under concurrency, and standard backups. SQLite allows one writer at a time and the POC guards it with a process-wide lock.

**Trade-off:** Developers need a local PostgreSQL. Tests need a database instead of a temporary file.

**Validation:** The existing job tests pass against PostgreSQL (task T-103).

---

## D-003 — First-party login with server-side sessions

**Status:** Confirmed (owner chose email and password, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** Email and password. Passwords hashed with Argon2id. A random session token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, with only its hash stored in the database. Email verification and password reset by emailed single-use link.

**Alternatives:** Tokens (JWT) kept in browser storage, rejected because script injection can steal them and they cannot be revoked. A hosted identity service (Auth0, Clerk, Cognito, Supabase Auth): less security code to own, but a cost per user and a second system holding customer data. Phone number + OTP: needs an SMS provider and sender registration, which has not been verified. Google sign-in only: smallest build, but excludes customers without a Google account.

**Why:** A session in a cookie the page's scripts cannot read is the simplest design that resists token theft and supports "log out everywhere". Keeping identity in our own database keeps ownership checks beside the wallet they protect.

**Trade-off:** We own password storage, reset flows and brute-force protection, and need an email provider (Q-04).

**Validation:** The access-control test matrix (T-206) and a security review (T-701).

---

## D-004 — The wallet is an append-only ledger plus a locked balance row

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** Every change to credits is a new row in `ledger_entries`; rows are never updated or deleted. Each user has one `wallets` row with `balance_credits` and `reserved_credits`. Any change locks that row, writes the ledger entry and updates the row in one transaction. A database `CHECK` forbids a negative available balance. `UNIQUE (kind, ref_type, ref_id)` makes each payment and each job step count once.

**Alternatives:** A single balance column with no history (cannot be audited). Summing the ledger on every read (correct, but needs its own locking and slows over time).

**Why:** Money needs a complete history that can be checked: the stored balance must always equal the sum of the ledger. The uniqueness rule makes "did we already credit this payment?" something the database enforces.

**Trade-off:** Two places hold the balance (the row and the ledger), so a test must prove they always agree.

**Validation:** A test runs many approvals and purchases at once and asserts no overspend and balance = sum of ledger (T-305).

---

## D-005 — Hold at approval, capture on completion, release on failure

**Status:** Confirmed (owner answered Q-19, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** Credits are reserved when the customer approves the audio, taken when the video is delivered, and returned when it clearly fails (fal.ai refuses it, errors, or times out). The job status change and the ledger entry are written in one transaction. **When a paid request's outcome is unknown** (the request to fal.ai was cut off and we cannot tell whether it was accepted), **the held credits are captured** (the customer is charged), the job is marked failed and flagged for staff. Owner's decision, 2026-11-17.

**Alternatives:** Charge at approval and refund on failure: the balance visibly drops and returns, and a crash between the two leaves the customer out of pocket. Charge on completion only: two jobs approved together could each pass the balance check and overspend.

**Why:** A hold stops overspending at once without taking credits for something not yet delivered. It maps one-to-one onto status changes the POC already has.

**Trade-off:** In the unknown-outcome case the customer pays for a video they did not receive. This is rare (a cut-off request), but it will cause complaints; staff can review flagged jobs and return credits by an audited adjustment (M6).

**Validation:** One test per row of the charging table in HLD §5.2, each asserting the job status and the ledger together.

---

## D-006 — Price is credits per second of AI audio, fixed before approval

**Status:** Confirmed (owner answered Q-01, 2026-11-17: 20 credits per second, so 600 credits for a 30-second video) · 2026-11-17 · Area: both

**Choice:** `price = ceil(audio seconds × credits_per_second)`, with `credits_per_second = 20` as a setting. The price is computed once when the voice is ready, stored on the job, shown to the customer, and that stored value is what is held and captured.

**Alternatives:** A flat price per video (a 5-second video would cost the same as a 30-second one while the fal.ai cost differs sixfold). Price tiers by length.

**Why:** fal.ai bills the video model per second of output ($0.0562 per second, checked 2026-11-17), so a per-second price keeps the margin steady. Storing the price on the job means a later rate change never alters a job in flight.

**Trade-off:** The customer only learns the exact price after the voice is generated; before that they see an estimate.

**Validation:** Tests that the held and captured amounts equal the stored price, including after the rate setting changes.

---

## D-007 — Razorpay is the payment gateway; ₹1 paid = 1 credit

**Status:** Confirmed · 2026-11-17 · Area: both

**Choice:** Customers pay through Razorpay. Each rupee paid adds one credit after the transaction completes.

**Alternatives:** None considered; stated by the owner.

**Why:** Owner requirement (R-02, R-03).

**Trade-off:** Tax on top of the credit amount is undecided (Q-03).

**Validation:** A purchase of N rupees in Razorpay test mode adds exactly N credits (T-407).

---

## D-008 — Keep polling fal.ai for results; do not adopt fal.ai webhooks yet

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** Keep the existing poller.

**Alternatives:** fal.ai queue webhooks (documented, signed with ED25519).

**Why:** Polling is already built, mock-tested and survives restarts. Webhooks need a public address (not available in local development), key fetching and signature checks, and would still need polling as a fallback because results expire.

**Trade-off:** One status request to fal.ai per in-flight video every few seconds.

**Validation:** The existing restart and polling tests keep passing. Revisit if polling volume becomes a measured cost.

---

## D-009 — One backend process with an in-process poller, through launch

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** Run a single backend instance. The poller and the banner-joining step run inside it.

**Alternatives:** A separate worker with a job queue (Celery, RQ, Arq).

**Why:** Nothing known about load needs a second process, and a queue adds a broker to run and monitor. Correctness does not depend on this choice: status changes are compare-and-set in the database.

**Trade-off:** One process is a single point of failure, and video joining shares its CPU with the API. Do not run two instances without first adding a way for pollers to claim jobs.

**Validation:** The restart tests. Measure joining time during M5 to confirm it does not stall the API.

---

## D-010 — Media stays on local disk behind authorised endpoints until hosting is chosen

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** Keep files on local disk during development. Serve them only through endpoints that check the job's owner. Move to object storage in M7 once the hosting target is known (Q-07).

**Alternatives:** Adopt S3-compatible storage now.

**Why:** The storage product depends on where we host, which is undecided. Choosing now would be a guess. The security requirement (only the owner can fetch) is met either way.

**Trade-off:** Storage code is touched twice. Local disk is not acceptable for production; nothing is deployed on it.

**Validation:** The access-control test matrix covers every media route (T-206).

---

## D-011 — Frontend: keep React + Vite + TypeScript; add routing, server-state caching and generated API types

**Status:** Confirmed · 2026-11-17 · Area: frontend

**Choice:** React Router for pages. TanStack Query for fetching, caching and polling. API types generated from the backend's OpenAPI document. Plain CSS with shared design tokens; no component kit.

**Alternatives:** Next.js (server rendering is not needed for a logged-in app). Redux (almost all our state is server data). A component kit such as MUI (heavy for a small number of screens).

**Why:** The app grows from one screen to about fifteen and needs routing, guarded pages and consistent loading and error handling. Generated types make the backend contract the single source of truth.

**Trade-off:** Three new dependencies to keep current.

**Validation:** Exact package versions and their APIs are checked at install time in M1; none are assumed here.

---

## D-012 — One API version prefix and one error shape

**Status:** Confirmed · 2026-11-17 · Area: both

**Choice:** All routes under `/api/v1`. Every error is `{"detail": "<message for the user>", "code": "<machine_code>"}`. HTTP 401 means not logged in, 402 not enough credits, 403 not allowed, 404 not found or not yours, 409 wrong state, 422 invalid input, 429 too many requests.

**Alternatives:** Keep unversioned `/api` routes and FastAPI's default error bodies.

**Why:** The frontend already reads `detail`; adding `code` lets it react to specific cases without matching on message text.

**Trade-off:** Every existing route and the frontend client change once, in M1.

**Validation:** A test asserts every error response matches the shape (T-104).

---

## D-013 — Docs in the repository are the source of truth; the dashboard displays them

**Status:** Proposed · 2026-11-17 · Area: both

**Choice:** Design lives in `docs/*.md`. Status lives in `docs/tracker/*.json`. The tracking dashboard displays a copy of those JSON files.

**Alternatives:** Track in an external tool (Linear, Jira, Notion).

**Why:** Status beside the code is updated in the same change as the code and is visible to every engineer and agent in the repository.

**Trade-off:** The dashboard does not update itself; the files must be uploaded again after they change.

**Validation:** A cross-check that every ID used in the markdown exists in the tracker files.

---

## D-014 — Money is stored as integers

**Status:** Proposed · 2026-11-17 · Area: both

**Choice:** Credits as whole integers. Rupee amounts in paise as integers. No floating-point arithmetic on money in either codebase.

**Alternatives:** Decimal types; floats.

**Why:** Floating-point rounding errors accumulate in ledgers. Razorpay itself uses paise.

**Trade-off:** Prices round up to a whole credit, so the customer can pay up to one credit more than the exact figure.

**Validation:** Database column types are integers; a test covers rounding at the boundaries.

---

## D-015 — Voice generation is not charged separately

**Status:** Superseded by D-038 (owner answered Q-08, 2026-11-17: charge for each voice) · 2026-11-17 · Area: both

**Choice:** The video price covers the voice. A job can only be started when the wallet covers its estimated price, and each user has a daily cap on voice generations.

**Alternatives:** Charge a small fee per voice generation.

**Why:** The owner's requirement is to charge per video. Voice costs the company money on every attempt (about $0.10 per 1,000 characters with MiniMax, per the README), so it needs a guard against unlimited free use.

**Trade-off:** The company pays for voices that never become videos, up to the cap.

**Validation:** Tests for the balance check and the cap (T-503).

---

## D-016 — Razorpay Orders + Standard Checkout; credits granted only on server-verified proof

**Status:** Confirmed (owner approved the M4 plan; facts re-checked in T-401, [RAZORPAY-FACTS.md](RAZORPAY-FACTS.md)) · 2026-11-17 · Area: both

**Choice:** The backend creates a Razorpay order. The browser opens Razorpay Checkout. Credits are granted by one idempotent routine reached from two places: the browser's verify call and the Razorpay webhook. That routine requires a valid signature, payment status `captured`, and an amount equal to the order. A reconciliation task asks Razorpay about orders left unpaid.

**Alternatives:** Trust the browser's success callback (forgeable). Webhook only (the customer waits for the webhook before seeing credits). Payment Links (less control over the flow inside the app).

**Why:** Two independent confirmations with one idempotent crediting step means a closed tab, a late webhook or a duplicate webhook all end in the right balance exactly once.

**Trade-off:** More moving parts than a single callback: a verify route, a webhook route and a reconciliation task.

**Validation:** Signature formula, paise amounts, raw-body webhook verification, event-id dedupe and unordered delivery were checked against Razorpay's documentation on 2026-11-17. Signed-fixture tests (T-406) give MOCK-VERIFIED; a run in Razorpay test mode (T-407) gives VERIFIED. Retry timing: Not verified — requires documentation review, execution, or live integration testing.

---

## D-017 — Script library: private to each customer, saved automatically, copied onto each job

**Status:** Proposed · 2026-11-17 · Area: both

**Choice:** A script is saved to the customer's library the first time it is used. Using identical text in the same language again updates "last used" instead of creating a copy. The customer can delete a saved script. Each job stores its own copy of the script text.

**Alternatives:** Ask the customer to save scripts by hand (history would be incomplete). Have jobs point at the saved script instead of copying it (deleting or changing a script would alter the record of a past video).

**Why:** The owner asked for a history of scripts and a way to pick an earlier one (R-43). Saving automatically makes the history complete without extra clicks. The job's own copy keeps past videos accurate.

**Trade-off:** Script text is stored twice. Scripts are personal content, so they fall under the same access rule and retention answer (Q-09) as photos.

**Validation:** Tests that a repeat use does not duplicate, that deleting a script leaves past jobs unchanged, and that one customer cannot read another's scripts.

---

## D-018 — Banner templates are a company-supplied set of short video clips

**Status:** Confirmed · 2026-11-17 · Area: both

**Choice:** Templates are short video clips of about 2 to 3 seconds, of two kinds: start and end. The company supplies them and an admin adds or retires them. Customers choose from the active set in the customer app; they do not upload their own.

**Alternatives:** Customer uploads; company designs with customer text; still images. The owner chose the company set of clips.

**Why:** Owner requirement (R-44 to R-47).

**Trade-off:** No per-customer branding (deferred, R-72). Clips arrive in whatever format the company supplies, so each one must be checked when added.

**Validation:** A clip is measured with ffprobe when added and refused if it is not a playable video within the length limit.

---

## D-019 — Banners are joined on our server after the AI video arrives

**Status:** Confirmed (owner answered Q-17, 2026-11-17: delivered without banners, full price, told plainly) · 2026-11-17 · Area: backend

**Choice:** A new job step, `video_assembling`, sits between `video_generating` and `completed`. The server measures the AI video, converts the chosen clips to the same picture size, frame rate and sound format, and joins start clip + AI video + end clip with ffmpeg. The step calls no paid service, so it is retried automatically and re-run after a restart. If it still fails, the customer receives the AI video without banners and is charged as normal, and the job is flagged.

**Alternatives:** Let the browser play three files in a row (the download would not contain the banners). Use a paid video-editing service (cost per video and another provider). Fail the whole job when joining fails (the company has already paid fal.ai for the AI video).

**Why:** ffmpeg is already used by the POC, runs on our own server at no charge per video, and produces one downloadable file. Measuring the AI video avoids relying on output formats that are not documented (R-67).

**Trade-off:** ffmpeg becomes a required part of the server (today it is optional). Joining uses server CPU. The fallback charges a customer for a video without the banners they chose, which is why this waits for the owner (Q-17).

**Validation:** Mock-mode tests with small generated clips cover: both banners, one banner, none, a clip with no sound, a retry that succeeds, and the fallback. Whether real model output joins cleanly: Not verified — requires documentation review, execution, or live integration testing.

---

## D-020 — Banner seconds are free

**Status:** Confirmed · 2026-11-17 · Area: both

**Choice:** The price of a video is unchanged by banners. Only AI-generated seconds are priced.

**Alternatives:** Charge banner seconds at the video rate; a flat add-on fee. The owner chose free.

**Why:** Owner requirement (R-48). Banners cost nothing at fal.ai.

**Trade-off:** Joining uses the company's server time without revenue.

**Validation:** A test that a job's price is the same with and without banners.

---

## D-021 — Free mock-mode tests may run; paid or external calls need approval each time

**Status:** Confirmed · 2026-11-17 · Area: both

**Choice:** Tests that use the mock provider and signed fixtures may run during development. Any call to fal.ai, and any call to Razorpay including its free test mode, needs the owner's approval for that run (owner, 2026-11-17).

**Alternatives:** No tests without asking (the owner's first instruction, replaced the same day). No tests at all.

**Why:** The parent CLAUDE.md requires relevant tests before work is called done. Mock tests cost nothing at any provider, so they satisfy that rule without the cost the owner is guarding against.

**Trade-off:** Mock tests prove our logic, not the providers. Live behaviour stays unproven until an approved run.

**Validation:** Work is reported with the parent file's statuses: MOCK-VERIFIED after mock tests, VERIFIED only after an approved real run.

---

## D-022 — Parallel work by lanes with single file ownership

**Status:** Confirmed · 2026-11-17 · Area: both

**Choice:** Split the codebase into lanes, each a set of files with one worker at a time. Tasks in different lanes run in parallel once the tasks they depend on are done. Shared files (route registration, migrations, dependencies, the frontend route table and API client) belong to one integrator lane on each side. Each parallel task works in its own git worktree; Fable merges one branch at a time and runs the mock tests after each merge. The lanes and each task's dependencies are listed in MILESTONES.md.

**Alternatives:** Strictly one task at a time (no conflicts, slowest). Free parallel work with conflicts resolved at merge (fast to start, but the job lifecycle and the migration chain would collide repeatedly, and a bad merge in money code is costly).

**Why:** The parent CLAUDE.md allows parallel implementation only for genuinely independent tasks and forbids simultaneous changes to shared files. Lanes make independence checkable: two tasks either share a lane or they do not.

**Trade-off:** The job-lifecycle lane stays serial and sets the shortest possible schedule. The integrator lanes are a bottleneck for small shared changes. More parallel agents also means more tokens spent at once.

**Validation:** A cross-check that no task depends on a missing task, that dependencies have no cycles, and that tasks able to start together are in different lanes. In practice: mock tests pass after every merge.

---

## D-023 — Synchronous database access; the job store keeps its five methods

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** SQLAlchemy in synchronous mode with the psycopg driver. `JobStore` keeps `create`, `get`, `list_by_status`, `transition` and `close`, so the job service and its tests do not change.

**Alternatives:** Asynchronous SQLAlchemy throughout (every store call and every caller would change in the same step as the database move). A full ORM session per request (more structure than one table needs today).

**Why:** The POC already calls a blocking SQLite store from asynchronous code. Keeping that shape makes the move to PostgreSQL a like-for-like swap that the existing tests can judge.

**Trade-off:** A database call blocks the server's event loop for its duration, as it does today. Acceptable for one process and short queries.

**Validation:** The existing tests pass unchanged in behaviour. Revisit if request latency under load is measured as a problem.

---

## D-024 — PostgreSQL runs in Docker for development and tests; one schema per test

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** A `docker-compose.yml` starts PostgreSQL for development. Tests use the same server; each test creates its own empty schema and drops it afterwards.

**Alternatives:** PostgreSQL installed with Homebrew (set up by hand on each machine). A hosted database (an account and possible cost). Keeping SQLite for tests (tests would no longer exercise the real database's locking).

**Why:** Docker 29.8.2 with Compose is already installed on the development machine (checked 2026-11-17). One schema per test keeps tests independent without restarting the server.

**Trade-off:** Docker must be running to run the tests. Creating a schema per test adds time to each test.

**Validation:** The test run's duration is recorded before and after the move (T-103).

---

## D-025 — Backend tooling: Ruff, plus a type checker confirmed at install

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** Ruff for linting and formatting, and mypy for type checking. Both mypy and pyright were tried in T-105 and reported the same findings on this code; mypy was chosen because it is pure Python, while the pyright package downloads a Node runtime on first use. `backend/check.sh` runs lint, format check, type check and tests. Tests are not type-checked.

**Alternatives:** Flake8 + Black + isort (three tools for what one does). No tooling (the POC's state today).

**Why:** M1 must end with one command that checks the backend. The existing code already carries formatter hints (`# fmt: skip`), so a formatter is expected.

**Trade-off:** A first formatting pass may touch many lines; it is done in its own commit so it does not hide logic changes.

**Validation:** The check command passes on a clean checkout (T-105).

---

## D-026 — Frontend tests: Vitest, React Testing Library and jsdom; the API module is mocked directly

**Status:** Proposed · 2026-11-17 · Area: frontend

**Choice:** Vitest as the runner, React Testing Library with jsdom for components. Tests replace the one API client module with a mock.

**Alternatives:** Jest (needs separate configuration from Vite). A mock HTTP server such as MSW (another dependency for a single client module).

**Why:** Vitest 5.1.0 declares support for the project's Vite 8 (checked 2026-11-17) and shares its configuration.

**Trade-off:** Mocking the client module does not exercise the real fetch code; that is covered by the Phase 6 browser run.

**Validation:** One command runs lint, type check and tests (T-112).

---

## D-027 — Design direction: creative-tool patterns with our own identity, desktop first

**Status:** Confirmed · 2026-11-17 · Area: frontend

**Choice:** The app follows the layout patterns common to Canva and to AI video tools: a left sidebar, one prominent Create action, card galleries, a step-by-step create flow, voice preview and price before any spend. The visual identity is our own. Screens are designed for desktop first and must also work on a phone. All planned customer screens are designed and approved before they are built.

**Alternatives:** Keep the POC's single plain form and restyle screens as they are built. Mirror one product's look closely. Design for phones first.

**Why:** Owner requirement after reviewing M1 (R-75 to R-78). Familiar patterns mean customers need no instructions; designing everything first means login, wallet and payments are built once, to one standard.

**Trade-off:** A design milestone (M1.5) now sits before login, and the create flow built in M1 is rebuilt.

**Validation:** The owner approves the designs on the canvas (T-152); rebuilt screens are compared with them in a browser at 1440 px and 390 px (T-156).

---

## D-028 — Proposed brand and design tokens

**Status:** Confirmed (owner approved the designs, 2026-11-17) · 2026-11-17 · Area: frontend

**Choice:** The name is settled separately (D-031: Frameforge). A vivid blue-violet primary (`#4A3AFF`), a marigold used only for credits (`#FFB020`), a cool neutral page, Plus Jakarta Sans for headings and Inter for text, a 4 px spacing scale, 8 to 16 px corners. All values live in one tokens file. Light theme only at launch. The full table is in UX.md section 4.

**Alternatives:** The owner supplies a brand. A dark theme at launch. A warmer or more muted palette.

**Why:** No brand exists and the owner asked for a proposal. One accent for actions and a separate colour for money keeps "what can I press" and "what does it cost" visually distinct. Both typefaces are free and widely available.

**Trade-off:** The palette is engineering's taste until the owner confirms them; a later rebrand means changing the tokens file and re-checking contrast.

**Validation:** Text and control contrast meet 4.5:1 and 3:1 as stated in UX.md. Final sign-off is the owner's (T-152).

---

## D-029 — UX standards are acceptance criteria; one shared component library; field errors from the server

**Status:** Proposed · 2026-11-17 · Area: both

**Choice:** UX.md section 7 (validation, loading, feedback, live state, money, accessibility, responsive) and section 8 (definition of done) are acceptance criteria for every frontend task. Screens are built only from a shared component library on the design tokens, using native HTML controls (`button`, `input`, `select`, `dialog`) rather than a third-party kit. The API's error body gains an optional `fields` object, `{"detail", "code", "fields": {"<field>": "<message>"}}`, so a server-side validation error can be shown under the field it belongs to.

**Alternatives:** Leave quality to each task's judgement. Adopt a component kit (MUI, Chakra). Show all server errors in one banner.

**Why:** Written criteria are the only way "good UX" survives many tasks and several agents. Native controls bring keyboard and screen-reader behaviour without a dependency (this keeps D-011). Inline server errors follow the principle that a message appears next to what needs fixing.

**Trade-off:** Each frontend task carries more acceptance work. Building our own components costs time once. `fields` is a small addition to the D-012 error shape that the backend must fill in for input errors.

**Validation:** Component tests for every state; a contract test that input errors name their field; the browser review in each milestone's Gate D.

---

## D-030 — "Real time" means the screen updates itself by refetching; no push channel yet

**Status:** Proposed · 2026-11-17 · Area: both

**Choice:** Screens stay current without a manual refresh by refetching: a job every 3 seconds while in progress, a pending payment every 2 seconds for up to a minute, the balance after any action that can change it and when the window regains focus. A change the customer makes appears at once and is confirmed by the server's answer, except money, which only ever shows the server's number. No WebSocket or server-sent events are added.

**Alternatives:** WebSockets or server-sent events pushing every change.

**Why:** The owner asked for state that updates in real time (R-81). The slowest thing we track takes minutes, so a few seconds of delay is invisible, and refetching needs no new server machinery and works behind any proxy. It is already how the job screen works.

**Trade-off:** Each open job screen makes a request every 3 seconds. Updates are up to 3 seconds late.

**Validation:** Tests with fake timers for each refetch rule; the browser run confirms progress advances with no reload. Revisit if request volume becomes a measured cost.

---

## D-031 — The product is Frameforge; the backend is Frameforge API, the frontend Frameforge Web

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** The product name customers see is "Frameforge". The backend is called "Frameforge API" (its OpenAPI title) and the frontend "Frameforge Web". Documents, designs, the browser tab and the app header use these names. Internal identifiers that customers never see keep their current values for now: the folder names `backend/` and `frontend/`, the package names, the Docker project and database name `avatar`, and the `AVATAR_` environment variables.

**Alternatives:** The working name "Talking Avatar". Other candidates offered to the owner (Bolo, Vvdo, Chehra, Awaaz, Bolkar, FaceReel, Sutradhar). Renaming every internal identifier now.

**Why:** The owner chose the names (answers Q-21). Internal identifiers are left alone because renaming the database, environment variables and packages touches every developer set-up and the lock files for no customer-visible gain.

**Trade-off:** "avatar" lives on in internal names, which can confuse a newcomer. The parent `CLAUDE.md` still says "Talking Avatar POC"; it is never edited, and it refers to this same product. Trademark, domain and app-store availability of "Frameforge" have not been checked.

**Validation:** A search of the repository finds "Talking Avatar" only in the parent `CLAUDE.md` and in history. Not verified — the name's legal availability requires a trademark and domain search before launch.

---

## D-032 — The typefaces ship with the app instead of loading from Google

**Status:** Proposed · 2026-11-17 · Area: frontend

**Choice:** Plus Jakarta Sans and Inter are bundled with Frameforge Web as font files served from our own address. The design files on the canvas keep their Google Fonts link; that is a drawing tool, not the product.

**Alternatives:** Load both from Google Fonts at view time, as the designs do. Use the device's system fonts only.

**Why:** Loading from Google sends every customer's network address to a third party on each visit and makes the look depend on an outside service. Bundling avoids both and works offline. System fonts would drop the approved look.

**Trade-off:** Two small development dependencies (or checked-in font files) and a slightly larger first download.

**Validation:** Installed and bundled (`@fontsource-variable/*` 5.3.0, merged with T-153a); the production build contains no Google Fonts reference. Browser review (T-156, 2026-11-17): fonts render, and no request leaves the machine at any width.

---

## D-033 — New screens are built for desktop width only

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: frontend

**Choice:** From M2 on, every new screen is designed, built and checked at desktop width (1440 px) only. No phone layout is drawn or built for new screens. What M1.5 already built for phones (the bottom navigation bar, the phone layouts of the app frame, the create flow and the not-found page) stays as it is and is not removed.

**Alternatives:** Keep designing and building every screen at both 1440 px and 390 px (the previous rule, UX.md section 8). Remove the phone support already built.

**Why:** The owner asked for it: "the screens you have developed so far for the app is okay, but moving forward, do not develop screens for the app. Develop only for dashboard", clarified as "only for desktop width". It also halves design and review work per screen.

**Trade-off:** Customers on phones get a working create flow but a desktop-only layout for every later screen (log in, wallet, videos, scripts, account), which may need sideways scrolling or look cramped. Assumed: new screens stay usable down to 1024 px wide, where the full sidebar starts; narrower widths are not checked. The M5 exit evidence no longer includes a phone-width run.

**Validation:** Each new screen's browser check runs at 1440 px (and 1024 px for the narrowest supported desktop). Revisit if the owner wants phone customers again.

---

## D-034 — Passwords are hashed with argon2-cffi (Argon2id)

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** `argon2-cffi` 25.1.0 with its default Argon2id parameters. Hashes are re-made at the next login if the library's defaults change. When a login names an email that has no account, a fixed dummy hash is still checked, so the answer takes about as long as a wrong password and does not reveal which emails have accounts. Passwords are 10 to 128 characters (the approved designs say "at least 10"), with no rules about symbols or capitals.

**Alternatives:** `passlib` (unmaintained since 2020), `pwdlib` (a thin wrapper over the same library), bcrypt (72-byte password limit), a hosted identity service (rejected in D-003).

**Why:** Argon2id is the hash D-003 chose. `argon2-cffi` is the reference Python binding, MIT-licensed, maintained, and has no other dependencies beyond its own C binding.

**Trade-off:** Hashing costs tens of milliseconds of server time on every login and sign-up, by design; rate limits (D-035) keep that from being abused.

**Validation:** PyPI checked 2026-11-17: version 25.1.0, MIT, Python 3.8 or newer. Tests check the stored value starts with `$argon2id$`, never equals the password, and that login with an unknown email still calls the verifier.

---

## D-035 — Rate limits and the origin check run inside the one backend process

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** Counters in memory, keyed by email and by network address. Log in: 5 failures per email and address in 15 minutes. Sign up: 5 per address per hour. Forgot password and resend confirmation: 3 per email and 10 per address per hour. Over the limit: HTTP 429, code `rate_limited`, with a `Retry-After` header. Every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) whose `Origin` header is not on the allowed list, or which says `Sec-Fetch-Site: cross-site`, gets 403 `origin_refused`. The allowed list is a setting; it defaults to the development addresses.

**Alternatives:** A rate-limit table in PostgreSQL. Redis. A rate-limiting library. CSRF tokens in every form.

**Why:** There is one backend process until launch (D-009), so memory is shared by every request. `SameSite=Lax` cookies plus an origin check stop cross-site form posts without tokens in every form.

**Trade-off:** Counters reset when the server restarts, and stop working correctly if a second process is ever added. Revisit together with D-009.

**Validation:** Tests drive each limit past its threshold and check 429; a request with a foreign `Origin` gets 403; a request from the allowed origin passes.

---

## D-036 — Unconfirmed accounts can log in but cannot make videos

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** After sign-up the customer is logged in straight away and sent a confirmation link. Until they confirm, `POST /jobs` and approving a voice return 403 `email_not_verified`, and the app shows a notice with a "send the link again" action. Confirming needs no login: the link works on any device.

**Alternatives:** No access until confirmed. Confirmation optional.

**Why:** The owner chose it. Generating a voice costs the company money (Q-08), so throwaway accounts should not reach it, while a customer who has not opened the email yet can still look around.

**Trade-off:** Until an email provider is chosen (Q-04), confirmation links exist only in the server log, so only someone with server access can confirm an account.

**Validation:** Tests: an unconfirmed account gets 403 on create and approve; after confirming, the same requests succeed.

---

## D-037 — Emails go through one small sender; development writes them to the server log

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** One `EmailSender` interface with a single method to send a plain-text message. The development sender writes the message, including the link, to the server log. A real provider is added when Q-04 is answered; until then, a server started with a production setting refuses to start rather than silently dropping emails.

**Alternatives:** Choose a provider now. Print to standard output without an interface.

**Why:** Building does not need a provider (Q-04 default), and one interface keeps the later switch to a single file.

**Trade-off:** Confirmation and reset links appear in development logs. Those logs must never be shared outside the team.

**Validation:** Tests capture the sent messages through a test sender and read the link from them.

---

## D-038 — Each voice generation costs 10 credits

**Status:** Confirmed (owner, 2026-11-17, answering Q-08) · 2026-11-17 · Area: both

**Choice:** Generating a voice costs 10 credits (a setting), taken when the customer submits the photo and script, in the same transaction that creates the job. It is kept even if the customer never makes the video. If the voice itself fails to generate (a clear failure, no voice delivered), the 10 credits are returned, following the owner's rule that clear failures cost the customer nothing. A customer with fewer than 10 available credits cannot start a job (HTTP 402 `insufficient_credits`). The video price (D-006) is separate and is held at approval. The daily cap on free voices that D-015 needed is dropped: charging replaces it.

**Alternatives:** Free voices with a cap (D-015). Free voices without a limit.

**Why:** The owner chose it. Every voice costs the company money even when no video follows.

**Trade-off:** Customers pay for every retry of a script. Two new ledger kinds are needed: `voice_charge` and `voice_return`.

**Validation:** Tests: submit takes 10 credits with the job in one transaction; a failed voice returns them once; fewer than 10 credits gives 402 and creates no job.

---

## D-039 — Each approval attempt of a job has its own hold reference

**Status:** Confirmed (owner, 2026-11-17; built and tested in T-304) · 2026-11-17 · Area: backend

**Choice:** A job carries an approval attempt number, starting at 1 and increased each time the customer approves. The video hold, capture and release use the reference `('job', '<job_id>#<attempt>')` instead of `('job', '<job_id>')`. The voice charge and voice return keep `('job', '<job_id>')`, because a job has one voice. When submission to fal.ai fails cleanly (upload fails or fal.ai refuses), the job returns to `audio_ready` with the hold released, as HLD §5.2 says, and approving again writes a new hold under the next attempt.

**Alternatives:** End the job on a clean submission failure (failed and released), so the customer must start again and pay for a new voice. One hold per job ever, so a second approval is impossible.

**Why:** Found in T-302: `UNIQUE (kind, ref_type, ref_id)` allows one hold per reference, which made the retry in HLD §5.2 impossible. A reference per attempt keeps the retry, keeps the voice the customer already paid for, and keeps the uniqueness guard within each attempt.

**Trade-off:** One more job column, and the ledger reads the job id from the reference by cutting at `#`.

**Validation:** Tests: approve, clean failure, release, approve again, capture; each attempt has exactly one hold and one capture or release; repeating an attempt's operation is a no-op.

---

## D-040 — A voice longer than the limit keeps its charge; the audio is kept for reuse

**Status:** Confirmed · 2026-11-17 · Area: backend

**Choice:** When the generated voice is longer than the allowed length, the job ends `failed` and the 10-credit voice charge is kept (no `voice_return`). The generated audio file stays on the job and is never deleted, so it can be used again. Amends D-038, which returned the charge only when no voice was delivered.

**Alternatives:** Return the 10 credits (the customer got nothing usable; the company absorbs fal.ai's voice cost).

**Why:** Owner's decision, 2026-11-17: fal.ai has already charged the company for a voice that was delivered; the customer's script was too long. Keeping the audio means the work is not wasted.

**Trade-off:** A customer pays 10 credits for a voice that cannot become a video today. How a saved voice is reused has no design yet; it is a requirement for M5 (history).

**Validation:** A test in tests/test_charging.py: status failed, voice_charge kept, no voice_return, audio file still present, ledger invariant holds.

---

## D-041 — Razorpay is called with the existing httpx client, not the razorpay SDK

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** The payments gateway makes its few REST calls (create order, fetch order, fetch payment, list an order's payments) with `httpx` and HTTP basic auth (key id, key secret). Signatures are checked with Python's `hmac` and `hashlib`, compared with `hmac.compare_digest`. One module, `app/payments/gateway.py`, is the only code that talks to Razorpay.

**Alternatives:** The official `razorpay` Python SDK (adds `requests` and its own dependencies; synchronous; wraps the same REST calls).

**Why:** No new dependency (backend rule); httpx is already used and tested; the endpoints and fields are few and are recorded with dated sources in docs/RAZORPAY-FACTS.md (T-401).

**Trade-off:** We maintain four small calls ourselves and must follow API changes from the docs, not from an SDK release.

**Validation:** Signed-fixture tests with a fake transport (no network); the owner-approved test-mode run T-407 confirms the real calls.

---

## D-042 — Payments run in mock mode unless switched; outside production only test keys are accepted

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** Setting `AVATAR_PAYMENTS` is `mock` (default) or `razorpay`. Mock mode makes no network call; a development-only route signs a fake payment with a fixed mock secret so the real verify and crediting code runs. In `razorpay` mode the backend refuses to start if any key or secret is missing, or if `AVATAR_ENV` is not `production` and the key id does not start with `rzp_test_`. Production refuses to start in mock mode (added at the M4 review, 2026-11-17: the mock secret is public). The key id is the only Razorpay value sent to the browser.

**Alternatives:** One switch for test and live (a pasted live key could move real money during development). Trusting the owner to paste only test keys.

**Why:** The owner has real Razorpay keys. A start-up refusal makes it impossible to move real money before launch (M7) by mistake. The `rzp_test_` prefix is not stated in the official docs read on 2026-11-17 (T-401), so the check fails closed: if the prefix were wrong, the app refuses to start rather than run.

**Trade-off:** If Razorpay's test key ids do not start with `rzp_test_`, the owner must report it and the check is corrected before T-407.

**Validation:** Config tests: missing values, a non-test key in development, and a test key in development; the T-407 run confirms the prefix.

---

## D-043 — Saved voices: a failed job's voice can be reused for a new video

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** A voice is kept on its job when the job fails after the voice was made: the voice was longer than the limit, the video was refused, failed, timed out, or its outcome is unknown. When the customer starts a NEW job, Create offers a voice choice: "Make a new voice" (10 credits, D-038) or one of their saved voices from failed jobs. A saved voice skips voice generation and its charge; the new job goes straight to listen-and-approve, priced from that voice's length (D-006). A setting `save_all_voices` (default off) would keep every voice; with it off, only failed jobs' voices are offered. No video is ever made without a voice.

**Alternatives:** Retry inside the failed job (one history entry, but a failed job would no longer be final). Never reuse voices (the customer pays again for a voice already made).

**Why:** Owner's decision, 2026-11-17: a paid voice should not be wasted when the video fails, and a new job keeps history and money simple (each job has its own charges).

**Trade-off:** Saved voice files are kept longer (retention, Q-09, applies). A reused voice is copied to the new job so deleting or failing one job never affects another.

**Validation:** Tests: a failed job's voice appears in the choice; a new job with it has no voice_charge, status audio_ready and the right price; a too-long voice is offered only when D-044 allows its length; another user's voice is never offered (404). Built in M5.

---

## D-044 — The video length limit follows the video model's documented maximum

**Status:** Superseded by D-056 (owner chose 60 seconds for now, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** Raise `max_audio_seconds` (today 30) to the longest audio the video model accepts, as stated in fal.ai's documentation, so a long voice can become a video. The price stays 20 credits per second (D-006); the script limit (400 characters) rises in proportion. Until the documentation is checked and the value recorded with its source and date, the limit stays 30 seconds.

**Alternatives:** Keep 30 seconds and never offer too-long voices. Pick a number without checking (could send fal.ai inputs it refuses, or charge for videos it cannot make).

**Why:** Owner's decision that too-long voices should be usable (2026-11-17); parent CLAUDE.md §4 forbids writing a provider limit from memory.

**Trade-off:** Longer videos cost the company more at fal.ai per video; the per-second credit price covers it. A live check of the new limit needs the owner's approval (Gate C).

**Validation:** Documentation check with a dated source; a config test for the new limit; the owner-approved live run before launch (Q-13).

---

## D-045 — Consent is given on Create, before the voice is made

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** The consent checkbox ("I have permission to use this person's photo", wording per Q-11) sits on Create before "Make my voice" and is never pre-ticked. The job and its 10-credit voice charge cannot start without it; the server refuses a job without recorded consent (T-502). The approve step only shows that consent was given.

**Alternatives:** Consent at approval, next to the price (the job and a paid voice would already exist without consent). Asking twice.

**Why:** Owner's decision: the job is created, and the photo used, when the voice is made, so consent must come first.

**Trade-off:** One more required control on Create.

**Validation:** Backend test: POST /jobs without consent is refused and nothing is charged. Frontend test: the button stays disabled until the box is ticked.

---

## D-046 — A daily limit on videos outside production only; no limit on voices

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** A setting `daily_video_limit` allows 50 video approvals per customer per day when `AVATAR_ENV` is not `production`; in production there is no limit. It is checked at approval: over the limit the answer is 429 `daily_limit_reached` ("You've reached today's limit of 50 videos.") and nothing is held. Voices are never limited: every voice is paid for with credits (D-038).

**Alternatives:** A daily cap on voices (the old D-015 idea). One limit everywhere including production.

**Why:** Owner's decision, 2026-11-17: development and testing need a guard on paid video calls; paying customers should not be blocked.

**Trade-off:** A development run can be stopped by the limit; raise the setting if needed.

**Validation:** Tests: the 51st approval in a day in development gets 429 with no hold; production with the same count passes; voices are never refused for count. T-503.

---

## D-047 — Purchases are expressed in credits

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** The buying contract uses credits everywhere: `POST /payments/orders {credits}`, order status `credits`, settings and config `min_purchase_credits` (500) and `max_purchase_credits` (10,000). Since ₹1 = 1 credit (D-007) the number is the same as the rupees paid. Only `amount_paise`, sent to Razorpay, is in money.

**Alternatives:** Rupees in the contract (what T-400 first wrote).

**Why:** Owner's decision: credits are the unit customers see everywhere in the product.

**Trade-off:** If ₹1 = 1 credit ever changes, the order route must convert explicitly; amount_paise stays the only money field.

**Validation:** Contract test asserts `credits` on create-order and no `rupees` field; limits test 499/500/10,000/10,001 (T-402).

---

## D-048 — A voice whose outcome is unknown returns the voice charge

**Status:** Confirmed (owner approved the plan, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** The owner's rule for voices: the 10 credits are taken when a voice is made and returned if it is not. A voice call that ends with an unknown outcome (an unexpected error, or a server restart while the voice was being made) delivers no voice to the customer, so the job fails and the 10 credits are returned (`voice_return`). The job is still flagged for review, because the company may have paid fal.ai.

**Alternatives:** Keep the charge on an unknown voice outcome (applying the video rule of Q-19, as first built in T-304).

**Why:** Owner, 2026-11-17: "10 credits are taken if the voice is made; if not, they are returned." The Q-19 capture rule stays for the video, where a paid video may exist.

**Trade-off:** The company absorbs fal.ai's cost of a voice that may have been made but never reached the customer.

**Validation:** Tests: an unexpected voice error and a restart in audio_generating each end failed, needs_review, with voice_charge and voice_return.

---

## D-049 — Buying credits needs a confirmed email

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** Creating a payment order answers 403 `email_not_verified` until the customer has confirmed their email, as making a voice or video does (D-036).

**Alternatives:** Let unconfirmed accounts buy credits (they could pay but not use them until confirming).

**Why:** A customer who cannot use credits should not be asked to pay; a confirmed email also gives a working contact for payment problems.

**Trade-off:** One more step before a first purchase.

**Validation:** Access-matrix row: unconfirmed user → 403 on POST /payments/orders (T-402).

---

## D-050 — A saved voice keeps its script and language

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** When a new job uses a saved voice (D-043), its script and language are shown but locked: they are the words the voice already says. To change the words, the customer makes a new voice (10 credits).

**Alternatives:** Let the customer edit the text while keeping the old voice (the words shown would not match what is spoken).

**Why:** Owner's decision: the script on a job must always match its voice.

**Trade-off:** A customer who wants a small text change pays for a new voice.

**Validation:** Frontend test: with a saved voice chosen, the script and language fields are read-only. Backend test: a job created from a saved voice copies that job's script and language and ignores any sent text (T-516, T-517).

---

## D-051 — A job flagged for review tells the customer what happens next

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** When a job ends with an unknown video outcome (charged and flagged, Q-19), the customer sees: our team will check it within 2 working days; if no video was made, the credits are returned; and how to contact support. Returns are made by an admin as an audited adjustment (M6, T-602).

**Alternatives:** Automatic refund after checking (more work). No refund promise.

**Why:** Owner's decision: keep the Q-19 rule (charge on an unknown outcome) but promise a check and a refund when no video was made.

**Trade-off:** Staff must check flagged jobs within 2 working days. The support address is not decided yet (PLACEHOLDER on the boards); it must be set before launch (M7).

**Validation:** The failure board shows the message; the M6 reconciliation report lists flagged jobs (T-604); an adjustment returns the credits (T-602).

---

## D-052 — Credits never expire

**Status:** Confirmed (owner answered Q-05 in part, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** Purchased and granted credits have no expiry date. The Buy-credits screen says "Credits do not expire."

**Alternatives:** Expire after 12 months (needs notices and an expiry job).

**Why:** Owner's decision: simplest and friendliest to customers.

**Trade-off:** Unused credits stay on the books indefinitely; a later change would need notice to customers.

**Validation:** No expiry code exists; the Buy-credits board states it. The refund policy (rest of Q-05) is still open.

---

## D-053 — Bought credits are not refundable

**Status:** Confirmed (owner answered Q-05, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** Credits a customer bought are not refunded as money. Credits go back to the wallet only when the platform did not deliver: a voice that failed or never arrived (D-038, D-048), a video that failed or was refused (hold released), or a flagged video found not to have been made (D-051). A refund issued in Razorpay's dashboard for an exceptional case (for example a disputed payment) still removes the credits once (T-603).

**Alternatives:** Refund unused credits on request. Refund within a time window.

**Why:** Owner's decision: credits are prepaid platform value; failures are already made good in credits.

**Trade-off:** Must be stated in the terms before launch (T-707); customers may ask anyway.

**Validation:** Terms text; T-603 test that a Razorpay refund removes the credits exactly once.

---

## D-054 — Customer media is kept for 30 days

**Status:** Confirmed (owner answered Q-09, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** Photos, voices (including saved voices from failed jobs, D-043) and videos are deleted automatically 30 days after the job was created. The job row, its script copy and its ledger entries stay. The customer is told to download within 30 days; a saved voice older than 30 days is no longer offered.

**Alternatives:** Keep until the customer deletes them. 90 days.

**Why:** Owner's decision: low storage cost and low privacy risk.

**Trade-off:** Customers must download within 30 days; history shows expired media as no longer available.

**Validation:** T-606: a cleanup task deletes media older than 30 days and is tested with an injected clock; the video page shows 'no longer available' after that.

---

## D-055 — The support email address is a setting

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** Setting `AVATAR_SUPPORT_EMAIL` (empty by default). `GET /config` returns it as `support_email` (null when empty); the failure screens show it when set. The owner adds the real address to `backend/.env` before launch.

**Alternatives:** Hard-code an address in the frontend.

**Why:** Owner asked for it to be configurable in .env.

**Trade-off:** Screens must read sensibly when it is empty.

**Validation:** Config test: empty → null, set → returned; frontend shows the address only when present.

---

## D-056 — The video length limit is 60 seconds for now

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** `max_audio_seconds` is 60 and the script limit 800 characters (about 14 characters a second, measured live). fal.ai's pages state no limit for this model; Kling's own API documentation says 2 to 300 seconds ([FAL-VIDEO-FACTS.md](FAL-VIDEO-FACTS.md), T-518). The limit is raised further only after an owner-approved live run at the new length.

**Alternatives:** 300 seconds now (Kling's figure; not stated by fal.ai, so a refusal or a different bill would only show on a live run). Keep 30 seconds.

**Why:** Owner's choice: double the length with low risk, without a paid test.

**Trade-off:** fal.ai cost per video doubles at the longest length (about $3.37 for 60 s at $0.0562/s); the per-second credit price scales with it. A voice longer than 60 s keeps its charge (D-040).

**Validation:** Config and tests: 800-character scripts accepted, 801 refused; a 67-second mock voice is refused as too long.

---

## D-057 — Photos follow the video model's documented rules before any charge

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** At upload the photo must be at least 300 pixels on its short side and no more than 2.5 times longer on one side than the other (Kling's documented limits, [FAL-VIDEO-FACTS.md](FAL-VIDEO-FACTS.md)), on top of the existing format and 10 MB checks. A photo that fails is refused with a message under the photo field, before the voice is made, so nothing is charged.

**Alternatives:** Keep 256 px and any shape (the model could refuse the photo after the voice was paid).

**Why:** Owner's choice; these limits come from Kling's documentation because fal.ai's pages state none.

**Trade-off:** Some unusual photos (very tall or very small) are refused that the model might have accepted.

**Validation:** Tests: 299 px and 2.51:1 refused, 300 px and 2.5:1 accepted, each as a 422 on the image field.

---

## D-058 — Banners are added only when the customer switches them on

**Status:** Confirmed (owner change request, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** The banners step shows one "Add banners" switch, off by default. Off: no banner lists are shown and the video has no banners. On: the start and end banner lists appear (each with "None"), as in D-018 and Q-15. The review step shows the banner choice only when banners were added. The progress screen shows the "Adding your banners" step (`video_assembling`) only for a job with at least one banner; a job without banners goes from the AI video straight to the result.

**Alternatives:** Always show both banner lists with "None" preselected (the earlier design).

**Why:** Owner's change request: banners should be a deliberate choice, and customers who do not want them should not see the extra step.

**Trade-off:** One more control on the banners step.

**Validation:** Frontend tests: lists hidden until the switch is on; switching off clears the choice; progress has three steps without banners and four with. Backend: a job without template ids never enters `video_assembling` (T-509).

---

## D-059 — The minimum purchase is 1,000 credits

**Status:** Confirmed (owner change request, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** A purchase is 1,000 to 10,000 whole credits (₹1,000 to ₹10,000 before the payment fee, D-060). Quick picks 1,000 / 2,500 / 5,000 / 10,000. `min_purchase_credits` and `max_purchase_credits` are settings. Replaces the 500 minimum of Q-06 and D-047.

**Alternatives:** Keep 500.

**Why:** Owner's decision.

**Trade-off:** A customer who needs fewer credits still buys 1,000.

**Validation:** Limits test: 999 refused, 1,000 and 10,000 accepted, 10,001 refused (422 `fields.credits`).

---

## D-060 — The customer pays the payment fee

**Status:** Confirmed; formula amended by D-062 (owner change request, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** On top of the credits' price (₹1 = 1 credit), the customer pays a payment fee of `payment_fee_bps` (default 200 = 2%) and, if the owner turns it on, GST on that fee (`payment_fee_gst_bps`, default 0). The server computes everything in paise: price = credits × 100; fee = ceil(price × fee_bps / 10,000); fee GST = ceil(fee × gst_bps / 10,000); the Razorpay order and the captured amount must equal price + fee + fee GST. The credits granted equal the credits bought; the fee never becomes credits. `GET /api/v1/payments/quote?credits=N` returns the breakdown so the browser shows it without computing money; the Buy-credits dialog shows "Payment fee (2%)" and "You pay" before paying.

**Alternatives:** The company absorbs the fee. Razorpay's own 'customer fee bearer' feature (varies by method; must be enabled on the account and checked in the docs first).

**Why:** Owner's decision: Razorpay deducts its fee from each payment, so the customer pays it. A fixed percentage we add is the same for every method and is known before paying.

**Trade-off:** Razorpay's real fee is not verified (its pricing page gave conflicting UPI figures, 2026-11-17); the rate is a setting the owner can change. The fee is shown on every purchase.

**Validation:** Tests: quote equals the order; rounding with a non-whole-paise fee; a captured amount without the fee is refused; credits granted equal credits bought.

---

## D-061 — Short of credits for a video: top up and come straight back

**Status:** Confirmed (owner change request, 2026-11-17) · 2026-11-17 · Area: frontend

**Choice:** When the voice is ready but the video costs more than the credits available, the review screen shows a banner ("Not enough credits. This video costs 600 credits. You have 290.", amounts from the server) with an "Add credits" button; Approve stays disabled. The button opens Buy credits with the minimum amount (1,000) and a return address to this job (`/wallet?buy=1&return=/create/<job id>`; only internal addresses are accepted). After the server confirms the payment, the success state offers "Back to your video" and returns there; the wallet is refetched, so Approve becomes enabled when the credits now cover the price. Nothing about the job changes while the customer is away; the voice charge already paid stays.

**Alternatives:** Send the customer to the wallet page and let them find their way back. Prefill the exact shortfall (owner chose the minimum).

**Why:** Owner's change request: a customer short of credits should finish the video without losing their place.

**Trade-off:** If the top-up is still not enough, the banner shows the new shortfall.

**Validation:** Frontend tests: the banner and button appear only when short; the return address is kept and validated; success returns to the job and Approve is enabled; the browser check in M4 covers the full loop in mock mode (T-412).

---

## D-062 — The payment fee is grossed up so the owner receives exactly the credits' price

**Status:** Confirmed (owner, 2026-11-17; amends D-060) · 2026-11-17 · Area: both

**Choice:** Razorpay's Standard plan takes 2% of the whole amount charged plus 18% GST on that fee (2.36% in total; cards, UPI, netbanking and wallets alike; Razorpay pricing page read 2026-11-17). So that 1,000 credits bring the owner exactly ₹1,000, the server charges total = ceil(price ÷ (1 − rate × (1 + GST))): ₹1,024.18 for 1,000 credits. `payment_fee_bps` is Razorpay's rate (default 200) and `payment_fee_gst_bps` the GST on it (default 1800). The quote shows the extra as "Payment fee" (₹20.50) and "GST on the fee" (₹3.68, its GST share rounded down); the credits granted equal the credits bought.

**Alternatives:** Charge 2% of the price only (₹1,020; the owner receives about ₹995.93). Razorpay's "customer fee bearer" convenience-fee feature (needs Razorpay to enable it; changes the checkout).

**Why:** Owner's decision: "I want 1000 to be added", so Razorpay's whole charge, GST included, is passed to the customer.

**Trade-off:** International cards (up to 3%) still leave the owner slightly short; Razorpay's own rounding of its fee may differ by a paisa. A negotiated rate later is one setting. Whether the owner must also charge GST on the sale of credits is a tax question for the review in T-707, not decided here.

**Validation:** Tests: 1,000 credits → 102418 paise (2050 fee + 368 GST); for every amount from 1,000 to 10,000 credits, the total less 2.36% is at least the price; defaults 200 and 1800. The T-407 test-mode run confirms the settled amount.

---

## D-063 — Banner clips are portrait 9:16

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** Videos are mostly short and watched on phones, so banner templates are portrait 9:16. The template command refuses a clip that is not portrait 9:16 (within 2%). The starter clips are remade at 720×1280. The joining step keeps scaling a clip to the AI video's exact size; a small difference in shape is padded, as built in T-507.

**Alternatives:** Accept any shape and add black bars, or centre it over a blurred copy.

**Why:** Owner's answer: "these videos would be short videos mostly on mobile".

**Trade-off:** The company must supply clips in portrait. Whether the AI video itself comes out portrait depends on the photo and the model: Not verified — requires documentation review, execution, or live integration testing.

**Validation:** Tests: the add command refuses a landscape clip and accepts a 720×1280 one; the starter-clip script makes 720×1280 clips.

---

## D-064 — The Razorpay webhook is optional; without it, reconciliation polls every minute

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: backend

**Choice:** `RAZORPAY_WEBHOOK_SECRET` is optional. Without it, the app still starts in razorpay mode, every webhook delivery is refused (400), and payments are confirmed through Razorpay's API only: the browser's verify fetches the payment by id, and reconciliation polls unpaid orders every minute once they are 2 minutes old (instead of every 5 minutes after 30 minutes). With a secret, the webhook works as before and the slower schedule applies.

**Alternatives:** Keep the webhook required (needs a public URL, a tunnel in development).

**Why:** Owner's question: "can we poll using API and transaction ID instead of the webhook?" The webhook was only a faster backup for a closed tab; polling covers it within about 3 minutes.

**Trade-off:** More API calls to Razorpay (one per unpaid order per minute, for up to 3 days); a closed-tab payment appears within about 3 minutes rather than seconds. The webhook signature's encoding stays unverified until a webhook is set up.

**Validation:** Tests: razorpay mode starts without a webhook secret; with none, a paid but unverified order is not touched at 1 minute and is credited at 3 minutes; a webhook is refused with 400.

---

## D-065 — For the POC, videos are not stored: the fal.ai link is kept and played

**Status:** Confirmed (owner, 2026-11-17) · 2026-11-17 · Area: both

**Choice:** No disk or object storage for finished videos. The job stores the fal.ai video URL and its expiry (`video_url`, `video_expires_at`). The video is requested with `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": 2592000}` (30 days, matching D-054). `GET /api/v1/jobs/{id}/video` checks the caller owns the job and redirects (302) to the fal URL; after expiry it answers 410 and the screens say the video has expired. Emails link to our page, never to the raw fal URL. Mock mode keeps a local file. Photos and voices stay on local disk (small; the voice is measured locally).

**Alternatives:** Download the video to our disk (no space on the server), object storage such as S3 (T-703, later), proxying the bytes through our server (bandwidth on our side).

**Why:** Owner's instruction for the POC: "save that link into the DB, and every time render the video from that link". fal docs (read 2026-11-17): generated media is "available for at least 7 days by default", the lifetime is set per request with the header above (null = no expiry; expired files are permanently deleted), URLs are public to anyone holding them, and no download count or bandwidth limit is published; the only published limit is generation concurrency (2 for new accounts).

**Trade-off:** The raw fal URL is unguessable but public; anyone the customer gives it to can watch until expiry. If fal loses or deletes a file, there is no copy. Seeking (range requests) and repeated fetches are not documented: Not verified — requires documentation review, execution, or live integration testing (measured in T-556).

**Validation:** Tests: owner gets 302 to the stored URL, another user 404, expired 410, the fal submit carries the lifecycle header (fake transport), mock path unchanged. Live: T-556 records playback, seeking, content type, a fetch after about 24 h, and the expiry.

