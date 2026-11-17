# Frameforge Web (frontend)

The parent [CLAUDE.md](../CLAUDE.md) governs all work here. This file adds frontend specifics and
never overrides it. If the two disagree, the parent file wins; fix this file.

## How the parent file applies here

| Parent section | What it means for frontend work |
| --- | --- |
| §2 Think → Validate → Decide → Execute → Verify | Follow it for every task in [docs/MILESTONES.md](../docs/MILESTONES.md). Material choices go in [docs/DECISIONS.md](../docs/DECISIONS.md) with all five parts |
| §3 Discovery | A screen that needs behaviour the design does not define is a new requirement: record it in [docs/tracker/requirements.json](../docs/tracker/requirements.json) with one of the five classes (Confirmed, Assumed, Needs Verification, Deferred, Out of Scope); do not invent it. Anything touching cost, privacy, security, consent or core behaviour becomes a question for the owner |
| §4 Evidence | Never write a library call or a Razorpay Checkout option from memory. Check the installed package or the official documentation and record the date. If evidence cannot be had, write: "Not verified — requires documentation review, execution, or live integration testing." |
| §5 Alignment | Before each phase, compare the work with the requirements, the designs and the contract; drop or simplify work that no longer adds value |
| §6 Gates | All four gates (A before starting, B before integrating, C before any paid or live run, D before calling it done) apply; the checklist is in MILESTONES.md. For Gate B the route must also exist in the OpenAPI contract. Never bypass a failed gate |
| §7 Delegation | Each task names its owner model; Haiku never gets an ambiguous design decision. Use the nine-part brief in [docs/README.md](../docs/README.md). Agents give evidence; Fable never approves on an agent's word alone |
| §8 Stop conditions | All nine conditions of parent §8 apply, with its six steps for recurring failures. In particular: the contract and the backend disagree, a change would trigger a paid call, a security issue is found, or two fixes have failed without new evidence |
| §9 Scope | Classify improvements as required (correctness, safety, acceptance), optional or future; build only the required ones without asking |
| §10 Reporting | Report with the seven points and the five statuses. The template is in docs/README.md |

## Read before changing anything

| Document | Read it for |
| --- | --- |
| [docs/HLD.md](../docs/HLD.md) | Screens, flows, API surface, security rules |
| [docs/DECISIONS.md](../docs/DECISIONS.md) | Why each choice was made (frontend stack is D-011) |
| [docs/MILESTONES.md](../docs/MILESTONES.md) | What to build next, who owns it, and its acceptance criteria |
| [docs/tracker/](../docs/tracker/) | Current status of tasks, questions, requirements |

Work only on tasks in the current milestone. A task marked **Optional** is not built unless the
owner asks.

## Working in parallel (decision D-022)

Several tasks may be in progress at once. The lanes, their files and each task's "starts after"
list are in [docs/MILESTONES.md](../docs/MILESTONES.md), section "Parallel plan".

- Start a task only when every task it starts after is Done and no other task is active in its lane.
- Change only your lane's files. If you need a change in `src/routes.tsx`, `src/api/`, `src/styles/` or `package.json`, hand it to the FE-Shell
  lane; do not edit those yourself.
- Work in your own git worktree and branch. Fable merges one branch at a time.
- Do not edit `docs/tracker/` from a parallel task; report your status and evidence, and the
  integrator records it at merge.
- If the task cannot be done without touching another lane's files, stop and report.

## Cost and test rule (owner, 2026-11-17; decision D-021)

- **Allowed without asking:** component tests against a mocked API, lint, type check, build.
- **Needs the owner's approval for that run (Gate C):** anything that makes the backend call
  fal.ai, and any Razorpay Checkout session, including test mode. Before asking, state what will
  run and the expected cost.
- A passing mocked test is `MOCK-VERIFIED`. Only an approved real run earns `VERIFIED`.
- When trying the app, the backend must be in mock mode: the header shows a "Mock mode" badge. If
  the badge is missing, stop; you are connected to the paid provider.

## Stack

React 19, Vite 8, TypeScript 7, React Router 8, TanStack Query 5, oxlint, Vitest with React Testing
Library and jsdom, plain CSS with tokens. API types are generated from the backend's OpenAPI
document (D-011).

