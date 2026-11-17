# Milestones — Frameforge

Nine milestones, each a slice that works end to end on backend and frontend. A milestone ends
with evidence, not with "code written".

- Task **status and verification** are kept in [tracker/tasks.json](tracker/tasks.json), not here.
- No dates are given: team size and working hours are not known. Order and dependencies are.
- Free mock-mode tests may run. Any fal.ai call, and any Razorpay call including its free test
  mode, needs the owner's approval for that run (decision D-021).

## How to read the task tables

| Column | Meaning |
| --- | --- |
| Area | BE backend, FE frontend, OPS deployment and operations, DOC documents |
| Owner | Who does it, by the parent CLAUDE.md §7. **Fable**: architecture, contracts, feasibility, acceptance. **Opus**: hard correctness, failure recovery, media pipeline. **Sonnet**: main implementation. **Haiku**: focused tests, fixtures, routine work. **Owner**: the project owner |
| Need | Parent CLAUDE.md §9. **Correctness**, **Safety** and **Acceptance** are required. **Optional** is useful but not needed to finish the milestone and is not part of its exit evidence |
| Traces to | The requirement the task satisfies ([tracker/requirements.json](tracker/requirements.json)) |

## Quality gates (parent CLAUDE.md §6)

Every milestone passes the same four gates. A failed gate means correct it, cut scope, or report
a blocker; never skip it.

| Gate | When | What must be true |
| --- | --- | --- |
| A | Before starting a milestone | Requirements understood and still wanted; acceptance criteria written; dependencies and blocking questions resolved; provider facts the work relies on are verified; each task has an owner |
| B | Before joining backend and frontend work | Both sides match the agreed API contract; unit tests pass; errors are handled; security rules respected; nothing else broke |
| C | Before any paid or live external run | User authorization requirements are satisfied (consent for the likeness used); owner has approved this specific run and its expected cost; credentials are set securely; inputs meet the provider's rules; duplicate paid requests are impossible |
| D | Before calling a milestone done | Every acceptance criterion has evidence; integration results documented with the parent file's statuses; known limits reported; generated media inspected where feasible; no open critical defect; security and privacy expectations met. Every screen the milestone touched meets the definition of done in [UX.md](UX.md) section 8 and has been seen in a browser at 1440 px and 1024 px (and at 390 px if it changes an M1.5 phone layout; D-033) |

Gate A also includes the parent file's §5 alignment check: if a task no longer adds value, or a
simpler way exists, change the plan before building.

## Overview

| | Milestone | Outcome | Depends on |
| --- | --- | --- | --- |
| M0 | Design baseline | Approved design, decisions and plan | — |
| M1 | Platform foundation | Same product as today, on PostgreSQL, with routing and a versioned API | M0 |
| M1.5 | Design system and UX | Approved designs for every customer screen, a component library, and the existing flow rebuilt to them | M1 |
| M2 | Accounts and login | Only logged-in users can use the product; each sees only their own work | M1.5, Q-02 |
| M3 | Wallet and charging | Videos cost credits; the ledger is correct under concurrency (no real payments yet) | M2, Q-01, Q-08, Q-19 |
| M4 | Razorpay payments | Customers buy credits with Razorpay in test mode | M3, Q-06, Q-10 |
| M5 | Product completeness | Scripts, banners, history, consent: a product a customer can use unaided | M4, Q-11, Q-15, Q-17 |
| M6 | Admin and operations | Staff can see, correct and reconcile money, and manage templates | M5, Q-05, Q-09 |
| M7 | Hardening and launch | Deployed, secured, verified live with real money | M6, Q-03, Q-07, Q-12, Q-13, Q-18 |

---

## M0 — Design baseline

