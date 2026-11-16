# Plan: M2 — Accounts and login

Approved by the owner on 2026-11-17. The governing rules are in the parent [CLAUDE.md](../CLAUDE.md);
the login design is [HLD.md](HLD.md) sections 4, 5.5, 6 and 7; decisions D-003 and D-033 to D-037.

## Context

Frameforge currently has no users: anyone who can reach the server can create jobs and open any
job by its id. M2 adds email-and-password accounts (D-003, confirmed) so that only logged-in
people use the product and each sees only their own work. Wallets (M3) and payments (M4) attach
to these accounts, so this milestone has to be secure before money is involved.

Exit evidence (MILESTONES.md): an access-control test matrix shows every job, media and account
route refuses anonymous users and other users' resources. Reachable status: **MOCK-VERIFIED**.
No fal.ai or Razorpay call is made; emails are printed to the server log (Q-04 default).
All work on `development`. New screens at desktop width only (D-033).

## Owner answers (2026-11-17)

| Topic | Answer |
| --- | --- |
| Email verification | Unverified customers can log in but cannot generate a voice or video until they confirm |
| Terms checkbox on sign-up | Left out until real Terms and Privacy text exist (before launch, T-707) |
| Confirm-email screens (no design yet) | Fable draws them on the canvas; owner approves before they are built |
| Jobs created before accounts | Kept, hidden from everyone (no owner = never shown) |

## Proactive discovery

| # | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | Sign-up design has a **Name** field; HLD `users` table has none | Signup.dc.html | Add `users.name` (1–80 chars) |
| 2 | Designs require **at least 10 characters** for passwords | Signup, Reset, Account boards | Password rule: 10–128 characters, no composition rules |
| 3 | Reset page shows **"For asha@example.com"** and shows "link expired" on arrival | Reset-Password, Reset-Link-Expired | New route `POST /auth/password/reset/check` {token} → {email}, or `reset_link_invalid` |
| 4 | Account page needs **change password**, **log out everywhere**, and "logged in on N devices" | Account.dc.html | New routes `POST /auth/password/change`, `POST /auth/logout-all`; `GET /auth/me` returns `active_sessions` |
| 5 | Forgot-sent screen has "Resend link in 0:52" | Forgot-Password-Sent | 60-second client cooldown; server rate limit is the real guard |
| 6 | No design for the email-confirmation screens | `docs/design/` listing | Phase 0 draws them (owner answer) |
| 7 | Job and media routes check nothing but the id | `backend/app/jobs/routes.py` `_load`, `_file` | T-204 filters every load by user; another user's job → 404 |
| 8 | One backend process (D-009) | `app/main.py` | Rate limits can be in-memory counters; they reset on restart (documented) |
| 9 | `argon2-cffi` 25.1.0, MIT, Python ≥3.8 | PyPI, checked today | New dependency, recorded as a decision |
| 10 | `backend/.env` says `AVATAR_PROVIDER=fal` | file | Every run in this milestone starts the server with `AVATAR_PROVIDER=mock` set explicitly and checks `/api/v1/config` first |

### Classified register

| Class | Item |
| --- | --- |
| Confirmed | Email + password, Argon2id, server-side sessions in an HttpOnly SameSite=Lax cookie (D-003); verification required before generating; reset per HLD §5.5; desktop-only screens; old jobs hidden |
| Assumed | Confirmation links work once and expire after 24 hours (reset links: 30 minutes, HLD §5.5). Sessions last 30 days, no sliding renewal. Login with an unknown email and a wrong password give the same message and similar timing. Sign-up with a taken email answers `email_taken` (409), accepting that it reveals the account exists; it is rate-limited. Changing the password logs out other devices, keeps this one. A reset logs out every device. Emails go to the server log only. First admin is made with a command-line step; nobody is admin until the owner names someone (Q-11) |
| Needs Verification | That a `Secure` cookie is kept by the browser on `http://localhost` through the Vite proxy (checked in Phase 0 with Chromium; if not, a development-only setting turns `Secure` off). FastAPI 0.163 cookie and dependency APIs, read from the installed package before use |
| Deferred | Real email provider (Q-04). Terms checkbox (T-707). Admin screens (M6). Sign-in with Google, two-factor, account deletion |
| Out of Scope | Wallet, prices, payments (M3, M4) |

## Decisions to record (Proposed)

| ID | Decision |
| --- | --- |
| D-034 | `argon2-cffi` for Argon2id hashing (library defaults); a dummy hash is checked when the email is unknown so timing does not reveal accounts |
| D-035 | Rate limits and the origin check live in-process. Login: 5 failures per email+address per 15 min. Sign-up: 5 per address per hour. Forgot and resend: 3 per email and 10 per address per hour. State-changing requests whose `Origin` (or `Sec-Fetch-Site: cross-site`) is not on the allowed list get 403 `origin_refused` |
| D-036 | Unverified accounts may log in; `POST /jobs` and approve return 403 `email_not_verified` until confirmed |
| D-037 | Email sending behind one small interface; the development sender writes the link to the server log; production refuses to start without a provider (Q-04) |

## API contract (T-200, written first)

All under `/api/v1`; errors `{detail, code, fields?}`.

