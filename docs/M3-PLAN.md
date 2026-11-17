# Plan: M3 — Wallet and charging

The governing rules are in the parent [CLAUDE.md](../CLAUDE.md). The charging design is
[HLD.md](HLD.md) §4 (tables, ledger kinds) and §5.2 (one transaction per status change);
decisions D-004, D-005, D-006, D-014, D-038, D-039, D-040, D-046, D-048. Owner said on 2026-11-17: when M2 is done, proceed
with the next set of development.

## Context

Accounts exist (M2). M3 gives each account a credit balance and charges it: 10 credits per voice,
20 credits per second of video, held at approval, taken on delivery, returned on a clear failure.
There are no payments yet (M4); credits are granted by a developer-only command. Status reachable:
**MOCK-VERIFIED**. No fal.ai or Razorpay call; mock provider only; desktop-only screens (D-033).

Exit evidence (MILESTONES.md): a concurrency test fires many approvals and credits at one wallet
and shows no overspend, and that the stored balance equals the sum of the ledger.

## Owner answers (Gate A, 2026-11-17)

| Question | Answer | Decision |
| --- | --- | --- |
| Q-01 price | 20 credits per second of voice (600 for a 30-second video), `ceil` to whole credits | D-006 |
| Q-08 voice | 10 credits per voice, taken at submit, kept if no video is made, returned if the voice itself fails | D-038 (replaces D-015) |
| Q-19 unknown outcome | Video submission: the customer is charged (hold captured), job flagged; clear failures return credits. A voice with an unknown outcome returns its 10 credits instead (D-048, later) | D-005 |
| Voice longer than the limit (asked 2026-11-17, during T-304) | No refund: the 10 credits are kept and the voice is saved on the job for reuse (reuse is designed in M5) | D-040, amends D-038 |

## Proactive discovery

| # | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | Every status change is its own transaction inside `JobStore.transition` | `app/jobs/db.py` | T-304 lets a transition and a ledger entry share one connection; the wallet module still owns every ledger write (backend rule 1) |
| 2 | `JobOut.estimated_video_cost_usd` and `ConfigOut.video_price_per_second_usd` show the company's fal.ai cost to customers | `app/jobs/schemas.py`, `routes.py` | Removed in T-303; replaced by credit prices from the server |
| 3 | The poller marks a timed-out video `failed`; a crash mid-submission is marked failed at restart | `service.py` `poll_once`, `recover_interrupted` | Timeout = clear failure → release. Interrupted submission = unknown outcome → capture + flag (Q-19) |
| 4 | Jobs without an owner exist (pre-M2) | T-204 | They are never charged and never shown |
| 5 | The design shows a credits pill, a wallet page, a price card on review and a "Not enough credits" state | `Main`, `Wallet`, `Create-3-Review`, `States` boards | Built in T-310, T-311 from those boards; "Buy credits" stays hidden until M4 |
| 6 | The error shape has no field for numbers | `ErrorOut` | A 402 says the amounts in `detail` ("This video costs 240 credits. You have 100."), so the browser never computes money |

### Classified register

| Class | Item |
| --- | --- |
| Confirmed | Prices and charging rules above; hold, capture, release (D-005); ₹1 = 1 credit (D-007) |
| Assumed | Price rounds up to whole credits. A failed voice returns its 10 credits. Insufficient credits at submit or approval answers 402 `insufficient_credits`. Flagged jobs get a `needs_review` column. A new account starts with 0 credits |
| Needs Verification | That PostgreSQL row locks plus the `CHECK` constraint hold under concurrent approvals (proved by T-305, not assumed) |
| Deferred | Credit expiry (Q-05, M6). Buying credits (M4). Admin adjustments and refunds of flagged jobs (M6). GST lines (Q-03) |
| Out of Scope | Transfers between customers (Q-12). Integers only for money is Proposed (D-014) and followed everywhere |

## API contract (T-300)

| Route | Result | Errors |
| --- | --- | --- |
| `GET /api/v1/wallet` | `{balance_credits, reserved_credits, available_credits}` | 401 |
| `GET /api/v1/wallet/transactions?page=&page_size=` | `{items: [{id, kind, credits, reserved_delta, balance_after, reserved_after, job_id, created_at}], total, page, page_size}`, newest first | 401, 422 |
| `GET /api/v1/config` | adds `credits_per_second`, `voice_price_credits`; drops the USD cost | — |
| `JobOut` | adds `price_credits` (null until the voice is ready) and `charged_credits`; drops the USD cost | — |
| `POST /api/v1/jobs`, `POST /api/v1/jobs/{id}/approve` | unchanged bodies | add 402 `insufficient_credits` |
| Developer command | `uv run python -m app.wallet.cli grant <email> <credits>`; refuses unless `AVATAR_ENV=development` | — |