Do not add a dependency without an entry in the decision log.

## Commands

```bash
npm run dev      # http://localhost:5173, proxies /api to the backend on :8000
npm run check    # lint + type check + tests (mocked API, free)
npm run build    # type check + production build
npm run gen:api  # regenerate src/api/openapi.json and src/api/schema.d.ts from the backend
```

Run `npm run gen:api` after any backend change to a route or response, and commit both files. The
generator runs through `npx` at a pinned version; it cannot be installed beside TypeScript 7 and
must not be added to `package.json`.

## Layout

```text
src/
  main.tsx      router and query client
  routes.tsx    route table
  api/          client.ts (the one fetch client), schema.d.ts and openapi.json (generated)
  components/   AppShell, NotFound, and feedback/ form/ icons/ layout/ shell/ (the component
                library; shell/ holds the sidebar, top bar and RequireAuth)
  features/
    auth/       log in, sign up, confirm email, forgot and reset password
    account/    account page
    create/     the create flow: form, review with price, progress, result, job queries
    wallet/     credits pill data, wallet page
  lib/          shared helpers used by several features (session, validation, job storage,
                wallet query and refresh, checkout loader)
  styles/       tokens.css + base.css
```

Later features add their own folder under `features/`: `scripts/ videos/ admin/ home/`. A feature
folder owns its screens, hooks and tests. Features do not import from each other; shared code
moves to `components/`, `lib/` or `api/`. `src/layering.test.ts` fails the build if a feature
imports another feature, or if `components/` or `lib/` imports a feature (T-158).

## Screens

| Route | Screen | Milestone |
| --- | --- | --- |
| `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/forgot-password/sent`, `/reset-password` | Auth | M2 |
| `/` | Home: balance, create, in progress, recent | M5 |
| `/create`, `/create/:jobId` | Photo → script or saved voice → banners (optional switch) → consent → listen and price → generating → joining (only with banners) → result | M1 (ported), M3 (price), M5 (script picker, banners, consent) |
| `/scripts` | My scripts: list, reuse, delete | M5 |
| `/videos`, `/videos/:jobId` | History and detail | M5 |
| `/wallet` | Balance, buy credits, transactions | M3, M4 |
| `/account` | Password, log out everywhere | M2 |
| `/admin/*` | Users, payments, ledger, adjust, templates | M6, optional |

## Rules for the script picker and the banner picker

1. **Script:** two clear choices on Create, "Paste a script" and "Choose from my scripts".
   Picking a saved script fills the text and language; the customer can still edit before
   submitting. The same character limit and counter apply either way.
2. Send a saved script's id when it is unchanged, the text when it is new or edited. The server
   decides whether it is a duplicate.
3. Deleting a script asks for confirmation and says past videos are not affected.
4. **Banners:** an "Add banners" switch, off by default (D-058). Only when it is on are the start
   and end lists shown, chosen separately, each with "None"; switching it off clears the choice. Show each template's name
   and a preview that plays on demand, muted by default, never automatically with sound.
5. Templates come from `GET /templates`. Never hard-code a template list or bundle clips in the
   app.
6. When banners were added, show the choice on the review screen beside the price, and say that
   banners are free. Without banners, show nothing about them.
7. Show `video_assembling` as its own step ("Adding your banners") only for a job with banners,
   and keep polling through it. A job without banners shows three steps.
8. When a completed job has `banners_applied: false` although banners were chosen, say so plainly:
   the video is delivered without banners. Do not present it as a normal success.

## Rules that protect money

1. **The server decides every amount.** The browser never calculates a price, a balance or the
   credits a payment is worth.
2. **A Razorpay success in the browser is not a payment.** After Checkout closes, call the verify
   route and show the balance the server returns. Until then show "confirming payment".
3. **Never show "credits added" from client state.** Refetch the wallet.
4. **Buttons that spend or pay are disabled while the request is in flight.**
5. **Show the price before approval** and the shortfall when credits are not enough (HTTP 402,
   code `insufficient_credits`), with an "Add credits" action that opens Buy credits and returns
   to the same job after the server confirms the payment (D-061). Accept only internal return
   addresses.