**Exit evidence:** The owner has approved these documents and answered the questions that block
M1 to M3.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-001 | DOC | Fable | Acceptance | R-05 | Review the existing code and record the baseline | Baseline recorded with its true status |
| T-002 | DOC | Fable | Acceptance | R-05 | High-level design | Covers every Confirmed requirement |
| T-003 | DOC | Fable | Acceptance | R-05 | Decision log | Each decision has choice, alternatives, reason, trade-off, validation |
| T-004 | DOC | Fable | Acceptance | R-05 | Milestone plan and tracker data | Every task has an owner, a need and a requirement |
| T-005 | DOC | Fable | Acceptance | R-05, R-49 | Backend and frontend `CLAUDE.md` | Consistent with the parent CLAUDE.md |
| T-006 | DOC | Fable | Acceptance | R-05 | Tracking dashboard | Seen rendering correctly from the tracker files |
| T-009 | DOC | Fable | Acceptance | R-49 | Audit all documents against the parent CLAUDE.md | Each gap found is corrected |
| T-007 | DOC | Owner | Acceptance | R-05 | Owner answers the questions blocking M1 to M3: Q-01, Q-02, Q-08, Q-19 | Answers recorded in the tracker |
| T-008 | DOC | Owner | Acceptance | R-05 | Owner approves the design | Proposed decisions become Confirmed |
| T-010 | DOC | Owner | Acceptance | R-05 | Owner approves the M1 plan ([M1-PLAN.md](M1-PLAN.md)) | The decisions M1 relies on are Confirmed |

## M1 — Platform foundation

**Gate A needs:** the M1 plan approved (T-010). **Gate C:** none; mock mode only.

The phases, steps and discovery findings for this milestone are in [M1-PLAN.md](M1-PLAN.md).

**Exit evidence:** The existing create-approve-video flow works as before in mock mode, with data
in PostgreSQL, routes under `/api/v1`, and the frontend split into routed pages. The existing
backend tests pass against PostgreSQL.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-106 | BE | Sonnet | Correctness | R-42 | Restructure the backend into `core`, `jobs` and `providers` packages as a pure move | Same tests pass, same count, no logic edits |
| T-101 | BE | Sonnet | Correctness | R-42, R-58 | PostgreSQL in Docker and a `DATABASE_URL` setting | Database starts from documented steps; secrets come only from the environment |
| T-102 | BE | Sonnet | Correctness | R-42 | SQLAlchemy models and first Alembic migration for `jobs` | A fresh database is built by migrations alone |
| T-103 | BE | Opus | Correctness | R-56 | Port the job store to PostgreSQL | Compare-and-set behaviour preserved; existing tests pass |
| T-104 | BE | Sonnet | Acceptance | R-42 | `/api/v1` prefix, error shape, request-id logging, `/healthz` | Every error matches D-012 |
| T-105 | BE | Haiku | Acceptance | R-06 | One command that runs lint, type check and mock tests | Documented in `backend/CLAUDE.md` |
| T-110 | FE | Sonnet | Acceptance | R-42 | Router, app shell, feature folders and style tokens | App behaves as before; type check and lint pass |
| T-113 | FE | Sonnet | Acceptance | R-42 | Generate API types from OpenAPI and switch the client to `/api/v1` | No hand-written response type remains |
| T-111 | FE | Sonnet | Acceptance | R-08, R-55 | Move the create flow onto routes with TanStack Query | Reload at any step resumes the job |
| T-112 | FE | Haiku | Acceptance | R-06 | Test setup and first component tests | One command runs lint, type check and tests |

## M1.5 — Design system and UX

**Gate A needs:** the owner's design direction (given 2026-11-17: Canva-inspired patterns with our
own identity, a proposed brand, all planned screens, desktop first). **Gate C:** none.

The standards for this milestone and every later screen are in [UX.md](UX.md). No screen is
rebuilt until the owner approves the designs (T-152). The owner approved them on 2026-11-17; the
step-by-step build plan is in [M1.5-PLAN.md](M1.5-PLAN.md).

