# High-Level Design — Frameforge

Status: **target design**, revised 2026-11-17. Owner-approved parts are recorded as Confirmed
decisions in DECISIONS.md; the rest is Proposed. Nothing in this document is built unless the
section "What exists today" says so.

Related documents: [DECISIONS.md](DECISIONS.md) (why each choice was made),
[MILESTONES.md](MILESTONES.md) (build order, gates and acceptance criteria),
[tracker/](tracker/) (current status of every task, question and requirement).

Governing rules: the parent [CLAUDE.md](../CLAUDE.md). Where this design and that file disagree,
that file wins and this design is corrected.

## 1. What we are building

A customer signs up, logs in, buys credits through Razorpay (₹1 = 1 credit), and spends those
credits to generate talking-avatar videos. They paste a script or pick one they used before,
optionally switch on banners and choose a start banner and an end banner (D-058), listen to the
voice, approve it, and receive one video file: start banner (if any), AI-generated video, end
banner (if any). Videos are up to 60 seconds (D-056).

The videos are produced by fal.ai models, paid for from the company's own fal.ai balance. The
customer never deals with fal.ai; they only see their credit wallet.

**Scope note.** The parent CLAUDE.md calls the project a "POC". On 2026-11-17 the owner asked for
a paid, multi-user platform (requirement R-42). This design follows that wider scope and the
parent file's rule of minimal sufficient complexity: nothing here is added for scale we do not
have.

Two money systems are involved and they must not be confused:

| | Customer wallet | Company fal.ai balance |
| --- | --- | --- |
| Currency | Credits (₹1 = 1 credit) | US dollars |
| Who tops it up | The customer, through Razorpay | The company, on fal.ai's billing page |
| Where the record lives | Our database (the ledger) | fal.ai's account |
| Who is charged per video | The customer, at our price | The company, at fal.ai's price |

The difference between the two is the margin. The customer pays 20 credits per second of video
and 10 credits per voice (D-006, D-038).

## 2. What exists today

