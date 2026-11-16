# Frontend — Talking Avatar Platform

The parent [CLAUDE.md](../CLAUDE.md) governs all work here. This file adds frontend specifics and
never overrides it. If the two disagree, the parent file wins; fix this file.

## How the parent file applies here

| Parent section | What it means for frontend work |
| --- | --- |
| §2 Think → Validate → Decide → Execute → Verify | Follow it for every task in [docs/MILESTONES.md](../docs/MILESTONES.md). Material choices go in [docs/DECISIONS.md](../docs/DECISIONS.md) with all five parts |
| §3 Discovery | A screen that needs behaviour the design does not define is a new requirement: record it in [docs/tracker/requirements.json](../docs/tracker/requirements.json), do not invent it |
| §4 Evidence | Never write a library call or a Razorpay Checkout option from memory. Check the installed package or the official documentation and record the date |
| §6 Gates | Gate B applies before wiring a screen to the backend: the route must exist in the OpenAPI contract |
| §7 Delegation | Each task names its owner model. Use the brief template in [docs/README.md](../docs/README.md) |
| §8 Stop conditions | Stop and report when the contract and the backend disagree, a change would trigger a paid call, or two fixes have failed without new evidence |
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
- Change only your lane's files. If you need a change in `src/routes.tsx`, `src/api/` or `package.json`, hand it to the FE-Shell
  lane; do not edit those yourself.
- Work in your own git worktree and branch. Fable merges one branch at a time.
- Do not edit `docs/tracker/` from a parallel task; report your status and evidence, and the
  integrator records it at merge.
- If the task cannot be done without touching another lane's files, stop and report.

## Cost and test rule (owner, 2026-11-17; decision D-021)

- **Allowed without asking:** component tests against a mocked API, lint, type check, build.
- **Needs the owner's approval for that run:** anything that makes the backend call fal.ai, and
  any Razorpay Checkout session, including test mode.
- When trying the app, the backend must be in mock mode: the header shows a "Mock mode" badge. If
  the badge is missing, stop; you are connected to the paid provider.

## Stack

Today: React 19, Vite 8, TypeScript 7, oxlint, plain CSS. One page, no router, no tests.
Target (from M1): React Router, TanStack Query, API types generated from the backend's OpenAPI
document. See D-011.

Do not add a dependency without an entry in the decision log.

## Commands

```bash
npm run dev      # http://localhost:5173, proxies /api to the backend on :8000
npm run build    # type check + production build
npm run lint
```

## Layout

Today: `src/App.tsx` (everything), `src/api.ts` (fetch wrapper and types), `src/index.css`.

Target (from M1):

```text
src/
  api/          generated types + one fetch client
  features/
    auth/  create/  scripts/  videos/  wallet/  account/  admin/  home/
  components/   shared, presentational only
  routes.tsx    route table and guards
  styles/       tokens.css + base.css
```

A feature folder owns its screens, hooks and tests. Features do not import from each other; shared
code moves to `components/` or `api/`.

## Screens

| Route | Screen | Milestone |
| --- | --- | --- |
| `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` | Auth | M2 |
| `/` | Home: balance, create, in progress, recent | M5 |
| `/create`, `/create/:jobId` | Photo → script → banners → consent → listen and price → generating → joining → result | M1 (ported), M3 (price), M5 (script picker, banners, consent) |
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
4. **Banners:** start and end are chosen separately, each with "None". Show each template's name
   and a preview that plays on demand, muted by default, never automatically with sound.
5. Templates come from `GET /templates`. Never hard-code a template list or bundle clips in the
   app.
6. Show the banner choice on the review screen beside the price, and say that banners are free.
7. Show `video_assembling` as its own step ("Adding your banners"), and keep polling through it.
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
   code `insufficient_credits`), with a route to buy more that returns to the same job.
6. **Display credits as whole numbers and rupees with `Intl.NumberFormat('en-IN')`.**

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
- Errors arrive as `{detail, code}`. Show `detail`; branch on `code`, never on the message text.
- Server data lives in TanStack Query. Use local state only for form input and interface state.
- Poll a job only while its status is `audio_generating`, `video_submitting`, `video_generating`
  or `video_assembling`. Stop on any other status.

## Interface standards

- Every screen has a loading state, an empty state and an error state that says what to do next.
- Works at 360 px wide and on desktop. No horizontal scrolling.
- Keyboard reachable, visible focus, labels on every input, errors announced with `role="alert"`.
- Colours, spacing and type sizes come from `styles/tokens.css`. No one-off values in components.
- Words a customer reads are plain and specific: "Not enough credits. You need 40 more." not
  "Insufficient balance error".

## Tests

- Write the test with the screen: what it shows for loading, success, empty and each error code.
- Each test names the requirement it covers (for example `R-43`) in its title.
- Tests use a mocked API. They never reach a real backend, fal.ai or Razorpay.

## When you finish a task

1. Set its `status`, `verification` and `evidence` in
   [docs/tracker/tasks.json](../docs/tracker/tasks.json). `verification` is one of the parent
   file's five statuses, stated honestly. When working in parallel, report these instead and the
   integrator records them at merge.
2. If you made or changed a decision, add it to DECISIONS.md and
   [docs/tracker/decisions.json](../docs/tracker/decisions.json).
3. Report with the template in docs/README.md, including what was not run.
4. Ask the owner whether to refresh the dashboard from the tracker files.
