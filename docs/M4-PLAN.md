# Plan: M4 — Razorpay payments

The governing rules are in the parent [CLAUDE.md](../CLAUDE.md). The purchase design is
[HLD.md](HLD.md) §4 (`payment_orders`, `webhook_events`, ledger kind `purchase`) and §5.1 (the
purchase flow); decisions D-007, D-014, D-016, D-021, D-022, D-033, D-041, D-042. The relied-on
Razorpay facts, each with a dated official source, are in [RAZORPAY-FACTS.md](RAZORPAY-FACTS.md)
(T-401). The owner approved this plan on 2026-11-17.

## Context

Customers buy credits with Razorpay: ₹1 = 1 credit. A purchase must credit the wallet exactly
once, whatever order the browser's confirmation, Razorpay's webhook and our reconciliation arrive
in. The owner has real Razorpay keys and pastes them into `backend/.env`. Everything is built and
tested in mock mode first.

Status reachable without a Razorpay call: **MOCK-VERIFIED**. **VERIFIED** needs T-407, a run in
Razorpay test mode that the owner approves (Gate C).

**Exit evidence** (MILESTONES.md): a purchase credits the wallet exactly once in each of five
cases: normal flow, tab closed before verification, webhook delivered twice, webhook before the
browser's call, failed then successful payment.

## Owner answers (Gate A, 2026-11-17)

| Question | Answer |
| --- | --- |
| Q-06 amounts | Any whole-rupee amount from ₹500 to ₹10,000 per purchase |
| Q-10 account | The owner has keys and a webhook secret and pastes them into `backend/.env`. Using them needs approval for that run |

## Discovery

| # | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | No contradiction between the docs and HLD §5.1 rules | RAZORPAY-FACTS.md §J | D-016 Confirmed |
| 2 | Orders: `POST /v1/orders`; minimum 100 paise; `receipt` ≤ 40 characters and unique; status `created` → `attempted` → `paid` | §A, §B | Receipt = our order id (32 hex characters). An order stays `attempted` after a failed try |
| 3 | Capture is automatic by default; payments left `authorized` are refunded after 3 days | §D | We credit only `captured`. The owner confirms auto-capture is on in the Dashboard before T-407 |
| 4 | Webhooks: at least once, any 2xx acknowledges, 5-second timeout, retried for 24 h, then disabled | §G | Answer 2xx fast after dedupe. A disabled webhook is covered by reconciliation |
| 5 | Webhook card samples show `captured: true` on non-captured payments | §G | Read `payload.payment.entity.status`, never `captured` |
| 6 | `payment.failed` may not be sent for the first failed attempt | §G | Never depend on it. Reconciliation fetches the payment |
| 7 | Key prefixes `rzp_test_` / `rzp_live_` not stated in the docs read | §H | D-042 check fails closed; confirmed in T-407 |
| 8 | Whether `GET /orders/{id}/payments` lists captured payments is unclear | §B | Reconciliation also reads the order's `status` and `amount_paid`; confirmed in T-407 |
| 9 | The design's ₹100 and ₹250 picks were below the new minimum | `docs/design/Buy-Credits.dc.html` | Board changed to ₹500 / ₹1,000 / ₹2,500 / ₹5,000. After-payment states drawn (`Payment-States.dc.html`). **Waiting on the owner's approval** |
| 10 | The design says "Credits do not expire" | Buy-Credits board | Depends on Q-05 (M6). Kept, flagged |

### Classified register

| Class | Item |
| --- | --- |
| Confirmed | D-016 flow; paise integers; ₹500–₹10,000; credit only on a valid signature, `captured` and an amount equal to the order; one crediting routine |
| Assumed | ₹1 buys 1 credit with no GST on top (Q-03 is open for M7). Reconciliation looks at orders older than 30 minutes, every 5 minutes, for up to 3 days. Quick picks ₹500 / ₹1,000 / ₹2,500 / ₹5,000 |
| Needs Verification | Key prefixes, the order-payments list, retry intervals and the webhook digest encoding (hex). All in T-407 |
| Deferred | Refunds (M6), GST invoices (Q-03, M7), live keys (M7) |
| Out of Scope | Saved cards, subscriptions, other payment providers |

## Settings

