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

## Governing documents

The parent CLAUDE.md wins on any conflict and is never edited.

| Document | What it governs here |
| --- | --- |
| Parent [CLAUDE.md](../CLAUDE.md) | §2 protocol for every task; §3 the discovery register; §4 no Razorpay endpoint, parameter or field written from memory; §6 Gates A–D; §7 model routing and nine-part briefs; §8 stop conditions; §10 report with the five statuses |
| [backend/CLAUDE.md](../backend/CLAUDE.md) | Money rules 1–9 (rule 7: one crediting routine; rule 8: raw-body webhook signature, event-id dedupe; rule 9: idempotent); secrets only from the environment; no new dependency without a decision; cost rule D-021 |
| [frontend/CLAUDE.md](../frontend/CLAUDE.md) | No Checkout option from memory; "a success in the browser is not a payment"; only the public key id reaches the browser; tests never reach Razorpay |
| [HLD.md](HLD.md) §4, §5.1 | `payment_orders`, `webhook_events`, ledger kind `purchase`, the purchase sequence |
| [UX.md](UX.md) §7 | Payment confirming: refetch every 2 s for up to a minute, then "still confirming"; credits pill refetched after payment |
| [README.md](README.md) | Delegation brief and report templates |

## Owner answers (Gate A, 2026-11-17)

| Question | Answer |
| --- | --- |
| Q-06 amounts | Any whole number of credits from 1,000 to 10,000 per purchase (D-059; ₹1 = 1 credit). The contract is in credits (D-047) |
| Payment fee | The customer pays it: 2% on top, a setting; GST on the fee off unless set (D-060) |
| Short of credits | Top up from the review screen and come back to the same video (D-061) |
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
| 9 | The design's ₹100 and ₹250 picks were below the new minimum | `docs/design/Buy-Credits.dc.html` | Board changed to 500 / 1,000 / 2,500 / 5,000 credits. After-payment states drawn (`Payment-States.dc.html`). Approved by the owner on 2026-11-17 |
| 10 | The design says "Credits do not expire" | Buy-Credits board | Depends on Q-05 (M6). Kept, flagged |

### Classified register

| Class | Item |
| --- | --- |
| Confirmed | D-016 flow; paise integers; 1,000–10,000 credits per purchase (D-047, D-059); the customer pays the payment fee (D-060); credit only on a valid signature, `captured` and an amount equal to the order; one crediting routine |
| Confirmed | ₹1 buys 1 credit with no GST (Q-03 answered: not applicable). Bought credits are not refundable (D-053) |
| Assumed | Reconciliation looks at orders older than 30 minutes, every 5 minutes, for up to 3 days. Quick picks 500 / 1,000 / 2,500 / 5,000 credits |
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
| `AVATAR_PAYMENT_FEE_BPS` | Payment fee the customer pays, in basis points (default 200 = 2%; D-060) |
| `AVATAR_PAYMENT_FEE_GST_BPS` | GST on that fee, in basis points (default 0 = off) |

`backend/.env` has these four lines with empty values (D-042: `razorpay` mode refuses to start if
one is empty, or if a non-test key is used outside production).

When the test-mode run is approved, the owner adds a webhook in the Razorpay Dashboard:
- URL: `<public address>/api/v1/webhooks/razorpay`. It needs a public address, for example a
  tunnel. This is decided at T-407.
- Events: `payment.captured`, `payment.failed`, `order.paid`.

## API contract (T-400)

| Route | Body → result | Errors |
| --- | --- | --- |
| `GET /api/v1/payments/quote?credits=N` | → `{credits, price_paise, fee_paise, fee_gst_paise, amount_paise}` (D-060) | 401, 422 `validation_error` with `fields.credits` |
| `POST /api/v1/payments/orders` | `{credits}` (D-047) → `{order_id, razorpay_order_id, price_paise, fee_paise, fee_gst_paise, amount_paise, credits, key_id, status}`; `amount_paise` is the total the customer pays | 401, 403 `email_not_verified` (D-049), 422 `validation_error` with `fields.credits`, 502 `payment_provider_unavailable` |
| `GET /api/v1/payments/orders/{order_id}` | → `{order_id, status, credits, created_at}` | 401, 404 `order_not_found` (missing or not yours) |
| `POST /api/v1/payments/verify` | `{order_id, razorpay_payment_id, razorpay_signature}` → `{order_id, status, credits, wallet}` | 401, 404 `order_not_found`, 400 `payment_signature_invalid`, 409 `payment_not_captured`, 502 |
| `POST /api/v1/webhooks/razorpay` | raw body, `X-Razorpay-Signature`, `x-razorpay-event-id` → 200 | 400 `webhook_signature_invalid` (no session, no origin check) |
| `POST /api/v1/payments/mock/complete` | development and mock mode only: `{order_id, outcome: "captured"\|"failed"}` → the Checkout handler's fields, signed with the mock secret | 404 in any other mode |
| `GET /api/v1/config` | adds `payments`, `razorpay_key_id` (null in mock), `min_purchase_credits`, `max_purchase_credits`, `payment_fee_bps`, `payment_fee_gst_bps` (display only), `support_email` | — |

Production refuses to start with `AVATAR_PAYMENTS=mock` (D-042, added at review).