## Phases

| Phase | Tasks (owner) | What happens | Done when |
| --- | --- | --- | --- |
| 0 | Gate A, T-300 (Fable) | This plan; decisions; the contract as schemas and 501 stubs; frontend types regenerated | Contract test passes |
| 1 | T-301 + T-302 (Opus, BE-Wallet) ∥ T-310 (Sonnet, FE-Wallet) | `wallets` and `ledger_entries` with the `CHECK` and `UNIQUE (kind, ref_type, ref_id)`; ledger service with row locks and idempotency. Frontend: credits pill and wallet page against the mocked API | The database rejects overspend and duplicates; frontend checks pass |
| 2 | T-303 (Sonnet) + T-304 (Opus), built together by Opus in BE-Jobs ∥ T-306 (Sonnet, BE-Wallet) ∥ T-311 (Sonnet, FE-Create) | Voice charge at submit; price fixed at audio-ready; every row of HLD §5.2 as one transaction. Wallet routes and the grant command. Price card on review, 402 handling with the server's message | One test per §5.2 row |
| 3 | T-305 (Opus) | Concurrency and invariant tests: many approvals and grants at once on one wallet | No overspend; balance = sum of ledger |
| 4 | Gates B and D (Fable) | Merge, both checks, browser review at 1440 and 1024 px in mock mode, report | Report written |

Single file ownership per lane (D-022); Fable reviews every diff before merging.

## Verification

- Every step: `backend/check.sh` and `npm run check` (free, mock).
- T-305: concurrent approvals and grants against PostgreSQL; the invariant checked after every run.
- Browser, mock mode: grant credits with the command → create (voice charge shown) → price on
  review → approve (hold) → video (capture) → wallet shows each entry; a second job with too few
  credits shows the shortfall message.
- Not verified in M3: real payments (M4), live fal.ai.

## M3 report (Gates B and D, 2026-11-17)

**Status: MOCK-VERIFIED.** No fal.ai or Razorpay call was made; the backend ran with
`AVATAR_PROVIDER=mock` and `AVATAR_PAYMENTS=mock`, confirmed through `/api/v1/config` first.

| Point | Result |
| --- | --- |
| What was implemented | Wallets and an append-only ledger (T-301, T-302); prices fixed at voice-ready (T-303); every HLD §5.2 status change committed with its ledger entry (T-304), with per-attempt holds (D-039); wallet routes and the development-only grant command (T-306); credits pill, wallet page, price on review and the not-enough-credits state (T-310, T-311). Later owner decisions built in: D-040, D-047, D-048, D-056, D-057 |
| Why | Videos cost credits (D-006, D-038) and the balance must never be overspent or double-charged (R-04, R-10) |
| What was verified | Concurrency (T-305): concurrent holds, approvals, grants and job creations on one wallet never overspend; the balance always equals the ledger sum. Browser run (`scratchpad/browser/m3.mjs`, Chromium, 1440 and 1024 px): 22 of 22 checks passed — a new account has 0 credits and cannot make a voice; the grant command adds 300; a voice takes 10 (pill 290); the price shown is the server's `ceil(3.8 s × 20) = 76`; approval holds it and delivery captures it (wallet 214, nothing reserved); the wallet lists grant, voice, hold and capture newest first; a second job priced 934 with 204 available shows "This video costs 934 credits. You have 204.", Approve is disabled, and a forced approve gets 402 `insufficient_credits` with nothing held; no sideways scroll at 1024 px; no request left the machine. Screenshots were inspected |
| Tests executed | `backend/check.sh`: 392 passed. `npm run check`: 352 passed |
| What remains unverified | Live fal.ai (owner: documentation checks only, Q-13). Browsers other than Chromium |
| Known risks or limitations | Jobs left in flight from before migration 0005 cannot be settled (none existed in the development database). A refused job-settlement is logged and retried each poll, never charged twice. The "Buy credits" action arrives with M4 |
| Next justified action | M4 (payments) is being built in parallel; then its browser check and the owner-approved Razorpay test-mode run (T-407) |
