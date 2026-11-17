# Browser layout checks (M3.5, T-351, R-88)

Unit tests run in jsdom, which has no layout. This Playwright suite opens every customer screen and
dialog at every width of the device matrix, in Chromium and WebKit, measures the layout in the real
browser, and saves a screenshot of each. It is the measuring stick for every M3.5 task.

Mock mode only. The suite never calls fal.ai, Razorpay or a real mail server. It never starts a server
itself, so several worktrees can each run their own dev server and share one backend.

## What is checked (per screen, width and engine; each check is reported on its own)

| Check | Rule |
| --- | --- |
| `no-sideways-scroll` | `scrollWidth <= clientWidth`, and no element's right edge past the viewport (elements clipped by a scrolling or hidden-overflow parent are not counted; the deepest overflowing elements are named) |
| `tap-targets` | every standalone control (button, link, input, select, textarea, summary, role=button/tab/menuitem; a checkbox, radio or file input counts as its label) is at least 44 px tall. A link inside a sentence of running text is excluded |
| `input-font-size` | below 768 px wide: every text input, textarea and select has a computed font-size of at least 16 px |
| `bottom-bar-clear` | below 768 px wide: after scrolling every scroll box to its end, the last control is not under a fixed bar at the bottom of the screen and is inside the viewport (and nothing else sits on top of it) |
| screenshot | full page, `e2e/results/screenshots/<screen>/<engine>/<width>.png` |

Each fault names the element (selector, visible text, measured size). Dialogs are checked inside the open
dialog. The screenshots are `fullPage`: if the app scrolls inside a box instead of the page, the shot
shows the viewport height only. In the shots, fixed bars (the bottom bar, the sidebar) appear once, at
the viewport position, not at the bottom of the page: that is how Playwright stitches a full page.

## One-time setup

```bash
cd frontend && npm install
npx playwright install chromium webkit      # Playwright 1.65.1
docker compose up -d db                     # the local Postgres (container avatar-db-1), from the repo root
```

## Start the e2e servers

1. Dev server, on its own port, pointing at the e2e backend (port 8010; never 5173 or 8000):

   ```bash
   cd frontend
   API_TARGET=http://127.0.0.1:8010 npx vite --host 127.0.0.1 --port 5171 --strictPort
   ```

2. The e2e backend, its own database `frameforge_e2e` in the same Postgres container. This creates the
   database, migrates it, starts the backend (mock provider, mock payments, development mode, a 12-second
   voice limit) and seeds the account. It does not read `backend/.env`; every setting is on the command
   line. The database credentials are the local ones written in `docker-compose.yml`.

   ```bash
   cd frontend
   npm run e2e:backend -- up        # about 20 s the first time; safe to run again
   npm run e2e:backend -- status
   npm run e2e:backend -- down      # stop it
   npm run e2e:backend -- reset     # drop the e2e database; the next `up` seeds from scratch
   ```

   Variables (all optional): `E2E_BASE_URL` (default `http://127.0.0.1:5171`), `E2E_BACKEND_PORT` (8010),
   `E2E_DB_CONTAINER` (`avatar-db-1`), `E2E_DB_NAME` (`frameforge_e2e`), `E2E_DATABASE_URL`.
   The backend allows origins on ports 5171 to 5179. From another worktree, point the suite at this worktree's
   backend log (it is where the reset link is read from) and its address:
   `E2E_BACKEND_LOG=<path to the e2e worktree>/frontend/e2e/.state/backend.log E2E_BASE_URL=http://127.0.0.1:5172 npm run e2e`
   (and start your dev server with `API_TARGET=http://127.0.0.1:8010`). Without the log the
   `reset-password-form` screen is skipped, with the reason in the summary.

### What the seed makes (through the app's own API and the developer grant command)