**Exit evidence:** The owner has approved the designs. The component library exists with tests.
The existing create flow, rebuilt to the approved design, passes the definition of done in UX.md
section 8, shown by a browser run at 1440 px and 390 px in mock mode.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-150 | DOC | Fable | Acceptance | R-75, R-79, R-80, R-81 | UX discovery and standards | [UX.md](UX.md) covers discovery, principles, the design system and the interaction standards |
| T-151 | DOC | Fable | Acceptance | R-76, R-77, R-78 | Screen designs on the design canvas | Every planned customer screen at desktop width, the main ones at phone width, plus state and component sheets |
| T-152 | DOC | Owner | Acceptance | R-78, R-82 | Owner reviews and approves the designs and the proposed brand | Changes requested are made; approval recorded |
| T-153 | FE | Sonnet | Acceptance | R-76, R-79, R-80 | Design tokens and the component library, with tests | Every component in UX.md section 4 exists, is keyboard accessible, and has tests for its states |
| T-154 | FE | Sonnet | Acceptance | R-76, R-77 | New app shell: sidebar, top bar, phone navigation | Matches the design at 1440 px and 390 px; no sideways scroll from 360 px |
| T-155 | FE | Sonnet | Acceptance | R-79, R-80, R-81 | Rebuild the create flow to the approved design | Stepper, drop zone with preview, inline validation, progress steps; meets UX.md section 8 |
| T-157 | BE | Sonnet | Acceptance | R-79 | Input errors name the field at fault (`fields`, decision D-029) | Every 422 from the jobs API carries `fields`; a contract test asserts it; API types regenerated |
| T-158 | FE | Sonnet | Correctness | R-42 | Move code shared between features into `lib/` (validation, job storage, wallet refresh, credit formatting) | No feature imports another feature; shared folders import no feature; checks pass |
| T-156 | FE | Fable | Acceptance | R-75 | Browser review against the designs | Each rebuilt screen compared with its design at both widths; differences fixed or recorded |

## M2 — Accounts and login

**Gate A needs:** Q-02 answered (done 2026-11-17: email and password, D-003). Owner approved the M2
plan on 2026-11-17 ([M2-PLAN.md](M2-PLAN.md)), with four answers recorded there. **Gate C:** none.

**Exit evidence:** An access-control test matrix shows that every job, media and account route
refuses anonymous users and refuses other users' resources.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-200 | BE | Fable | Correctness | R-01 | Agree the auth API contract before building | Routes, bodies and error codes written into the OpenAPI document |
| T-201 | BE | Sonnet | Correctness | R-01 | `users`, `sessions`, `email_tokens` tables | Migration applies cleanly |
| T-202 | BE | Sonnet | Safety | R-01 | Sign up, log in, log out, log out everywhere, current user, change password | Argon2id; cookie flags per D-003; session revocable; changing the password logs out other devices |
| T-207 | DOC | Fable | Acceptance | R-01, R-78 | Draw the confirm-email screens (no design existed) | Owner approves the boards on the canvas |
| T-203 | BE | Sonnet | Safety | R-01 | Email verification and password reset, as in HLD section 5.5 | Single-use tokens stored hashed, reset links expire in 30 minutes; the forgot route answers the same for unknown emails; a reset revokes every session; emails printed to the console in development; an unverified account cannot create or approve a job (D-036) |
| T-204 | BE | Sonnet | Safety | R-12 | Jobs belong to a user; protect every job and media route | Another user's job returns 404 |
| T-205 | BE | Sonnet | Safety | R-01 | Rate limits and origin check | Repeated bad logins are throttled; cross-site POST refused |
| T-206 | BE | Haiku | Safety | R-12 | Access-control test matrix | Every route × anonymous / owner / other user / admin |
| T-210 | FE | Sonnet | Acceptance | R-01 | Sign-up, log-in, confirm-email, forgot and reset screens, built from their designs | Matches the desktop designs (including the four password-reset screens and the T-207 boards); meets UX.md section 8 |
| T-211 | FE | Sonnet | Safety | R-01 | Session bootstrap, guarded routes, handling of 401 | Expired session returns the user to log in, then back |
| T-212 | FE | Sonnet | Acceptance | R-01 | Account page | Change password; log out everywhere |

## M3 — Wallet and charging

**Gate A needs:** Q-01, Q-08, Q-19 answered (done 2026-11-17: 20 credits per second, 10 credits per
voice, unknown outcome charged; [M3-PLAN.md](M3-PLAN.md)). **Gate C:** none; credits are granted by a
developer-only command.

