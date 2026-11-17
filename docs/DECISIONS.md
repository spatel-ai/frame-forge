# Decision Log — Frameforge

Every decision records the five parts the parent [CLAUDE.md](../CLAUDE.md) §2 asks for: the
choice, the alternatives considered, the reason, the trade-off, and how it will be validated.

A decision has one of three statuses:

- **Confirmed** — stated or approved by the owner. A proposal becomes Confirmed only when the owner
  approves it; engineering never marks its own proposal Confirmed. D-001, D-002, D-011, D-012 and
  D-022 were confirmed when the owner approved the M1 plan on 2026-11-17.
- **Proposed** — recommended by engineering; becomes Confirmed when the owner approves these docs.
- **Needs owner** — affects cost, privacy, security, consent or core behaviour, so it waits for
  the owner's answer to the linked question in [tracker/questions.json](tracker/questions.json).

When a decision changes, add a new entry that supersedes the old one; do not rewrite history.
Keep the status here and in [tracker/decisions.json](tracker/decisions.json) the same.

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

**Status:** Proposed · 2026-11-17 · Area: both

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

**Status:** Needs owner (Q-17) · 2026-11-17 · Area: backend

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

**Choice:** Tests that use the mock provider and signed fixtures may run during development. Any call to fal.ai, and any call to Razorpay beyond its free test mode, needs the owner's approval for that run. Razorpay test mode still needs the owner to supply the keys.

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

**Status:** Proposed · 2026-11-17 · Area: backend

**Choice:** A job carries an approval attempt number, starting at 1 and increased each time the customer approves. The video hold, capture and release use the reference `('job', '<job_id>#<attempt>')` instead of `('job', '<job_id>')`. The voice charge and voice return keep `('job', '<job_id>')`, because a job has one voice. When submission to fal.ai fails cleanly (upload fails or fal.ai refuses), the job returns to `audio_ready` with the hold released, as HLD §5.2 says, and approving again writes a new hold under the next attempt.

**Alternatives:** End the job on a clean submission failure (failed and released), so the customer must start again and pay for a new voice. One hold per job ever, so a second approval is impossible.

**Why:** Found in T-302: `UNIQUE (kind, ref_type, ref_id)` allows one hold per reference, which made the retry in HLD §5.2 impossible. A reference per attempt keeps the retry, keeps the voice the customer already paid for, and keeps the uniqueness guard within each attempt.

**Trade-off:** One more job column, and the ledger reads the job id from the reference by cutting at `#`.

**Validation:** Tests: approve, clean failure, release, approve again, capture; each attempt has exactly one hold and one capture or release; repeating an attempt's operation is a no-op.
