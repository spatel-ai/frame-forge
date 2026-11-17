# Baseline (T-351), PROVISIONAL: the full-matrix baseline was NOT run for this commit

The machine was overloaded when this was committed, so the lead limited the final run to a sample.
Re-run the full matrix on a quiet machine and replace this file:
`npm run e2e` (about 7 minutes on an idle machine), then copy `e2e/results/summary.md` here.

## What exists

1. A complete 702-run matrix (27 screens x 13 widths x 2 engines) was run twice during development
   (8.5 and 6.8 minutes). The numbers below are from the second run, made with the harness as it was
   before two small last changes (the bottom-bar check now ignores controls scrolled out of view above;
   so `create-progress` and `home` bottom-bar counts there were partly false positives). Everything else
   in the table is what the final harness measures. Screens that did not reach their ready state: 0.
2. A sample of the final harness (login, wallet; 390 and 1440; both engines): 8 runs, 22 s.

## Headline numbers of the 702-run matrix (provisional)

| Check | Runs failing / measured |
| --- | ---: |
| no-sideways-scroll | 12 / 702 |
| tap-targets | 148 / 702 |
| input-font-size (below 768) | 120 / 270 |
| bottom-bar-clear (below 768) | 38 / 270 (includes the false positives noted above) |

| Screen | no-sideways-scroll | tap-targets | input-font-size | bottom-bar-clear |
| --- | ---: | ---: | ---: | ---: |
| signup, login, forgot-password, reset-password-form | 0 | 0 | 10/10 | 0 |
| create | 0 | 18/26 | 10/10 | 0 |
| create-review, create-banner-picker | 0 | 26/26 | 0 | 0 |
| home | 0 | 26/26 | 0 | 6/10 |
| videos | 0 | 0 | 10/10 | 6/10 |
| video-detail | 0 | 26/26 | 0 | 6/10 |
| scripts | 4/26 (320 px, 366 px wide) | 0 | 10/10 | 6/10 |
| account | 0 | 0 | 10/10 | 6/10 |
| wallet | 0 | 26/26 | 0 | 0 |
| create-progress | 0 | 0 | 0 | 8/10 (false positive, see above) |
| scripts-new-dialog | 4/26 | 0 | 10/10 | 0 |
| scripts-delete-dialog | 4/26 | 0 | 0 | 0 |
| banners-upload-dialog, wallet-buy-dialog, create-script-picker-dialog | 0 | 0 | 10/10 | 0 |
| banners, banners-delete-dialog, create-finished, create-failed, not-found, reset-password-expired, forgot-password-sent, verify-email-expired | 0 | 0 | 0 | 0 |

Faulty runs per width: 17 to 19 of 27 at every width below 768 and at 667x375; 6 of 27 at every width
from 768 up (the tap-target faults of Home, Create, Create review, Video detail, Wallet and the banner picker).
Chromium and WebKit gave the same counts at every width.

Top offenders: the "Manage banners" link (22.5 px tall; create-review), the Password and Email inputs
(15 px font), "See all videos" on Home (22.5 px), "All videos" on Video detail (22.5 px), the wallet row
links (41.5 px), the consent label on Create (30.5 px), and the Scripts page and its dialogs at 320 px
(366 px wide, sideways scroll).

## Sample run of the final harness (login and wallet at 390 and 1440, Chromium and WebKit)

| Screen | Runs | no-sideways-scroll | tap-targets | input-font-size | bottom-bar-clear |
| --- | ---: | ---: | ---: | ---: | ---: |
| login | 4 | 0/4 | 0/4 | 1/2 | 0/2 |
| wallet | 4 | 0/4 | 4/4 | 0/2 | 0/2 |