**Exit evidence:** A concurrency test fires many approvals and credits at one wallet and shows no
overspend, and that the stored balance equals the sum of the ledger.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-300 | BE | Fable | Correctness | R-04 | Agree the wallet API contract before building | Routes, bodies and error codes written into the OpenAPI document |
| T-301 | BE | Opus | Correctness | R-04 | `wallets` and `ledger_entries` with constraints | The database itself rejects a negative available balance and a duplicate entry |
| T-302 | BE | Opus | Correctness | R-04, R-10 | Ledger service: credit, hold, capture, release | Row-locked; idempotent on `(kind, ref_type, ref_id)` |
| T-303 | BE | Sonnet | Correctness | R-09 | Pricing | Price stored on the job when audio is ready (D-006) |
| T-304 | BE | Opus | Correctness | R-10, R-56 | Tie job status changes to ledger entries | Each row of the table in HLD §5.2 is one transaction |
| T-305 | BE | Opus | Correctness | R-04, R-10 | Concurrency and invariant tests | No overspend; balance = sum of ledger |
| T-306 | BE | Sonnet | Acceptance | R-13 | Wallet routes and a developer-only credit command | Command refuses to run outside development |
| T-310 | FE | Sonnet | Acceptance | R-13 | Balance in the header; wallet page with transactions | Balance refreshes after every charge |
| T-311 | FE | Sonnet | Acceptance | R-09 | Show the price before approval; handle "not enough credits" | Approval disabled with the shortfall shown |

## M4 — Razorpay payments

**Gate A needs:** Q-06 answered (done 2026-11-17; now 1,000 to 10,000 credits, D-059; the customer pays the payment fee, D-060); Razorpay facts re-checked (T-401,
done: [RAZORPAY-FACTS.md](RAZORPAY-FACTS.md)); plan in [M4-PLAN.md](M4-PLAN.md). **Gate C:** T-407 needs the
owner's test keys (Q-10: the owner has them). Test mode is free, but it is an external run and needs the owner's
go-ahead.

**Exit evidence:** A purchase credits the wallet exactly once in each of these cases: normal
flow, tab closed before verification, webhook delivered twice, webhook delivered before the
browser's call, failed then successful payment. MOCK-VERIFIED from signed fixtures; VERIFIED
only after T-407.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-400 | BE | Fable | Correctness | R-02 | Agree the payments API contract before building | Routes, bodies and error codes written into the OpenAPI document |
| T-401 | BE | Fable | Correctness | R-02, R-66 | Re-check Razorpay documentation against D-016 | Each relied-on fact has a dated source |
| T-402 | BE | Sonnet | Correctness | R-02, R-03 | `payment_orders` and the create-order route | Amount in paise; purchase limits enforced |
| T-403 | BE | Opus | Safety | R-03 | Verify route | Uses our stored order id; checks `captured` and amount |
| T-404 | BE | Opus | Safety | R-03 | Webhook route | Raw-body signature; dedupe on event id; unsigned → 400 |
| T-405 | BE | Sonnet | Correctness | R-03 | Reconcile stale orders | An order paid but never confirmed is credited |
| T-406 | BE | Sonnet | Correctness | R-03 | Tests with signed fixtures | All five cases above, without network |
| T-407 | BE | Fable | Acceptance | R-02, R-22 | End-to-end run in Razorpay test mode | Owner-approved run; evidence recorded |
| T-410 | FE | Sonnet | Acceptance | R-02 | Buy-credits screen with Razorpay Checkout | Amount entry in whole credits, 1,000 to 10,000 (D-047, D-059); shows the price, the payment fee and the total from the server (D-060) |
| T-411 | FE | Sonnet | Acceptance | R-02 | After-payment states | Success, still confirming, failed, cancelled |
| T-412 | FE | Sonnet | Acceptance | R-86, R-87 | Fee line from the quote; top up from the review screen and return to the video (D-060, D-061) | The dialog shows price, fee and total from `GET /payments/quote`; "Add credits" on a short review opens Buy credits at 1,000 with a safe return address; success returns to the job with Approve enabled |

## M5 — Product completeness