| Route | Body → result | Error codes |
| --- | --- | --- |
| `POST /auth/signup` | name, email, password → 201 user + session cookie; sends confirm email | `email_taken` 409, validation 422 with `fields`, `rate_limited` 429 |
| `POST /auth/login` | email, password → user + cookie | `invalid_credentials` 401, `rate_limited` 429 |
| `POST /auth/logout` | → 204, cookie cleared | — |
| `POST /auth/logout-all` | → 204, every session revoked | `not_authenticated` 401 |
| `GET /auth/me` | → id, name, email, email_verified, role, active_sessions | `not_authenticated` 401 |
| `POST /auth/verify-email` | token → 200 | `verify_link_invalid` 400 |
| `POST /auth/verify-email/resend` | → 204 | `not_authenticated`, `rate_limited` |
| `POST /auth/password/forgot` | email → 202 always | `rate_limited` 429 |
| `POST /auth/password/reset/check` | token → {email} | `reset_link_invalid` 400 |
| `POST /auth/password/reset` | token, password → 204; all sessions revoked | `reset_link_invalid` 400, 422 `fields` |
| `POST /auth/password/change` | current_password, new_password → 204; other sessions revoked | 422 `fields.current_password` |
| Existing job and media routes | now require a session; filtered by owner | `not_authenticated` 401, `job_not_found` 404, `email_not_verified` 403 on create/approve |

`GET /config` and `GET /healthz` stay public.

## Phases

| Phase | Tasks (owner) | What happens | Done when |
| --- | --- | --- | --- |
| 0 | Gate A, T-200, T-207 (Fable) | Write this plan; record D-034–D-037; draw the confirm-email boards (confirmed, link expired, "confirm your email" notice) and ask for approval; Secure-cookie check; write the contract as `app/auth/schemas.py` + route stubs and regenerate `openapi.json`/`schema.d.ts` | Contract in OpenAPI; boards approved |
| 1 | T-201 + T-202 (Sonnet, BE-Auth) ∥ T-210 (Sonnet, FE-Auth) | Backend: `users`, `sessions`, `email_tokens` migration; sign-up, log in, log out, log out everywhere, me, change password; `current_user` dependency. Frontend: log in, sign up, forgot, forgot-sent, reset, link-expired, confirm-email screens against the mocked API, reusing the brand panel from the designs | Each lane's checks pass |
| 2 | T-203 (Sonnet, BE-Auth) ∥ T-204 (Sonnet, BE-Jobs) ∥ T-211 (Sonnet, FE-Shell) | Verification and reset per HLD §5.5. Jobs get `user_id` (nullable; no owner = hidden); every job and media route filtered; create/approve need a verified email. Frontend: session bootstrap, guarded routes with return-to, 401 clears cached data and stored job id, Account nav item on, unverified notice | Another user's job → 404 in tests; guarded routes tested |
| 3 | T-205 (Sonnet, BE-Auth) ∥ T-212 (Sonnet, FE-Account) | Rate limits and origin check. Account page from its design: profile, change password, sessions, log out everywhere, log out | Throttling and cross-site refusal tested |
| 4 | T-206 (Haiku) then Gates B and D (Fable) | Access matrix: every route × anonymous / owner / other user / admin. Merge, run both checks, browser review, milestone report, tracker and dashboard | Matrix green; report written |

Parallel work uses git worktrees with single file ownership (D-022); Fable reviews every diff
before merging, one branch at a time. Backend lanes share no files: BE-Auth owns `app/auth/` and
its migration; BE-Jobs owns `app/jobs/` and the jobs migration; `app/main.py` wiring is changed
only by Fable at merge.

## Files

- New backend: `backend/app/auth/` (models, store, service, routes, schemas, deps, email, ratelimit, cli),
  migrations `0002_auth_tables`, `0003_jobs_user_id`, `backend/tests/test_auth*.py`, `test_access_matrix.py`
- Changed backend: `app/main.py` (routers, middleware), `app/jobs/routes.py` + `service.py` + `db.py` + `models.py`,
  `app/core/config.py` (session and origin settings), `app/core/database.py` (start-up check names the new tables),
  `pyproject.toml` (argon2-cffi), `.env.example`
- New frontend: `src/features/auth/`, `src/features/account/`, auth calls in `src/api/client.ts`
- Changed frontend: `src/routes.tsx`, `components/AppShell.tsx`, `components/shell/navItems.ts` (Account on),
  `features/create/` (clear stored job on logout; "confirm your email" banner)
- Reused: `ApiError`/`error_response`/`fields` (`app/core/errors.py`), per-test schemas (`tests/conftest.py`),
  `JobStore` engine, the shared component library, `ApiError.fields` in the client, the brand panel SVG from `docs/design/Login.dc.html`

## Verification

- Every step: `backend/check.sh` (PostgreSQL in Docker, mock provider) and `npm run check`; both free.
- New backend tests: password hashing, session cookie flags, revocation, token single use and
  30-minute expiry (clock injected), same answer for unknown emails, rate limits, origin refusal,
  ownership, and the full access matrix.
- Browser review in mock mode at 1440 px and 1024 px, with `"provider":"mock"` confirmed first:
  sign up → link from server log → confirm → create a video → log out → log in → a second user
  cannot open the first user's job or media (404) → forgot password → link → reset → the old
  session is refused → change password → log out everywhere.
- Not verified in M2: real email delivery (no provider), live fal.ai.

## Phase 0 results

| Item | Check | Result |
| --- | --- | --- |
| Secure cookie on `http://localhost` | A test server set `Secure; HttpOnly; SameSite=Lax`; Chromium (Playwright 1.65.1) loaded it at `localhost` and `127.0.0.1` | Cookie kept and sent back on both; page scripts cannot read it. No development-only setting needed. Other browsers not checked |
| Confirm-email screens (T-207) | Three desktop boards drawn on the canvas: notice on Create, email confirmed, link expired; copies in `design/` | Approved by the owner, 2026-11-17 |
| `argon2-cffi` | PyPI | 25.1.0, MIT, Python 3.8 or newer |
