# UX and Design — Frameforge Web

Status: **Confirmed**: the owner approved the designs and the brand on 2026-11-17 (T-152, D-028). Later boards are approved as they are added to the canvas.

This document is the standard every screen is built and reviewed against. The screen designs
themselves are on the design canvas:
[Frameforge App Designs](https://claude.ai/artifact/3UF9Uf2hTWHw1TGm3ZERjz).

Governing rules: the parent [CLAUDE.md](../CLAUDE.md). Related: [HLD.md](HLD.md),
[DECISIONS.md](DECISIONS.md) D-027 to D-030, [MILESTONES.md](MILESTONES.md) milestone M1.5.

## 1. Why this exists

The owner reviewed the app after M1 and found the interface poor (2026-11-17). M1 deliberately
kept the POC's single plain form; it was never designed. Before login, wallet and payment screens
are built on top of it, the product gets a design system, designed screens, and written standards
for validation, loading and feedback, so that every later screen is built to the same bar.

## 2. Discovery

### What the owner decided (Confirmed, 2026-11-17)

| Question | Answer |
| --- | --- |
| Design direction | Inspired by how Canva and similar creative tools are laid out, with our own identity. Not a copy of any product's branding |
| Brand | None exists; engineering proposes one |
| Scope of design | All planned customer screens, designed before they are built |
| Device priority | Desktop only for new screens (D-033). The phone layouts built in M1.5 stay |

### What comparable tools do

Read from public tutorials and reviews on 2026-11-17. These are third-party descriptions, some
written by competitors; the apps themselves sit behind a login and were not opened. Treat this as
**Assumed**, good enough to choose patterns, not a verified study.

| Pattern | Seen in | What we take from it |
| --- | --- | --- |
| A dashboard with one prominent "Create video" action | HeyGen tutorials | Home has one primary action; everything else is secondary |
| A structured, step-by-step flow: script, avatar, voice, layout, generate | Synthesia reviews | A stepper for Create, one decision per step |
| A dedicated script panel with a play button to hear the voice before rendering | HeyGen tutorials | Voice preview is its own step; the voice costs 10 credits when it is made (D-038), and the video is charged only after approval |
| Preview before spending credits; credits tied to video length | HeyGen tutorials | Price is shown beside the preview, before approval |
| Photo-first simplicity: upload a face, type a script, get a video | D-ID reviews | Our flow is this shape; we do not add a timeline editor |
| Template galleries shown as cards | Synthesia reviews | Banners and videos are card galleries with previews |
| Rendering takes minutes | HeyGen tutorials | A progress screen the customer can leave and return to |

Complaints in the same reviews: timeline and audio editing felt weak, and template systems felt
limiting. We avoid both by not offering a timeline at all.

Sources:
[HeyGen: how to create AI videos](https://www.heygen.com/article/how-to-create-ai-videos),
[HeyGen academy: create a new project](https://www.heygen.com/en-in/academy/ai-studio/how-to-create-a-new-project),
[Tavus: Synthesia review](https://www.tavus.io/blog/synthesia-review),
[eWeek: Synthesia review](https://www.eweek.com/artificial-intelligence/synthesia-review/),
[G2: D-ID vs Synthesia](https://www.g2.com/compare/d-id-vs-synthesia).

### Problems in the app as built in M1

Seen in the M1 browser run screenshots.

| Problem | Effect on the customer |
| --- | --- |
| One narrow column with no navigation | Nowhere to find past videos, scripts or the wallet |
| A bare browser file input | No drag and drop, no sign of what makes a good photo |
| Errors appear only after pressing the button | The customer learns of a mistake late |
| "Generating…" with a spinner and no steps | No sense of how far along a multi-minute wait is |
| Price shown in US dollars | The customer pays in credits |
| No empty, loading or error designs | Screens jump or go blank while data loads |
| No visual identity | The product looks unfinished |

### Classified register

| Class | Item |
| --- | --- |
| Confirmed | R-75 to R-81 in [tracker/requirements.json](tracker/requirements.json) |
| Assumed | Polling every 3 seconds is "real time" enough (D-030). Light theme only at launch |
| Needs Verification | None open: the brand (Q-20, R-82) and the price (Q-01: 20 credits per second, 10 per voice) are answered |
| Deferred | Dark theme. Animated illustrations. A drag-and-drop timeline editor. Languages other than English in the interface itself |
| Out of Scope | Copying any other product's logo, artwork or brand colours |

## 3. Principles

1. **One primary action per screen.** It is the only filled button in the brand colour.
2. **Show before charging.** The customer hears the voice and sees the price before any credits
   are held.
3. **Never leave the customer guessing.** Every wait shows what is happening and what comes next.
4. **Say it early.** Validate as the customer types or picks, not only on submit.
5. **Money is always visible and always the server's number.** The balance is in the top bar on
   every screen.
6. **Nothing is a dead end.** Every error says what to do next; every empty screen offers the
   first action.
7. **Plain words.** "Not enough credits. You need 40 more." not "Insufficient balance".

## 4. Design system

Name: **Frameforge** (owner decision D-031). The colours and typefaces were approved by the
owner with the designs on 2026-11-17 (D-028).
They live in one tokens file, so changing them later is a small edit.

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--color-primary` | `#4A3AFF` | Primary buttons, links, the active step, focus ring |
| `--color-primary-strong` | `#3626D9` | Primary hover and pressed |
| `--color-primary-soft` | `#EEECFF` | Selected cards, active navigation item |
| `--color-credit` | `#FFB020` | The credits coin and wallet highlights only |
| `--color-ink` | `#14182B` | Headings and body text |
| `--color-ink-soft` | `#4B5169` | Secondary text |
| `--color-ink-muted` | `#666C85` | Hints, captions (passes 4.5:1 on white) |
| `--color-surface` | `#FFFFFF` | Cards, inputs, the sidebar |
| `--color-page` | `#F4F5FA` | Page background |
| `--color-line` | `#DFE2EC` | Borders and dividers |
| `--color-success` | `#0B7A55` | Completed, payment confirmed |
| `--color-warning` | `#9A5B00` | Needs attention, low balance |
| `--color-danger` | `#C7322F` | Errors, destructive actions |
| `--color-success-soft`, `--color-warning-soft`, `--color-danger-soft` | `#E3F5EE`, `#FFF1D6`, `#FDE8E7` | Backgrounds for the matching pills and banners |

State is never shown by colour alone: every pill and banner also has an icon or a word.

### Type

| Role | Typeface | Size / weight |
| --- | --- | --- |
| Page title | Plus Jakarta Sans | 28 px / 700 |
| Section heading | Plus Jakarta Sans | 20 px / 700 |
| Card title, button | Inter | 15 px / 600 |
| Body | Inter | 15 px / 400, line height 1.5 |
| Caption, hint | Inter | 13 px / 400 |
| Numbers (balance, price) | Inter, tabular figures | as the surrounding text |

### Shape and space

- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. No other values.
- Corner radius: 8 px inputs and buttons, 12 px cards, 16 px dialogs, full for pills.
- Borders: 1 px `--color-line`. Shadows only on things that float: dialogs, menus, toasts.
- Touch and click targets at least 44 px tall.
- Icons: simple line icons, one weight. No emoji.

### Components

Built once in M1.5 (task T-153) and used by every screen:

Button (primary, secondary, quiet, danger; with a busy state), Text field, Text area with counter,
Select, Checkbox, File drop zone with preview, Card, Selectable card, Pill, Stepper, Dialog,
Toast, Banner, Skeleton, Spinner, Progress steps, Empty state, Error state, Credits pill,
Pagination.

## 5. Layout and navigation

Desktop (1024 px and wider):

- A fixed left **sidebar**: the wordmark, then Home, Create, Videos, Scripts, Wallet, and Account
  at the bottom. The current section is highlighted.
- A **top bar**: the page title on the left; on the right the credits pill, a "Buy credits"
  button, and the account menu.
- Content in a centred column, at most 1120 px wide.

Phone (below 768 px):

- The sidebar becomes a **bottom bar** with Home, Create, Videos, Wallet, and More.
- The top bar keeps the page title and the credits pill.
- Card grids become one column; side-by-side panels stack; dialogs become full-height sheets.

Between 768 and 1023 px the sidebar collapses to icons.

Logged-out screens (log in, sign up, reset password) have no sidebar. On desktop the screen is
split: a primary-colour brand panel on the left (wordmark, an illustration of a photo and script
becoming a video, three factual lines) and the form card on the right over soft decorative shapes.
On phones the brand panel becomes a header band that the form card overlaps. The illustration is
inline SVG in the design tokens' colours, hidden from screen readers, and carries no information
the form needs.

## 6. Screens

| Screen | Route | Primary action | Designed |
| --- | --- | --- | --- |
| Home | `/` | Create a video | Desktop (phone drawn, not built: D-033) |
| Create 1: photo, script and voice choice | `/create` | Continue | Desktop, phone (built in M1.5); voice choice (D-043) and script picker drawn for M5 |
| Create 2: banners | `/create` (no job exists until the voice is made, D-045) | Continue | Desktop |
| Create 2b: consent | `/create` | Make my voice (10 credits) | Desktop (D-045) |
| Create 3: review voice and price | `/create/:id` | Approve and generate video | Desktop |
| Create 4: progress | `/create/:id` | none (waiting) | Desktop |
| Create 5: result | `/create/:id` | Download | Desktop |
| Videos | `/videos` | Create a video | Desktop |
| Scripts | `/scripts` | Use this script | Desktop |
| Wallet | `/wallet` | Buy credits | Desktop (phone drawn, not built: D-033) |
| Buy credits, after-payment states | dialog on any screen | Pay | Desktop |
| Video detail | `/videos/:id` | Download | Desktop |
| Failure results, daily limit | `/create/:id` | Make a video with this voice / Start over | Desktop |
| Log in, Sign up | `/login`, `/signup` | Log in, Create account | Desktop (phone log in drawn, not built: D-033) |
| Forgot, reset, confirm email | `/forgot-password`, `/reset-password`, `/verify-email` | Send link, Save | Desktop |
| Account | `/account` | Save | Desktop |
| States and components | reference sheets | — | Desktop |

Admin screens are optional (MILESTONES M6) and use the same components without bespoke design.

## 7. Interaction standards

These are acceptance criteria. A screen that misses one is not done.

### Inputs and validation

| Rule | Detail |
| --- | --- |
| Label | Every input has a visible label above it. Placeholder text is never the label |
| Hint | Constraints are stated before the customer hits them ("JPEG, PNG or WebP, up to 10 MB") |
| When to validate | On leaving a field, and live once a field has shown an error. Never while the customer is still typing a first attempt |
| Counters | Text with a limit shows `used / limit`, turning to the danger colour when over |
| Where the message goes | Directly under the field, in words, with an icon. The field gets a danger border |
| On submit | Focus moves to the first field with an error. The button is not disabled for invalid input; it explains instead |
| Server errors | A field error from the server appears under that field, the same as a client one. Anything else appears in a banner above the form |
| Files | Checked for type and size the moment they are chosen, before any upload. A preview confirms the choice |
| Language mismatch | The script's alphabet is checked against the chosen language as the customer types |
| Never lose input | A failed submit keeps everything the customer entered |

The server remains the authority: every rule above is also enforced by the API. Client checks are
for speed and clarity only.

### Loading

| Situation | What the customer sees |
| --- | --- |
| A screen's first load | Skeletons in the shape of the content. Never a blank screen or a lone spinner |
| An action that takes under about a second | The button shows a spinner and its label changes ("Saving…"); it cannot be pressed twice |
| An action that takes longer | Progress steps naming what is happening now and what comes next |
| Refreshing data already on screen | The old data stays visible; a subtle indicator shows it is updating |
| A list with nothing in it | An empty state: one sentence and the first action |

### Feedback

| Event | Feedback |
| --- | --- |
| Something succeeded and the screen already shows it | Nothing extra |
| Something succeeded off-screen (script deleted, password changed) | A toast, 4 seconds, in the bottom-right on desktop and bottom on phone |
| Something failed and the customer can fix it | Inline, next to what needs fixing |
| Something failed and they cannot fix it | A banner with "Try again" and what was not charged |
| A destructive action | A confirmation dialog naming exactly what is removed and what is not |
| Lost connection | A banner: "Connection problem, retrying…" The screen keeps its last data |

### State that updates by itself (D-030)

The customer never has to refresh the page.

| What | How it stays current |
| --- | --- |
| A job in progress | Refetched every 3 seconds while in progress; the progress steps advance |
| The credits pill | Refetched after every action that can change it (submit, approve, video finished or failed, payment), and when the window regains focus |
| A payment being confirmed | Refetched every 2 seconds until the server confirms or fails it, for up to a minute, then a "still confirming" message with what to do |
| Lists (videos, scripts, transactions) | Refetched when the screen is opened and after an action that changes them |
| An item the customer just changed | Updated on screen at once, then confirmed by the server's answer. If the server refuses, the change is rolled back and explained |

Money is the exception to "update at once": a balance or a price is only ever what the server
returned.

### Money on screen

- Credits are whole numbers with thousands separators: `1,240 credits`.
- Rupees use `Intl.NumberFormat('en-IN')`: `₹1,240`.
- The price of a video is shown before approval, with the credits available now.
- When credits are short, the approve button is disabled and the server's shortfall message is
  shown ("This video costs 240 credits. You have 200."), with a "Buy credits" action that
  returns the customer to the same step (the action appears with M4).
- Buying is in credits (D-047): the customer chooses 500 to 10,000 credits and sees the rupees to
  pay (₹1 = 1 credit).
- Banners are always labelled "Free".

### Accessibility

- Everything works with a keyboard; focus is always visible (2 px ring in the primary colour).
- Text contrast at least 4.5:1; large text and icons at least 3:1.
- Errors are announced with `role="alert"`; progress with a polite live region.
- Dialogs trap focus, close on Escape, and return focus to what opened them.
- Motion is brief (150 to 200 ms) and removed when the system asks for reduced motion.
- No information is carried by colour alone.

### Responsive

- New screens (M2 on, D-033): designed and built at 1440 px, checked at 1440 px and 1024 px. No
  phone layout.
- The screens built in M1.5 (app frame, create flow, not-found) keep working from 360 px to 1920 px
  with no sideways scrolling; changes to them must not break that.

## 8. Definition of done for a screen

A frontend task is finished only when all of these are true:

1. It matches its design on the canvas at 1440 px (D-033: no phone design for new screens).
2. It uses only the shared components and tokens; no one-off colours, sizes or spacing.
3. It has designed loading, empty and error states.
4. Every input follows the validation rules in section 7.
5. Every action shows a busy state and cannot be double-submitted.
6. Data that can change updates without a refresh, per the table in section 7.
7. It passes the keyboard and contrast checks in section 7.
8. Its tests cover: loading, success, empty, each error code, and each validation rule.
9. It has been seen in a real browser at 1440 px and 1024 px before being called verified (and at
   390 px too if it changes an M1.5 screen).