**Gate A needs:** Q-11, Q-15, Q-17 answered; placeholder or real banner clips available (Q-14).
**Gate C:** none; joining is tested with small generated clips in mock mode.

**Exit evidence:** A new user can sign up, buy credits, pick a saved script, switch on banners and
pick them, make a video that plays start banner, AI video, end banner in one file, make another
without banners that skips the joining step, and find it again later, on a
desktop-width screen (D-033). All in mock mode.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-500 | BE | Fable | Correctness | R-43, R-44 | Agree the scripts, templates and job-list API contract before building | Routes, bodies and error codes written into the OpenAPI document |
| T-501 | BE | Sonnet | Acceptance | R-13 | Job list with pagination | Only the caller's jobs; newest first |
| T-502 | BE | Sonnet | Safety | R-14 | Record consent on each job | Job cannot be created without it |
| T-503 | BE | Sonnet | Safety | R-11 | Daily video limit outside production (D-046) | Outside production the 51st approval in a day → 429 `daily_limit_reached`, nothing held; production has no limit; voices are never limited |
| T-504 | BE | Sonnet | Acceptance | R-43, R-50 | `scripts` table and library routes | Saved on first use; no duplicates; only the owner can list, read or delete |
| T-505 | BE | Sonnet | Correctness | R-51 | Job creation accepts script text or a saved script id | The job stores its own copy; deleting the script leaves the job unchanged |
| T-506 | BE | Sonnet | Acceptance | R-44, R-46, R-47 | `templates` table, a command to add clips, and the list route | A clip is measured when added; only active templates are listed |
| T-507 | BE | Opus | Correctness | R-44, R-67 | Joining module: measure a video and join start clip + video + end clip with ffmpeg | Works on files alone, with no knowledge of jobs or the wallet; clips converted to match the measured video |
| T-508 | BE | Sonnet | Correctness | R-44 | Joining module tests with small generated clips | Both banners, one, none, a silent clip, clips of a different size and frame rate |
| T-509 | BE | Opus | Correctness | R-48, R-53, R-56 | Wire joining into the job lifecycle as `video_assembling` | Retried; re-run after restart; fallback per D-019; exactly one charge in every case; price unchanged |
| T-510 | FE | Sonnet | Acceptance | R-13 | Home screen | Balance, create, in progress, recent |
| T-511 | FE | Sonnet | Acceptance | R-13 | Video history and detail | Play, download, see what it cost |
| T-512 | FE | Sonnet | Acceptance | R-55 | Loading, empty and error states; responsive; accessibility pass | Every screen has all three states |
| T-513 | FE | Sonnet | Acceptance | R-43 | Script picker on Create and a "My scripts" screen | Paste new or pick saved; delete with confirmation |
| T-514 | FE | Sonnet | Acceptance | R-45, R-52, R-85 | Banner picker with playable previews behind an "Add banners" switch (D-058) | Switch off by default and lists hidden; on: start and end chosen separately, "None" available; choice shown before approval only when banners were added |
| T-515 | FE | Sonnet | Acceptance | R-53, R-85 | Show the joining step and the no-banner fallback | "Adding your banners" appears only for jobs with banners; customer is told plainly when banners could not be added |
| T-516 | BE | Opus | Correctness | R-83 | Saved voices: start a new job from a failed job's voice (D-043) | No voice charge; the voice is copied to the new job; price from its length; only the caller's failed jobs are offered (404 otherwise); `save_all_voices` setting, default off |
| T-517 | FE | Sonnet | Acceptance | R-83 | Voice choice on Create and "Make a video with this voice" on failed results | Matches the approved boards; consent still required; server decides the price |
| T-518 | BE | Fable | Correctness | R-84 | Verify the video model's maximum audio length (D-044) | Dated official source recorded; the owner sets the limit (D-056: 60 s) and the photo rules (D-057) |

## M6 — Admin and operations

**Gate A needs:** Q-05, Q-09 answered. **Gate C:** none.