One confirmed account (`e2e-layout@example.com`) with 4,000 credits granted in three grants (several ledger
rows, plus voice, hold and capture rows from the videos); four saved scripts (one of 800 characters that
starts with a very long unbroken word; Hindi and Punjabi too); three banners (one with a 60-character name);
videos in each state: finished (2), failed (the voice ran past the 12-second limit; and one lost when the
backend restarted), review (voice ready, not approved) and in progress.

How the states are reached without a backend change: the backend first runs with a 1 second poller, which
finishes the two videos; it is then restarted with a poll interval of one day, and the in-progress video is
approved, so it stays in progress. (A restart also fails any video that was in flight, because the mock
provider keeps its requests in memory.) The sign-up link is read from the backend log (development emails
go to the log, never out of the machine).

## Run

```bash
cd frontend
npm run e2e                                          # the whole matrix (all screens, 13 widths, 2 engines)
E2E_SCREENS=wallet npm run e2e                       # one screen (ids: e2e/config/screens.ts); comma list allowed
npm run e2e -- --project=webkit-390                  # one width and engine (<engine>-<width>, ids: e2e/config/matrix.ts)
E2E_SCREENS=wallet,wallet-buy-dialog npm run e2e -- --project=chromium-390 --project=webkit-390
npm run e2e -- --grep "@g-dialog"                    # by group tag: @g-auth @g-app @g-create @g-dialog
npm run e2e -- --grep "@s-wallet\b"                   # by screen tag (@s-<screen id>; note @s-wallet also prefixes @s-wallet-buy-dialog, so prefer E2E_SCREENS)
E2E_BASE_URL=http://127.0.0.1:5172 npm run e2e       # another worktree's dev server
E2E_WORKERS=2 npm run e2e                            # default 3 parallel browsers
```

Project names: `chromium-320`, `webkit-1920`, `chromium-667x375`, `webkit-1180x820`, and so on.

## Results

Written to `e2e/results/` (git-ignored): `summary.md` (counts per screen and check, per width, top offenders),
`results.json` (every offender of every run), `screenshots/`. The run's exit code is non-zero while any
check fails. `e2e/baseline/summary.md` is the committed summary of the run made before any M3.5 fix.

## The mock-mode guard

Before anything else, the global setup reads `/api/v1/config` through the site address and aborts the
whole run, with a message, unless `provider` and `payments` are both `mock`; it then confirms the "Mock
mode" pill is on screen for the logged-in account, and every logged-in test checks the pill again. If the
site is unreachable, the run aborts too.

## Screens and the states they use

See `config/screens.ts`. Notes on what is not exactly the screen a customer reaches:

- `forgot-password-sent` is opened on the forgot-password form and moved to the sent page with the router
  state that the form's own navigation sets (submitting would send a reset email per run and hit the
  3-an-hour limit). No network response is faked.
- `reset-password-form` uses a real reset link read from the backend log (the setup requests one; reused
  for 20 minutes). It is skipped, with a reason in the summary, if the log cannot be read.
- `verify-email-expired` is the no-token state. The "confirmed" state needs a single-use token and is not
  covered. The "checking" state is momentary and not covered.
- `create-banner-picker` is today a section of the review screen, not a dialog. It is kept as its own entry
  so a later task that makes it a dialog can change it.
- The logged-in state sets the session cookie as not-Secure: the real cookie is Secure, which a browser
  will not keep over plain http in WebKit. The backend only looks at the cookie's value.

## Limits

- Playwright's WebKit is the Safari engine, not a real iPhone: no notch spacing, address-bar hiding, focus
  zoom or on-screen keyboard. Real devices are T-364.
- Viewports are not mobile-emulated (`isMobile` off) so that a too-wide page shows as sideways scroll
  instead of being zoomed out. Animations are reduced.
- Check 3 and 4 apply below 768 px only; the sideways-phone widths 667x375 and 844x390 are below 768 wide.
  844x390 is therefore treated as a phone width by these checks and 1024+ as desktop.
