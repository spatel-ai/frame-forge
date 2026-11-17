# Razorpay fact sheet (T-401), checked 2026-11-17

Method: official pages at razorpay.com/docs fetched through a page-to-markdown tool (summarised by a small model, so quotes are as relayed; re-read the linked page before relying on a nuance). No Razorpay API called. Live-behaviour is NOT verified by any of this.

## Contradictions with HLD rules 1-5

None found. All five rules are supported (details in J). Two precision points to add to the HLD, not contradictions:
- Rule 4: docs say only event id uniqueness per event and at-least-once delivery; retries last 24 h then the webhook is auto-disabled (G).
- Rule 3/webhook-secret: webhook secret is separate from the API key secret (Not verified explicitly on the pages fetched; the HLD already says "webhook secret").

## A. Create order  (https://razorpay.com/docs/api/orders/create/)
- `POST https://api.razorpay.com/v1/orders`, Basic auth key_id:key_secret.
- Body: `amount` integer, required, smallest sub-unit; minimum INR 1.00 = `100`. `currency` string, required, ISO 3-char. `receipt` string, optional, "maximum length of 40 characters and has to be unique". `notes` JSON object, optional, "Maximum 15 key-value pairs, 256 characters (maximum) each". `cod_fee` integer, optional (COD, INR only; not relevant).
- `partial_payment`: appears in a Go code sample but is NOT listed as a parameter. Not verified - not found in official docs (as a documented parameter on this page). Do not send it.
- `payment_capture`: not on this page. See D.
- Response: `id`, `entity` ("order"), `amount`, `amount_paid`, `amount_due`, `currency`, `receipt`, `status`, `attempts` (successful + failed attempts), `notes`, `created_at` (unix), `offer_id`.
- `status` values: `created` (until a payment is attempted), `attempted` (until one payment is captured), `paid` (after capture; no further payments permitted).
- HTTP success codes on the API overview: 201 Created / 202 Accepted listed; 200 not described (https://razorpay.com/docs/api/understand/). Accept any 2xx.

## B. Fetch order / order payments
- `GET https://api.razorpay.com/v1/orders/{id}` (https://razorpay.com/docs/api/orders/fetch-with-id/). Fields as in A plus `checkout`, `description`, `offers`. Order stays `paid` even if the payment is later refunded.
- `GET https://api.razorpay.com/v1/orders/{id}/payments` (https://razorpay.com/docs/api/orders/fetch-payments/). Response `{entity:"collection", count, items:[payment...]}`. Page says it returns "all authorised or failed payments for that order" (wording does not mention captured explicitly; verify against a test-mode order before relying on captured payments appearing: Not verified).
- Payment `status` values: `created`, `authorized`, `captured`, `refunded`, `failed`. Item fields include `id, amount, currency, status, order_id, captured, amount_captured, amount_refunded, refund_status, method, error_code, error_description, error_source, error_step, error_reason, notes, created_at`.

## C. Fetch payment  (https://razorpay.com/docs/api/payments/fetch-with-id/)
- `GET https://api.razorpay.com/v1/payments/{id}`, Basic auth.
- Fields: `id, entity, amount, currency, status, captured, method, order_id, invoice_id, customer_id, amount_refunded, refund_status, email, contact, fee, tax, error_code, error_description, error_source, error_step, error_reason, notes, created_at, amount_captured, acquirer_data, upi/card objects` etc.
- Status: created, authorized, captured, refunded, failed.
- Note: `captured` boolean; `amount_captured` also exists (use `status=="captured"` and amount equality).

## D. Auto-capture  (https://razorpay.com/docs/payments/payments/capture-settings/)
- "By default, once your customer completes a payment, it is automatically moved to the `captured` state."
- Dashboard default: "Auto-capture all payments": payments `authorized` within 3 days of creation are auto-captured. Auto/manual capture timeout min 12 minutes, max (default) 3 days.
- "Capture values passed in the Orders API take precedence over the Payment Capture settings configured on the Dashboard." The `payment_capture` parameter itself is NOT defined on this page: Not verified - not found in official docs (on pages fetched). Recommendation: omit it and keep the Dashboard on auto-capture; confirm in the Dashboard.
- Authorized but not captured within 3 days: refunded automatically (refund takes 5-7 working days).

## E. Standard Checkout web  (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/)
- Script: `https://checkout.razorpay.com/v1/checkout.js`; `new Razorpay(options)`, `rzp.open()`.
- Mandatory options: `key`, `amount` (sub-unit; example "50000"), `currency`, `order_id`, `name`. Others: `handler(response)`, `callback_url` (redirect flow; bypasses the handler so no client-side confirmation), `prefill {name,email,contact}` (contact `+{country code}{number}`), `theme {color}`, `modal.ondismiss`.
- Handler response: `razorpay_payment_id` (success only), `razorpay_order_id`, `razorpay_signature`.
- Failure: `rzp.on('payment.failed', function(response){...})`; `response.error` has `code, description, source, step, reason, metadata.order_id, metadata.payment_id`.
- Note: handler is not the proof; server verification is.

## F. Signature verification  (same page)
- `generated_signature = hmac_sha256(order_id + "|" + razorpay_payment_id, secret)`, hex digest; compare to `razorpay_signature`. Docs: use the `order_id` from your server, not the `razorpay_order_id` Checkout returns. Secret = API key secret.

## G. Webhooks
Sources: https://razorpay.com/docs/webhooks/validate-test/ , https://razorpay.com/docs/webhooks/best-practices/ , https://razorpay.com/docs/webhooks/payments/ , https://razorpay.com/docs/webhooks/payloads/payments/ , https://razorpay.com/docs/webhooks/payloads/orders/
- Signature header `X-Razorpay-Signature`; "HMAC with SHA256", webhook secret as key, request body as message; "Do not parse or cast the webhook request body." (hex output is not stated in the summary: Not verified - confirm digest encoding, expected hex.)
- Event id header `x-razorpay-event-id`, "unique per event".
- Ack: any 2xx = success; non-2xx = failed delivery. Timeout: 5 seconds (no response in 5 s = timed out and resent).
- Retry: exponential backoff for 24 hours after event creation; exact intervals not published (Not verified). If failing for 24 h the webhook is disabled and must be re-enabled in the Dashboard; alert email sent.
- Delivery: at-least-once, duplicates "expected behaviour"; dedupe on event id. Ordering: not guaranteed (usual order payment.authorized then payment.captured, "may not be followed at all times"; "The webhook sequence is not fixed in the JSON payload for payment events").
- Webhook URLs: ports 80/443 only; Razorpay IPs may need whitelisting.
- If the webhook secret is changed, use the old secret to validate retried older events.
- Payload paths (payment.authorized / payment.failed / payment.captured): `event`, `payload.payment.entity.id`, `.order_id`, `.amount`, `.status` (authorized/failed/captured), `.captured` (bool), top-level `created_at`, `account_id`, `contains`. Docs sample oddity: card samples for authorized/failed show `captured: true`, so trust `status`, not `captured`.
- `order.paid`: `payload.order.entity.{id, amount, amount_paid, amount_due, currency, receipt, status, attempts, notes}` and `payload.payment.entity.{id, order_id, amount, status, captured, ...}`.
- Docs line on payments page: payment.failed is "not sent when a payment fails during the initial authorisation attempt" (as relayed; meaning unclear: do not depend on payment.failed arriving).

## H. Test vs live
- Key id prefixes `rzp_test_` / `rzp_live_`: Not verified - not found in official docs (pages fetched: authentication, api-keys, test-mode). Docs only say separate Test and Live keys exist; secret not shown again after generation.
- Test mode moves no real money: "No real money is deducted due to the usage of test API keys." (https://razorpay.com/docs/payments/payments/test-card-details/). Test cards fail in live mode. Live keys need verified website details.
- Test cards (any CVV, any future expiry): Visa India 4100 2800 0000 1007; Mastercard India 5555 5100 0008 1006; Intl Mastercard 5555 5555 5555 4444; Intl Visa 4012 8888 8888 1881. Mock bank OTP: random 4-10 digits = success; fewer than 4 digits = failure.
- Test UPI (https://razorpay.com/docs/payments/payments/test-upi-details/): `success@razorpay`, `failure@razorpay`. In test mode cancelling still completes successfully.

## I. Rate limits and errors
- Rate limit: HTTP 429; no numeric limit published in pages checked: Not verified - not found in official docs. Use exponential backoff with jitter (https://razorpay.com/docs/api/understand/).
- Statuses: 400, 401, 404, 429, 500, 502, 503, 504.
- Error body (https://razorpay.com/docs/errors/): `{"error": {"code", "description", "field", "source", "step", "reason", "metadata": {payment_id, order_id}}}`. `code` shown: BAD_REQUEST_ERROR; full code list not on the page (GATEWAY_ERROR/SERVER_ERROR: Not verified).

## J. Rules 1-5 check
1. Paise, INR: supported (A, E: "50000 for ₹500.00"; min 100). Currency is a parameter, INR chosen by us.
2. Checkout signature formula: supported exactly (F).
3. Webhook raw-body HMAC-SHA256 with `X-Razorpay-Signature`: supported (G).
4. `x-razorpay-event-id`, repeats, out-of-order: supported (G).
5. failed then captured: supported verbatim, UPI retries named (G).
Extra caution: order status `attempted` can persist after a failed attempt, and an order is `paid` only after capture.