Status on 2026-11-17: milestones M1, M1.5 and M2 are built, and M3 is built except its browser
check (see [tracker/](tracker/) for each task's evidence). Everything below is **MOCK-VERIFIED**:
`backend/check.sh` (388 tests, PostgreSQL in Docker, mock provider) and `npm run check` (352
tests, mocked API). No fal.ai or Razorpay call has been made in this work, so nothing live is
verified.

- **Backend** (`backend/`): FastAPI on Python 3.13+, `uv`, PostgreSQL 17 with Alembic migrations
  0001–0005. Packages: `core` (settings, database, errors, logging, origin check, health),
  `auth` (accounts, sessions, email links, rate limits), `jobs` (the lifecycle, now owned by a
  user and charged in credits), `wallet` (the ledger, wallet routes, the development-only grant
  command), `payments` (M4 contract only: routes answer 501), and `providers.py` (mock and fal).
  A job moves through `audio_generating → audio_ready → video_submitting → video_generating →
  completed`, or to `failed`; every move is a compare-and-set, committed together with its ledger
  entry (§5.2).
- **Providers**: `mock` (free, offline) and `fal` (paid). Voice: MiniMax, Kokoro, or Gemini TTS for
  Punjabi. Video: `fal-ai/kling-video/ai-avatar/v2/standard`.
- **ffmpeg**: used today only by the mock provider (to make a still-image video) and by `ffprobe`
  to measure audio length. Required from M5 (D-019).
- **Frontend** (`frontend/`): React 19, Vite 8, TypeScript 7, React Router, TanStack Query.
  Screens: sign-up, log-in, confirm-email, forgot and reset password, the create flow with prices
  and the not-enough-credits state, wallet, account. A component library with tests.
- **Not present yet**: buying credits (M4), scripts library, banners, video history, consent,
  admin, deployment, CI.

The job state machine and its tests are the valuable part of the POC. The design keeps them and
adds users, money, scripts and banners around them (decision D-001).

## 3. System overview

```mermaid
flowchart LR
    U[Customer browser<br/>React app] -->|HTTPS, session cookie| API[Backend API<br/>FastAPI]
    U -->|Checkout popup| RZP[Razorpay]
    RZP -->|Signed webhook| API
    API -->|Create order, fetch payment| RZP
    API --> DB[(PostgreSQL<br/>users, sessions, wallet ledger,<br/>payments, scripts, templates, jobs)]
    API --> FS[(Media storage<br/>photos, audio, AI video,<br/>banner clips, final video)]
    API -->|Voice + video requests,<br/>status polling| FAL[fal.ai]
    API -->|Join clips| FF[ffmpeg<br/>on the same server]
    ADM[Admin browser] -->|HTTPS, admin session| API
```

One backend process serves the API, runs the poller that collects finished videos, and joins the
banners (D-009). PostgreSQL replaces SQLite (D-002). Media stays on local disk during development
(D-010).

### Backend modules (target layout)

| Module | Responsibility |
| --- | --- |
| `auth` | Sign-up, login, sessions, email verification, password reset, the "current user" dependency |
| `wallet` | The ledger: credit, hold, capture, release, adjust. The only code allowed to change a balance |
| `payments` | Razorpay orders, signature verification, webhooks, reconciliation |
| `scripts` | Each customer's script library |
| `templates` | The company's banner clips: add, list, retire |
| `jobs` | The existing lifecycle, now owned by a user, priced in credits, with the joining step |
| `providers` | fal.ai and mock (unchanged interface) |
| `media` | Measuring and joining video with ffmpeg; no paid calls |
| `admin` | Read views and audited manual adjustments |
| `core` | Settings, database session, error shape, logging, the origin check, health. Rate limits live in `auth` |

### Customer app screens (target layout)

How these screens look and behave is defined in [UX.md](UX.md): the design system, navigation
(a left sidebar on desktop, a bottom bar on phones), and the standards for validation, loading,
feedback and live state. Designs for each screen are on the design canvas linked there.

| Area | Screens |
| --- | --- |
| Auth | Sign up, log in, verify email, forgot and reset password |
| Home | Balance, "create a video", videos in progress, recent videos |
| Create | Photo → script (paste or pick) or a saved voice → banners (an "Add banners" switch, off by default; D-058) → consent → listen and see the price → generating → joining (only when banners were added) → result |
| Scripts | "My scripts": list, reuse, delete |
| Videos | History list and a detail page |
| Wallet | Balance, buy credits (Razorpay Checkout), transaction history |
| Account | Profile, change password, log out everywhere |
| Admin | Users, payments, ledger, manual adjustment, templates (admins only; optional screens, see MILESTONES M6) |

## 4. Data model

All money columns are integers: credits as whole credits, rupee amounts in paise. No floats (D-014).

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | id, name, email (unique, stored lower-case), password_hash, email_verified_at, role (`user`/`admin`), status, created_at | Name from the sign-up design |
| `sessions` | id, user_id, token_hash, expires_at, revoked_at | Only the hash of the session token is stored |
| `email_tokens` | id, user_id, purpose (`verify`/`reset`), token_hash, expires_at, used_at | Single use |
| `wallets` | user_id, balance_credits, reserved_credits | `CHECK (reserved_credits >= 0 AND balance_credits >= reserved_credits)` |
| `ledger_entries` | id, user_id, kind, credits (balance change), reserved_delta, balance_after, reserved_after, ref_type, ref_id, created_by, created_at | Append-only. `UNIQUE (kind, ref_type, ref_id)`. Hold, capture and release use the reference `job_id#attempt` (D-039) |
| `payment_orders` | id, user_id, razorpay_order_id (unique), amount_paise, price_paise, fee_paise, fee_gst_paise, credits, status (`created`/`paid`/`failed`), razorpay_payment_id (unique), created_at, updated_at, paid_at | Database checks: price = credits × 100; amount = price + fee + GST on the fee (D-060); a paid order names its payment |
| `webhook_events` | event_id (primary key), event_type, payload, received_at, processed_at | Dedupes Razorpay deliveries |
| `scripts` | id, user_id, language, text, text_hash, created_at, last_used_at, deleted_at | One live row per `(user_id, language, text_hash)` |
| `templates` | id, name, kind (`start`/`end`), clip_file, preview_file, duration_ms, has_audio, active, created_by | Company-supplied. Retired, never deleted, so past jobs keep their reference |
| `jobs` | existing columns + user_id, price_credits, approve_attempt (D-039), needs_review (built); script_id, start_template_id, end_template_id, ai_video_file, banners_applied, assembly_attempts, consent_version, consent_at, voice_from_job_id (D-043) (M5) | `script` (the text) stays on the job as its own copy. A reused voice is copied to the new job (D-043) |
| `audit_log` | id, actor_user_id, action, target, detail, created_at | Admin actions and security events |

Available credits = `balance_credits − reserved_credits`.

### Ledger entry kinds

| Kind | Effect on balance | Effect on reserved | Written when |
| --- | --- | --- | --- |
| `purchase` | +N | — | A Razorpay payment is confirmed |
| `hold` | — | +N | The customer approves the audio |
| `capture` | −N | −N | The video is delivered |
| `release` | — | −N | The AI video fails, times out, or is refused |
| `adjustment` | ±N | — | An admin corrects a balance (audited, reason required) |
| `refund` | −N | — | A Razorpay payment is refunded |
| `grant` | +N | — | The developer-only command, development environment only (M3, T-306) |
| `voice_charge` | −N | — | The customer submits a job (D-038) |
| `voice_return` | +N | — | No voice reached the customer: it failed, came out empty, or its outcome is unknown (D-038, D-048) |

The uniqueness rule on `(kind, ref_type, ref_id)` means a payment can be credited once, a job's
voice charged once, and each approval attempt of a job (D-039) held, captured or released once,
even if the request, the webhook, or the poller runs twice.

## 5. Key flows

### 5.1 Buying credits

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as Backend
    participant R as Razorpay
    B->>A: POST /payments/orders {credits: 1000}
    A->>R: Create order (amount 102418 paise = ₹1,000 + ₹24.18 fee and GST, INR)
    A-->>B: our order id, Razorpay order id, public key id
    B->>R: Checkout popup, customer pays
    R-->>B: payment id, order id, signature
    B->>A: POST /payments/verify
    A->>A: Verify signature with OUR stored order id
    A->>R: Fetch payment: status captured? amount matches?
    A->>A: One transaction: mark order paid + ledger purchase +1000
    A-->>B: New balance
    R->>A: Webhook payment.captured / order.paid (signed)
    A->>A: Verify signature on raw body, dedupe by event id, same crediting step (no-op if done)
```

The customer buys 1,000 to 10,000 credits (D-059) and pays the credits' price plus a payment fee
grossed up so Razorpay's 2% + 18% GST leaves exactly the price: ₹1,024.18 for 1,000 credits, D-060, D-062), all computed by the server in paise; the order is created for that total
and only the credits bought are added to the wallet. A customer short of credits for a video can
top up from the review screen and return to the same video (D-061).

Rules, each traced to Razorpay's documentation (checked 2026-11-17):

- The amount is sent in paise. ₹500 is `50000`.
- The checkout signature is `HMAC-SHA256(order_id + "|" + payment_id, key_secret)`, computed with
  the order id **stored on our server**, not the one the browser sends back.
- The webhook signature is HMAC-SHA256 of the **raw** request body with the webhook secret, sent in
  `X-Razorpay-Signature`. The body must not be parsed before verification.
- Razorpay may deliver the same webhook more than once and out of order. Deliveries are deduped on
  the `x-razorpay-event-id` header.
- A `payment.failed` can be followed by a `payment.captured` for the same order (common with UPI),
  so a failed event never closes an order permanently.
- Credits are granted only when the payment status is `captured` and the amount equals the order
  amount. The browser's word is never enough.
- If the customer closes the tab before `/payments/verify` runs, the webhook still credits them. If
  the webhook is also missed, a reconciliation task asks Razorpay about orders still marked
  `created` or `failed` after 30 minutes (every 5 minutes, for up to 3 days; M4-PLAN).

### 5.2 Generating a video and charging for it

| Step | Job status change | Wallet action | One database transaction? |
| --- | --- | --- | --- |
| Customer submits photo, script and banner choice | → `audio_generating` | `voice_charge` 10 credits (D-038). Refuse with HTTP 402 if fewer than 10 available | Yes |
| Voice generation fails | → `failed` | `voice_return` the 10 credits | Yes |
| Voice call outcome unknown (unexpected error, or a restart while generating) | → `failed`, flagged for review | `voice_return` the 10 credits: no voice reached the customer (D-048) | Yes |
| Voice comes out empty (no measurable length) | → `failed` | `voice_return` the 10 credits | Yes |
| Voice longer than the limit | → `failed`; voice kept for reuse in a new job (D-043) | Voice charge kept (D-040) | Yes |
| Customer starts a job with a saved voice from a failed job (M5) | → `audio_ready` directly | None: no new voice is made (D-043) | Yes |
| Voice is ready | → `audio_ready` | Price fixed: `ceil(audio seconds × rate)`, shown to the customer | — |
| Customer approves | `audio_ready` → `video_submitting`, approval attempt + 1 | `hold` the price under `job#attempt` (D-039). Refuse with HTTP 402 if not enough credits | Yes |
| Upload to fal.ai fails, or fal.ai definitely refuses | → `audio_ready` | `release` | Yes |
| Submission outcome unknown (timeout, crash mid-call) | → `failed`, flagged for review | `capture` (owner's decision on Q-19, D-005) | Yes |
| fal.ai accepts | → `video_generating` | Hold stays | — |
| AI video downloaded, no banners chosen | → `completed` | `capture` | Yes |
| AI video downloaded, banners chosen | → `video_assembling` | Hold stays | — |
| Joining succeeds | → `completed` | `capture` | Yes |
| Joining fails after retries | → `completed` without banners, flagged for review | `capture` (the paid AI video is delivered; see Q-17) | Yes |
| AI video fails or times out | → `failed` | `release` | Yes |

The invariant: **a job's status change and its ledger entry commit together or not at all.**

Each voice generation costs 10 credits (D-038, replacing D-015); voices are never limited in
number. The video price is 20 credits per second of voice (D-006), fixed when the voice is ready
and held at approval. Outside production, a customer may approve at most 50 videos a day (D-046).

### 5.3 Script library

- On the Create screen the customer pastes a script or picks one from "My scripts".
- A pasted script is saved to the library when the job is created. If the same customer has
  already saved identical text in the same language, no new row is made; "last used" is updated.
- The job stores its own copy of the text. Deleting a saved script, or the library changing
  later, never alters a past video (D-017).
- The existing checks still apply to every script, saved or pasted: length limit, language, and
  the rule that refuses a script written in another language's alphabet.
- A customer sees only their own scripts.

### 5.4 Banners and joining

- A template is a short video clip, about 2 to 3 seconds, of kind `start` or `end`. The company
  supplies them (D-018). When a clip is added it is measured with `ffprobe`; anything that is not
  a playable video within the length limit is refused. The length limit is a setting.
- Banners are off by default. The customer switches on "Add banners" (D-058) and then chooses a
  start banner, an end banner or both, each with "None" and playable previews. With the switch
  off, the video has no banners and the progress screen has no "Adding your banners" step. The
  choice can change until the audio is approved.
- After the AI video is downloaded, the `video_assembling` step:
  1. measures the AI video's picture size, frame rate and sound format;
  2. converts each chosen clip to match, adding silence if the clip has no sound;
  3. joins start clip + AI video + end clip into one MP4.
- The AI video itself is kept as `ai_video_file`; the joined file is what the customer downloads.
- Joining calls no paid service. It is therefore **safe to retry**, unlike a fal.ai submission: a
  failed attempt is retried, and a job found in `video_assembling` after a restart is run again.
- Banner seconds add nothing to the price (D-020).

### 5.5 Forgotten password

The owner asked for this on 2026-11-17 (Q-22). It is built in M2 with the rest of login (T-203,
T-210); the screens are on the design canvas under "Password reset".

1. The customer enters their email on the forgot-password screen. `POST /auth/password/forgot`
   always answers the same way, whether or not an account exists, so the screen cannot be used
   to discover who has an account. It is rate-limited per email and per network address.
2. If an active account exists, the server creates a reset token: 32 random bytes, of which only
   a hash is stored in `email_tokens` (purpose `reset`), expiring in 30 minutes. Asking again
   cancels any earlier unused reset token. The email holds a link to `/reset-password` with the
   token. In development the email is printed to the server log instead of sent.
3. The reset page reads the token, removes it from the address bar, and sends no referrer, so
   the token does not linger in history or leak to another site.
4. `POST /auth/password/reset` with the token and the new password: if the token is known,
   unused and in date, the new password is checked by the same rules as sign-up, stored as an
   Argon2id hash, the token is marked used, every session of that user is revoked, an audit
   entry is written and a "your password was changed" email is sent. The customer then logs in.
5. An unknown, used or expired token gets error code `reset_link_invalid`, and the screen offers
   to send a new link. The response never says which of the three it was.

## 6. API surface (proposed)

All routes except `GET /healthz` sit under `/api/v1`. The existing `/api/...` routes move there in milestone M1.
Errors use one shape: `{"detail": "<message for the user>", "code": "<machine_code>"}`. An input
error may add `"fields": {"<field>": "<message>"}` so the message can be shown under the field it
belongs to (D-029).

Contract-first: each milestone from M2 starts with a task that writes that milestone's routes
into the OpenAPI document before backend or frontend work begins.

| Area | Routes |
| --- | --- |
| Auth | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `POST /auth/verify-email`, `POST /auth/verify-email/resend`, `POST /auth/password/forgot`, `POST /auth/password/reset/check`, `POST /auth/password/reset`, `POST /auth/password/change` (M2 contract in [M2-PLAN.md](M2-PLAN.md)) |
| Wallet | `GET /wallet`, `GET /wallet/transactions` |
| Payments | `GET /payments/quote?credits=N` (price, fee, total; D-060), `POST /payments/orders {credits}` (D-047), `GET /payments/orders/{id}`, `POST /payments/verify`, `POST /webhooks/razorpay`; development and mock mode only: `POST /payments/mock/complete` (D-042). Contract in [M4-PLAN.md](M4-PLAN.md) |
| Scripts | `GET /scripts`, `GET /scripts/{id}`, `DELETE /scripts/{id}` |
| Templates | `GET /templates`, `GET /templates/{id}/preview` |
| Jobs | `POST /jobs` (script text **or** script id; optional start and end template ids), `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/approve`, `GET /jobs/{id}/audio`, `GET /jobs/{id}/video` |
| Config | `GET /config` (provider, limits, languages, credits per second, voice price, payment mode, public Razorpay key id, purchase limits in credits) |
| Admin | `GET /admin/users`, `GET /admin/payments`, `GET /admin/ledger`, `POST /admin/wallets/{user_id}/adjust`, `POST /admin/templates`, `PATCH /admin/templates/{id}` |
| Ops | `GET /healthz` |

Frontend types are generated from the OpenAPI document (D-011), so the two cannot drift silently.

## 7. Security and privacy

| Concern | Design |
| --- | --- |
| Passwords | Argon2id hashes. Never logged |
| Sessions | Random opaque token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Hash stored server-side, so a session can be revoked |
| Cross-site requests | `SameSite` cookie plus an `Origin` check on every state-changing request |
| Access control | Every job, media file, script, wallet and payment query is filtered by the logged-in user. Another user's resource returns 404 |
| Brute force | Rate limits on login, sign-up, password reset and email resends (D-035). Voices are not limited (D-046); outside production, video approvals are capped at 50 a day |
| Uploads | Photos are re-encoded, as the POC does today. Banner clips come only from admins and are measured before being accepted |
| Scripts | Personal content: same access rule and retention policy as photos; never written to logs |
| Payments | No card data touches our servers; Razorpay Checkout handles it. Secrets only in environment variables |
| Webhooks | Signature verified on the raw body before anything else. Unsigned requests get 400 and are not stored |
| Likeness consent | A required checkbox on Create, before the voice is made (D-045); the consent text version and time are stored on the job (wording: Q-11) |
| AI disclosure | The interface labels every output as AI-generated |
| Audit | Admin actions, template changes, logins, password changes and balance adjustments go to `audit_log` |
| Secrets | `FAL_KEY`, Razorpay key secret, webhook secret, session secret: environment only, never committed, never sent to the browser |

## 8. Failure and recovery

| Failure | Behaviour |
| --- | --- |
| Backend restarts during video generation | Existing: the poller resumes by fal.ai request id |
| Backend restarts during a paid submission | The job fails, is never retried, is flagged, and the hold is captured (Q-19, D-005) |
| Backend restarts while the voice is being made | The job fails, is flagged, and the 10 credits are returned (D-048) |
| Backend restarts during joining | The joining step runs again; it costs nothing to repeat |
| Joining keeps failing | The customer gets the AI video without banners, is charged, and is told; the job is flagged |
| A chosen template is retired before the job finishes | The job still uses it; retiring only hides it from new choices |
| Customer pays but closes the tab | Webhook credits the wallet |
| Webhook never arrives | Reconciliation asks Razorpay about stale orders |
| Webhook arrives twice | Second delivery is a no-op (event id + ledger uniqueness) |
| Two approvals at the same instant | One wins the compare-and-set; the other gets 409. One hold |
| Two purchases or approvals racing on one wallet | The wallet row is locked for the transaction; the `CHECK` constraint is the last line of defence |
| fal.ai balance runs out | fal.ai refuses the request; the hold is released; the customer sees "temporarily unavailable" |

## 9. What this design does not include

Deferred (documented, not built now): self-service refunds, credit expiry, teams and
organisations, coupons, more languages, regenerating a voice or video inside the same job (a
saved voice is reused in a new job instead, D-043), cancelling a generation, customer-uploaded or customised banners, editing or sharing saved
scripts, a mobile app, running several backend instances, single sign-on.

Out of scope: converting credits back to money, payment gateways other than Razorpay.

## 10. Verification status of external facts

Where a row says "Not verified", the full statement from the parent CLAUDE.md applies:
*Not verified — requires documentation review, execution, or live integration testing.*

| Fact | Status |
| --- | --- |
| Razorpay order amount in paise; checkout returns payment id, order id, signature; signature formula | Checked against Razorpay documentation 2026-11-17. Not run |
| Razorpay webhook signature on raw body; event id header for dedupe; ordering not guaranteed | Checked against Razorpay documentation 2026-11-17. Not run |
| Razorpay webhook retry schedule and required response time | Checked 2026-11-17 ([RAZORPAY-FACTS.md](RAZORPAY-FACTS.md)): any 2xx within 5 seconds; retries for 24 hours. Exact intervals not verified |
| Video model price $0.0562 per second of output; inputs are image URL + audio URL | Checked on the fal.ai model page 2026-11-17 |
| Video model limits on audio length and image size | fal.ai states none. Kling's own API documentation (checked 2026-11-17, [FAL-VIDEO-FACTS.md](FAL-VIDEO-FACTS.md)): audio 2–300 s, photo ≥ 300 px, ratio 1:2.5 to 2.5:1, ≤ 10 MB. We use 60 s (D-056) and the photo rules (D-057). Not verified live |
| Video model output: picture size, frame rate, sound format | Not verified. The design measures each video instead of assuming |
| The model keeps the face consistent; output quality is acceptable | Not verified. Can only be judged from live output, against criteria the owner has yet to set (Q-18) |
| How fal.ai reports and bills failed generations | Not verified |
| fal.ai result links expire | Not verified. Not relied on: files are downloaded at once |
| fal.ai offers a balance or usage API | Not verified. Not found on the page checked |
| fal.ai queue webhooks exist, signed with ED25519 | Checked 2026-11-17; not used in this design (D-008) |
| MiniMax voice works live | Recorded in `backend/app/core/config.py` as run on 2026-11-16; not re-run by this review |
| The video model works live end to end | Not verified. The README says the fal.ai integration has not been run live |
| Joining real model output with banner clips works | Not verified |
| GST treatment of credit sales; whether a closed wallet needs registration | Not verified. Needs an accountant and a lawyer (Q-03, Q-12) |