The order `status` is one of `created`, `paid` or `failed`. `failed` is shown only after a
definite failure, and a later capture still credits.

## Phases

| Phase | Tasks (owner) | What happens | Done when |
| --- | --- | --- | --- |
| 0 | T-401 (done), T-400, design (Fable) | Facts with sources; the contract as schemas, 501 stubs and settings; frontend types regenerated; boards updated | The contract test passes; the owner approved the two boards (2026-11-17) |
| 1 | T-402 (Sonnet, BE-Pay) ∥ T-410 (Sonnet, FE-Wallet) | Migration 0006 (`payment_orders`, `webhook_events`); the gateway (httpx plus mock); create-order. Buy-credits dialog against the mocked API | Limits enforced; the gateway is the only Razorpay caller; frontend checks pass |
| 2 | T-403 (Opus) ∥ T-411 (Sonnet) | The crediting routine and the verify route. After-payment states | Credits once; signature checked with our stored order id; status `captured` and the amount checked by fetching the payment |
| 3 | T-404 (Opus) | Webhook | Raw-body signature; event-id dedupe; the same crediting routine |
| 4 | T-405 (Sonnet) | Reconciliation in the background loop | Paid but unconfirmed → credited once |
| 5 | T-406 (Sonnet) | Signed-fixture tests | The five cases, plus repeat and race cases; balance = ledger sum |
| 6 | Gates B and D (Fable) | Merge, checks, browser check in mock mode, report | MOCK-VERIFIED |
| 7 | T-407 (Fable) | One run in Razorpay test mode; the webhook reaches the local backend through a temporary tunnel opened only for that run (owner, 2026-11-17; the tool is confirmed then) | Only with the owner's approval for that run |

Phase 1 and later start after M3 is done (its build is done; the M3 browser check and report remain).

## Verification

- Every step: `backend/check.sh` and `npm run check` (free, no network). Gateway tests use a fake
  httpx transport.
- Browser check in mock mode at 1440 and 1024 px:
  1. Confirm `"payments":"mock"` and `"provider":"mock"` first.
  2. Buy 1,000 credits → the dialog shows ₹1,000 + ₹20 fee = ₹1,020 → mock checkout → "Payment received" → the wallet shows `purchase` +1,000.
  2b. A video the customer cannot afford → "Add credits" → pay → "Back to your video" → Approve enabled (D-061).
  3. 999 and 10,001 credits are refused under the field.
  4. Failed and cancelled endings appear.
  5. No request leaves the machine.
- Not verified until T-407: Razorpay's real API, Checkout and webhooks.

## Stop conditions specific to M4

Stop and report instead of guessing when:

- a Razorpay fact cannot be found in the official documentation;
- the documentation contradicts D-016;
- a live key appears outside production;
- any step would call Razorpay without the owner's approval for that run.

## Report (parent CLAUDE.md §10)

At the end of the milestone, the report covers the seven points of the template in [README.md](README.md):

1. what was implemented;
2. why it was necessary;
3. what was verified;
4. which tests were executed;
5. what remains unverified;
6. known risks or limitations;
7. the next justified action.

Each is given an honest status. Then ask whether to refresh the tracker dashboard.

### M4 report, 2026-11-17

1. **Implemented.** Payments backend (T-402 to T-406): orders with a server quote and a 2%
   payment fee the customer pays (D-059, D-060), verify on our stored order id with a server-side
   fetch, a raw-body signed webhook deduped on the event id, reconciliation every 5 minutes, one
   crediting routine under a row lock, migration 0006. Frontend (T-410 to T-412): Buy credits from
   1,000 to 10,000 with price, fee and total from the server, the four after-payment endings, and
   "Add credits" from a short review that returns to the same video (D-061).
2. **Why.** R-02, R-03: customers must be able to buy credits, and each payment must credit
   exactly once whatever order the browser, webhook and reconciliation arrive in.
3. **Verified (MOCK-VERIFIED).** Browser run in mock mode at 1440 and 1024 px, 30 of 30 checks
   (`scratchpad/browser/m4.mjs`): ₹1,020 for 1,000 credits; purchase +1,000 in the ledger, fee
   not credited; 999 and 10,001 refused by the dialog and the server; failed and cancelled credit
   nothing; short video → Add credits → pay → Back to your video → Approve enabled → video
   delivered, charged 10 + price; an unsafe return address ignored; no request left the machine.
4. **Tests.** Backend `./check.sh` 532 passed (five purchase cases, five race tests, signatures,
   fee rounding, limits, access matrix). Frontend `npm run check` 409 passed.
5. **Unverified.** Anything against Razorpay itself: Checkout, the webhook signature's hex
   encoding, whether the order-payments list includes captured payments. These need T-407, a
   test-mode run the owner approves.
6. **Risks and limits.** The mock gateway forgets orders on restart (mock only). Reconciliation
   takes the 200 oldest due orders per run. Changing ₹1 = 1 credit needs a migration. The
   Razorpay fee rate itself was not verified on Razorpay's pricing page (owner to check).
7. **Next.** T-407 when the owner approves a test-mode run through a tunnel. M5 phase 1 starts now.

**Status: M4 MOCK-VERIFIED.** Live payments: BLOCKED on the owner's approval for T-407.
