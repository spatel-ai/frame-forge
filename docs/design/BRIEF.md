# Brief: screen designs for the Frameforge web app

You are drawing static screen designs (mockups) as HTML files for a design canvas. You write
files only. You do not publish, run, render, screenshot or verify anything, and you do not touch
the git repository.

## Read first

1. `/Users/shubham-dev/Documents/organization-docs/desktop2/vvdo/docs/UX.md` — the design system
   (section 4), layout (5), screens (6) and interaction standards (7). Follow it exactly.
2. Two finished artboards in this folder's `project/` directory. They are the house style; copy
   their structure, values and markup patterns:
   - `project/Main.dc.html` (Home)
   - `project/Create-1-Details.dc.html` (Create step 1, with the stepper and form controls)

## File format rules (each one fails silently if broken)

- One file per screen, written to `project/<Name>.dc.html` in this folder, with the exact file
  name given in your task list. Write each file with the Write tool. Never generate files with a
  script.
- Copy the skeleton of the examples exactly: doctype, `<html lang="en">`, `<head>` with charset,
  a short `<title>`, and the line `<script src="./support.js"></script>` unchanged; then
  `<body><x-dc><helmet>…</helmet> ROOT </x-dc><script type="text/x-dc" data-dc-script
  data-props='{"$preview":{"width":W,"height":H}}'>class Component extends DCLogic { renderVals()
  { return {}; } }</script></body></html>`.
- `<helmet>` holds only the Google Fonts `<link>` and the tiny `<style>` shown in the examples
  (`body{margin:0}` and the `a` colours). ALL other styling is inline `style="…"` attributes.
- Close every non-void element. Double-quote every attribute. Single-quote the `data-props`
  attribute as in the examples.
- `{{name}}` is a plain lookup into what `renderVals()` returns; never an expression. Repeats use
  `<sc-for list="{{items}}" as="item" hint-placeholder-count="3">…</sc-for>` as in Main.dc.html.
  Text a viewer might retype stays literal markup; use `sc-for` only for genuinely repeated rows
  or cards.
- No `<iframe>`, `<object>`, `<embed>`, no images, no external network except the Google Fonts
  link. Icons are inline stroke SVGs like the examples, with `aria-hidden="true"`. No emoji.
- Real elements: `<button type="button">`, `<a href>`, `<input>` with a `<label for>`,
  `<select>`, `<textarea>`. Never a clickable `div`. Icon-only buttons get `aria-label`.
- Links between screens use the target file name: `href="Wallet.dc.html"`. Style the `<a>` itself
  as the button; do not put a `<button>` inside an `<a>`.
- Lay out with flex or grid plus `gap`. No fixed pixel widths on a PAGE root.

## Two kinds of artboard

- **PAGE (desktop, 1440 × 960)**: root is
  `min-height: 100vh; display: flex; flex-wrap: wrap; …` exactly as in the examples, with the same
  sidebar `<nav>` and top bar `<header>`. Change only which nav item is current (move the
  `aria-current="page"` attribute and the highlighted style to it) and the `<h1>` text. Content
  goes in `<main>` with the same padding and `max-width: 1120px`. `$preview` is
  `{"width":1440,"height":960}`.
- **FIXED (phone 390 × 844, or a reference sheet)**: root is a `div` with
  `width: Wpx; height: Hpx; box-sizing: border-box; overflow: hidden` and the same font, colour
  and background as the examples. `$preview` matches W and H.

## Content rules

- Colours, type, spacing, radii: only the values in UX.md section 4 and the examples. The
  marigold `#FFB020` is used only for the credits coin.
- One filled primary-colour button per screen.
- Pricing (owner decisions D-006, D-038): 20 credits per second of voice for the video, plus 10
  credits for each voice. Use example numbers consistently: a 12-second video costs 240 credits
  for the video and 10 for the voice (250 in all); the example balance is 500 credits. ₹1 = 1
  credit; purchases are expressed in credits, 500 to 10,000 (D-047). "Credits do not expire" is a
  Decided: credits never expire (D-052). Do not write a maximum video length as a rule (D-044).
- Example content: an Indian small business. Example user: Asha Verma, asha@example.com.
  Languages are English, Hindi and Punjabi only.
- Photos and video frames are grey placeholder boxes with a line icon, as in the examples.
- Text contrast at least 4.5:1: use `#14182B`, `#4B5169` for text on white; never lighter greys
  for text. Controls at least 44 px tall.
- Plain words. Every error says what to do next. Banners are labelled "Free" and appear only after the customer switches on "Add banners" (D-058).
- No lorem ipsum, no invented statistics, no marketing claims.

## When done

Reply with the list of files you wrote and, for each, one line on what it shows and anything you
were unsure about. Do not claim the designs render correctly; nobody has rendered them.