**Exit evidence:** A reconciliation report for a test period shows Razorpay captured payments
equal to purchase entries, and lists any jobs flagged for review. An admin can correct a balance
and retire a template, each leaving an audit record.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-600 | BE | Fable | Correctness | R-15 | Agree the admin API contract before building | Routes, bodies and error codes written into the OpenAPI document |
| T-601 | BE | Sonnet | Safety | R-15 | Admin role and read routes | Non-admins get 403 |
| T-602 | BE | Sonnet | Correctness | R-15 | Manual balance adjustment | Reason required; written to the audit log |
| T-603 | BE | Opus | Correctness | R-03 | Refund handling | A Razorpay refund reverses the credits once |
| T-604 | BE | Sonnet | Acceptance | R-15 | Reconciliation report | Payments vs ledger; flagged jobs listed |
| T-605 | BE | Sonnet | Optional | R-23 | Low fal.ai balance alert | Blocked until a way to read the balance is verified |
| T-606 | BE | Sonnet | Safety | R-74 | Media and script retention and cleanup | Policy from Q-09 applied |
| T-607 | BE | Sonnet | Acceptance | R-46 | Admin routes to add and retire templates | Admin only; audited; a retired template stays on past jobs |
| T-610 | FE | Sonnet | Optional | R-15 | Admin console: users, payments, ledger, adjust | The same actions work by command without it |
| T-611 | FE | Sonnet | Optional | R-46 | Admin screen to add, preview and retire templates | The same actions work by command without it |

## M7 — Hardening and launch

**Gate A needs:** Q-03, Q-07, Q-12, Q-18 answered. **Gate C:** T-705 (paid fal.ai run, Q-13) and
T-706 (real payment) each need the owner's approval for that run, with the expected cost stated
first.

**Exit evidence:** On the production deployment, one real payment credits a wallet and one real
fal.ai video with banners is generated, judged against the owner's quality criteria, and charged.

| ID | Area | Owner | Need | Traces to | Task | Accepted when |
| --- | --- | --- | --- | --- | --- | --- |
| T-701 | BE | Opus | Safety | R-12, R-58 | Security review and dependency audit | No open high-severity findings |
| T-702 | OPS | Sonnet | Acceptance | R-26 | Deployment, HTTPS, secrets, backups | A restore from backup has been performed |
| T-703 | BE | Sonnet | Safety | R-12, R-57 | Object storage for media | Only the owner can fetch a file |
| T-704 | OPS | Sonnet | Acceptance | R-42 | Logs, error tracking, alerts | A failed payment and a failed job each raise an alert |
| T-705 | BE | Fable | Acceptance | R-24, R-60, R-63, R-67, R-68 | Live fal.ai run, end to end, with banners | Owner approves the spend first; output inspected against Q-18 |
| T-706 | BE | Fable | Acceptance | R-22 | Razorpay live mode and a real payment | Owner approves first |
| T-707 | DOC | Owner | Acceptance | R-20, R-21 | Terms, privacy policy, refund policy, tax invoices | Reviewed by the owner's accountant and lawyer |
| T-710 | FE | Sonnet | Safety | R-42 | Production build, content security policy, error reporting | No inline scripts beyond what Razorpay requires |
| T-711 | FE | Sonnet | Optional | R-42 | End-to-end browser tests | Sign up → buy → generate, in mock mode |

---

## Parallel plan

Milestones describe what is finished when. They are not a queue: tasks from different milestones
can run at the same time when they do not depend on each other and do not touch the same files.
The parent CLAUDE.md allows parallel work only for tasks that are genuinely independent and
forbids simultaneous changes to shared files. This plan is built on those two rules (D-022).

### Lanes

A lane is a set of files with one worker at a time. Two tasks in different lanes can run in
parallel once the tasks they start after are done. Two tasks in the same lane never run together.