6. **Display credits as whole numbers and rupees with `Intl.NumberFormat('en-IN')`.**
7. **The payment fee comes from the server** (`GET /payments/quote`, D-060). Never compute a fee or
   a total in the browser.

## Rules that protect customers

1. No secret ever reaches the browser. Only the Razorpay **key id** (public) is used client-side;
   it comes from the API, not from a build-time variable.
2. No tokens in `localStorage` or `sessionStorage`. The session is an `HttpOnly` cookie the page
   cannot read; every request sends `credentials: 'same-origin'`.
3. Never use `dangerouslySetInnerHTML` with anything from a user or the API. Script text is shown
   as plain text.
4. On 401, clear cached server data and go to log in, remembering where the user was.
5. Hide admin screens from non-admins, but treat that as convenience only: the backend enforces it.
6. Every output is labelled AI-generated. The consent checkbox is never pre-ticked.

## Working with the API

- All calls go through the one client in `src/api/`. No `fetch` in components.
- Types are generated from OpenAPI. Do not hand-write a response type; if one is missing, the
  backend contract is missing it.
- Errors arrive as `{detail, code}`, plus `fields` for input errors. Show `detail`; branch on
  `code`, never on the message text.
- Server data lives in TanStack Query. Use local state only for form input and interface state.
- Poll a job only while its status is `audio_generating`, `video_submitting`, `video_generating`
  or `video_assembling` (that status arrives in M5). Stop on any other status.

## UX standards (decision D-029)

[docs/UX.md](../docs/UX.md) is the standard for every screen, and the
[design canvas](https://claude.ai/artifact/3UF9Uf2hTWHw1TGm3ZERjz) is the picture. Read both before
building or changing a screen. They are acceptance criteria, not suggestions.

- **Build from the design.** Do not invent a layout. If a screen or state has no design, stop and
  ask for one; do not improvise.
- **Only shared components and tokens.** No colour, size, spacing or radius written directly in a
  feature. If a component is missing, add it to the library, with tests, not to the feature.
- **Native controls.** `button`, `a`, `input` with `label`, `select`, `dialog`. Never a clickable
  `div`.
- **Every input:** visible label, hint for its limits, validation on leaving the field and live
  after a first error, message under the field with `role="alert"`, focus moved to the first error
  on submit, nothing the customer typed is lost on failure. Server `fields` errors are shown under
  the same fields.
- **Every wait:** skeletons on first load, a busy button for short actions, named progress steps
  for long ones. Never a blank screen.
- **Every list:** a designed empty state with the first action.
- **Every failure:** says what happened, what was not charged, and what to do next.
- **Live state:** follow the refetch table in UX.md section 7. Money shows only what the server
  returned.
- **Every device (D-069):** every screen and dialog works from 320 px to 1920 px wide, portrait and
  landscape, with no sideways scrolling. Write styles phone first, with `min-width` queries at
  768 px (tablet) and 1024 px (desktop). Controls are at least 44 px tall, input text at least
  16 px on phones, full-height layouts use `dvh`. The rules are in UX.md section 7 (Responsive).

A task is done only when it meets the nine points of UX.md section 8, including being seen in a
real browser at phone, tablet and desktop widths.

## Tests

- Write the test with the screen: what it shows for loading, success, empty and each error code.
- Each test names the requirement it covers (for example `R-43`) in its title.
- Tests use a mocked API. They never reach a real backend, fal.ai or Razorpay.

## When you finish a task

1. Set its `status`, `verification` and `evidence` in
   [docs/tracker/tasks.json](../docs/tracker/tasks.json). `verification` is one of the parent
   file's five statuses, stated honestly. When working in parallel, report these instead and the
   integrator records them at merge.
2. If you made or changed a decision, add it to [docs/DECISIONS.md](../docs/DECISIONS.md) and run
   `python3 docs/tracker/sync.py`, which rebuilds `decisions.json`. When working in parallel,
   report the decision instead; the integrator records it.
3. If you found a new requirement or unknown, add it to `requirements.json` or `questions.json`
   (or report it, when working in parallel).
4. Report with the template in docs/README.md, including what was not run.
5. Ask the owner whether to refresh the dashboard from the tracker files.