| Setting | Meaning |
| --- | --- |
| `AVATAR_PAYMENTS` | `mock` (default, no network) or `razorpay` (needs approval for that run) |
| `RAZORPAY_KEY_ID` | Public key id; the only Razorpay value sent to the browser |
| `RAZORPAY_KEY_SECRET` | API secret; used for basic auth and the checkout signature |
| `RAZORPAY_WEBHOOK_SECRET` | The secret typed when adding the webhook in the Dashboard |

`backend/.env` has these four lines with empty values (D-042: `razorpay` mode refuses to start if
one is empty, or if a non-test key is used outside production).

When the test-mode run is approved, the owner adds a webhook in the Razorpay Dashboard:
- URL: `<public address>/api/v1/webhooks/razorpay`. It needs a public address, for example a
  tunnel. This is decided at T-407.
- Events: `payment.captured`, `payment.failed`, `order.paid`.

## API contract (T-400)

| Route | Body → result | Errors |
| --- | --- | --- |
| `POST /api/v1/payments/orders` | `{rupees}` → `{order_id, razorpay_order_id, amount_paise, credits, key_id, status}` | 401, 403 `email_not_verified`, 422 `fields.rupees`, 502 `payment_provider_unavailable` |
| `GET /api/v1/payments/orders/{order_id}` | → `{order_id, status, rupees, credits, created_at}` | 401, 404 (missing or not yours) |
| `POST /api/v1/payments/verify` | `{order_id, razorpay_payment_id, razorpay_signature}` → `{order_id, status, credits, wallet}` | 401, 404, 400 `payment_signature_invalid`, 409 `payment_not_captured`, 502 |
| `POST /api/v1/webhooks/razorpay` | raw body, `X-Razorpay-Signature`, `x-razorpay-event-id` → 200 | 400 `webhook_signature_invalid` (no session, no origin check) |
| `POST /api/v1/payments/mock/complete` | development and mock mode only: `{order_id, outcome: "captured"\|"failed"}` → the Checkout handler's fields, signed with the mock secret | 404 in any other mode |
| `GET /api/v1/config` | adds `payments`, `razorpay_key_id` (null in mock), `min_purchase_rupees`, `max_purchase_rupees` | — |

The order `status` is one of `created`, `paid` or `failed`. `failed` is shown only after a
definite failure, and a later capture still credits.

## Phases

| Phase | Tasks (owner) | What happens | Done when |
| --- | --- | --- | --- |
| 0 | T-401 (done), T-400, design (Fable) | Facts with sources; the contract as schemas, 501 stubs and settings; frontend types regenerated; boards updated | The contract test passes; **the owner approves the two boards** |
| 1 | T-402 (Sonnet, BE-Payments) ∥ T-410 (Sonnet, FE-Wallet) | Migration 0006 (`payment_orders`, `webhook_events`); the gateway (httpx plus mock); create-order. Buy-credits dialog against the mocked API | Limits enforced; the gateway is the only Razorpay caller; frontend checks pass |
| 2 | T-403 (Opus) ∥ T-411 (Sonnet) | The crediting routine and the verify route. After-payment states | Credits once; signature checked with our stored order id; status `captured` and the amount checked by fetching the payment |
| 3 | T-404 (Opus) | Webhook | Raw-body signature; event-id dedupe; the same crediting routine |
| 4 | T-405 (Sonnet) | Reconciliation in the background loop | Paid but unconfirmed → credited once |
| 5 | T-406 (Sonnet) | Signed-fixture tests | The five cases, plus repeat and race cases; balance = ledger sum |
| 6 | Gates B and D (Fable) | Merge, checks, browser check in mock mode, report | MOCK-VERIFIED |
| 7 | T-407 (Fable) | One run in Razorpay test mode | Only with the owner's approval for that run |

Phase 1 and later start after M3 is done.

## Verification

- Every step: `backend/check.sh` and `npm run check` (free, no network). Gateway tests use a fake
  httpx transport.
- Browser check in mock mode at 1440 and 1024 px:
  1. Confirm `"payments":"mock"` and `"provider":"mock"` first.
  2. Buy ₹500 → mock checkout → "Payment received" → the wallet shows `purchase` +500.
  3. ₹499 and ₹10,001 are refused under the field.
  4. Failed and cancelled endings appear.
  5. No request leaves the machine.
- Not verified until T-407: Razorpay's real API, Checkout and webhooks.