| Lane | Files it owns | Notes |
| --- | --- | --- |
| Docs | `docs/`; the design canvas | |
| Contract | The milestone's new `backend/app/<feature>/schemas.py` and route stubs, and the regenerated `frontend/src/api/openapi.json` and `schema.d.ts` | The agreed routes, bodies and error codes, written as code (stubs answer 501) so OpenAPI is the contract. Backend and frontend both build to it, which is what lets them work at the same time |
| BE-Core | `backend/app/core/`, `backend/app/main.py`, `backend/pyproject.toml`, `backend/migrations/` | The backend integrator. The only lane that registers routes and orders migrations |
| BE-Auth | `backend/app/auth/` | |
| BE-Wallet | `backend/app/wallet/` | |
| BE-Pay | `backend/app/payments/` | |
| BE-Jobs | `backend/app/jobs/` (today `service.py`, `db.py`) | The job lifecycle. Strictly one task at a time: most features end here |
| BE-Content | `backend/app/scripts/`, `backend/app/templates/` | |
| BE-Media | `backend/app/media/` | ffmpeg joining; depends on nothing else |
| BE-Admin | `backend/app/admin/` | |
| FE-Shell | `frontend/src/routes.tsx`, `frontend/src/api/`, `frontend/src/styles/`, `frontend/package.json` | The frontend integrator |
| FE-Auth, FE-Account, FE-Create, FE-Wallet, FE-Home, FE-Videos, FE-Admin | `frontend/src/features/<name>/` | One folder each. FE-Create also owns `features/scripts/` (T-513) |
| Ops | Deployment and monitoring configuration | |
| Review | No files; reads and runs | Security review and the owner-approved live runs |

### Rules that prevent conflicts

1. **One task per lane at a time.** A task changes only its lane's files.
2. **Shared files have one owner.** A feature lane that needs a new route registered, a new
   migration or a new dependency hands that small change to BE-Core or FE-Shell. It does not edit
   those files itself.
3. **Migrations are a single chain.** Each lane writes its tables; BE-Core gives the migration its
   place in the order. Two migrations are never created from the same parent.
4. **Contract before code.** Backend and frontend work on a feature starts only after its
   contract task is done. The frontend builds against a mocked API until Gate B.
5. **Each parallel task works in its own git worktree and branch.** Fable merges one branch at a
   time and runs the mock tests after each merge (Gate B).
6. **Tracker files are updated by the integrator at merge time**, not by each task, so two tasks
   never edit `tasks.json` together.
7. If a task finds it must change another lane's file, it stops and reports. That is a sign the
   split was wrong, not something to work around.

### What can run together

| Stage | In parallel |
| --- | --- |
| After M0 is approved | BE-Core (T-101) · FE-Shell (T-110) · Contract (T-200 once the M1.5 review T-156 is done, then T-300, T-400, T-500, T-600) · Razorpay fact check (T-401) · legal and tax review (T-707) |
| After the versioned API (T-104) | BE-Auth · FE-Auth · BE-Media (joining module T-507, T-508) |
| After login works (T-202, T-204) | BE-Wallet · FE-Wallet · BE-Content (scripts T-504) · BE-Admin read routes (T-601) |
| After the ledger service (T-302) | BE-Pay · BE-Jobs (charging T-304) · FE-Create (price T-311) · FE-Wallet (buy credits T-410) |
| After charging is tied in (T-304) | BE-Jobs finishes scripts, consent, the daily video limit, saved voices and wires joining (T-509) · FE-Create adds the pickers and the voice choice · FE-Home, FE-Videos |

Where parallel work does **not** help: the BE-Jobs lane. Ownership, pricing, charging, consent,
script copy and joining all change the job lifecycle, so they run one after another. That lane
sets the shortest possible schedule.

### Dependencies and lanes

"Starts after" lists the tasks that must be Done first. A task with every listed task Done, and
its lane free, can start.

| ID | Lane | Starts after |
| --- | --- | --- |
| T-001 | Docs | — |
| T-002 | Docs | — |
| T-003 | Docs | — |
| T-004 | Docs | — |
| T-005 | Docs | — |
| T-006 | Docs | — |
| T-009 | Docs | — |
| T-007 | Docs | — |
| T-008 | Docs | T-007 |
| T-010 | Docs | — |
| T-106 | BE-Core | T-010 |
| T-101 | BE-Core | T-106 |
| T-102 | BE-Core | T-101 |
| T-103 | BE-Jobs | T-102 |
| T-104 | BE-Core | T-103 |
| T-105 | BE-Core | T-104 |
| T-110 | FE-Shell | T-010 |
| T-111 | FE-Create | T-113 |
| T-112 | FE-Shell | T-110 |
| T-113 | FE-Shell | T-104, T-112 |
| T-150 | Docs | — |
| T-151 | Docs | T-150 |
| T-152 | Docs | T-151 |
| T-153 | FE-Shell | T-152, T-113 |
| T-154 | FE-Shell | T-153 |
| T-157 | BE-Core | T-105 |
| T-155 | FE-Create | T-154, T-111, T-157 |
| T-156 | Review | T-155 |
| T-158 | FE-Shell | T-311, T-212 |
| T-200 | Contract | T-156 |
| T-201 | BE-Auth | T-104, T-200 |
| T-202 | BE-Auth | T-201 |
| T-203 | BE-Auth | T-202 |
| T-204 | BE-Jobs | T-202 |
| T-205 | BE-Auth | T-203 |
| T-206 | BE-Auth | T-204, T-205 |
| T-207 | Docs | T-156 |
| T-210 | FE-Auth | T-154, T-200, T-207 |
| T-211 | FE-Shell | T-210, T-154 |
| T-212 | FE-Account | T-211 |
| T-300 | Contract | T-200 |
| T-301 | BE-Wallet | T-202, T-300 |
| T-302 | BE-Wallet | T-301 |
| T-303 | BE-Jobs | T-204, T-300 |
| T-304 | BE-Jobs | T-302, T-303 |
| T-305 | BE-Wallet | T-304, T-306 |
| T-306 | BE-Wallet | T-302 |
| T-310 | FE-Wallet | T-211, T-300 |
| T-311 | FE-Create | T-155, T-211, T-300 |
| T-400 | Contract | T-300 |
| T-401 | Review | T-300 |
| T-402 | BE-Pay | T-302, T-400, T-401 |
| T-403 | BE-Pay | T-402 |
| T-404 | BE-Pay | T-403 |
| T-405 | BE-Pay | T-404 |
| T-406 | BE-Pay | T-405 |
| T-407 | Review | T-406, T-411 |
| T-410 | FE-Wallet | T-310, T-400 |
| T-411 | FE-Wallet | T-410 |
| T-412 | FE-Wallet | T-411, T-402 |
| T-500 | Contract | T-400 |
| T-501 | BE-Jobs | T-304, T-500 |
| T-502 | BE-Jobs | T-501 |
| T-503 | BE-Jobs | T-502 |
| T-504 | BE-Content | T-204, T-500 |
| T-505 | BE-Jobs | T-503, T-504 |
| T-506 | BE-Content | T-504 |
| T-507 | BE-Media | T-104 |
| T-508 | BE-Media | T-507 |
| T-509 | BE-Jobs | T-505, T-506, T-508 |
| T-510 | FE-Home | T-310, T-500 |
| T-511 | FE-Videos | T-211, T-500 |
| T-512 | FE-Shell | T-510, T-511, T-515, T-158 |
| T-513 | FE-Create | T-311, T-500 |
| T-514 | FE-Create | T-513 |
| T-515 | FE-Create | T-514 |
| T-516 | BE-Jobs | T-509 |
| T-517 | FE-Create | T-515, T-516 |
| T-518 | Review | — |
| T-600 | Contract | T-500 |
| T-601 | BE-Admin | T-202, T-600 |
| T-602 | BE-Admin | T-601, T-302 |
| T-603 | BE-Pay | T-406, T-600 |
| T-604 | BE-Admin | T-602, T-406 |
| T-605 | BE-Admin | T-604 |
| T-606 | BE-Content | T-506, T-509 |
| T-607 | BE-Content | T-606, T-601 |
| T-610 | FE-Admin | T-211, T-600 |
| T-611 | FE-Admin | T-610 |
| T-701 | Review | T-604, T-607, T-512 |
| T-702 | Ops | T-701 |
| T-703 | BE-Core | T-702, T-105 |
| T-704 | Ops | T-702 |
| T-705 | Review | T-703, T-509 |
| T-706 | Review | T-705, T-407 |
| T-707 | Docs | T-008 |
| T-710 | FE-Shell | T-512 |
| T-711 | FE-Shell | T-710 |
