# M5 plan: product completeness

Owner-approved plan, 2026-11-17 ("Finish M4, then build M5"). Boards approved 2026-11-17 (UX.md).
Everything runs in mock mode; no fal.ai or Razorpay call (D-021).

**Exit evidence:** a new user signs up, buys credits, picks a saved script, switches on banners,
makes a video with start banner + AI video + end banner in one file, makes another without
banners (no joining step), reuses a saved voice after a failure, and finds both videos in
history. Mock mode, desktop width (1440 px, checked at 1024 px).

## API contract (T-500)

Written into the OpenAPI document on 2026-11-17. Unbuilt routes answer 501 `not_implemented`
after the session check; `backend/tests/test_m5_contract.py` holds the contract. Errors use the
house shape; input errors are 422 `validation_error` with `fields.<name>`.

| Route | Body → result | Errors | Built in |
| --- | --- | --- | --- |
| `GET /api/v1/jobs?page&page_size&status&q` | `status` is `all`, `ready`, `in_progress` or `failed`; `q` searches the script text → `{items: JobSummaryOut[], total, page, page_size}`, newest first, the caller's jobs only | 401, 422 | T-501 |
| `GET /api/v1/voices` | → `{items: SavedVoiceOut[]}`: the caller's failed jobs whose voice is reusable (D-043), with script, language, length, price and audio URL | 401 | T-516 |
| `POST /api/v1/jobs` (multipart) | today's `image`, `script`, `language`, plus `consent` (true), `consent_version`, `script_id`, `start_template_id`, `end_template_id`, `voice_from_job_id` → `JobOut` | 401, 402, 403, 404 `script_not_found` / `voice_not_found`, 422 (`fields.consent` code `consent_required`; stale `consent_version`; template unknown, retired or the wrong kind under its field), 501 until built | T-502, T-505, T-509, T-516 |
| `POST /api/v1/jobs/{id}/approve` | unchanged | adds 429 `daily_limit_reached` outside production, nothing held (D-046) | T-503 |
| `GET /api/v1/scripts?page&page_size&q&language` | → `{items: ScriptOut[], total, page, page_size}`, most recently used first | 401, 422 | T-504 |
| `GET /api/v1/scripts/{id}` | → `ScriptOut {id, language, text, created_at, last_used_at}` | 401, 404 `script_not_found` | T-504 |
| `DELETE /api/v1/scripts/{id}` | → 204; jobs keep their own copy (D-017) | 401, 404 `script_not_found` | T-504 |
| `GET /api/v1/templates` | → `{items: TemplateOut[]}` active only: `{id, name, kind: start\|end, duration_ms, has_audio, preview_url}` | 401 | T-506 |
| `GET /api/v1/templates/{id}/preview` | → the preview clip (video/mp4) | 401, 404 `template_not_found` | T-506 |
| `GET /api/v1/config` | adds `consent_version`, `consent_text` (Q-11 wording) and `daily_video_limit` (null in production) | — | built |

**`JobOut` additions (built now, real values):** `voice_credits` and `video_credits` (the cost
split for Video detail; `charged_credits` is their sum); `failure_kind` (`voice_failed`,
`voice_unknown`, `voice_too_long`, `video_failed`, `video_unknown`; null unless failed), derived
from stored state; `voice_reusable`; `needs_review`. `consent_at`, `script_id`,
`voice_from_job_id`, `start_template`, `end_template` (`{id, name}`) and `banners_applied`
(null: no banners or not joined yet; true: joined; false: delivered without them, D-019) are
null until their tasks add the columns. `status` gains `video_assembling`.

**Rules the build must keep:**

- POST /jobs: a sent M5 field is never ignored. Until its task is built it answers 501 and
  nothing is charged. When built, `script` and `language` become optional where `script_id` or
  `voice_from_job_id` supplies them (D-050: a saved voice's script and language win; sent text is
  ignored). That relaxation is a contract change made in T-505 and T-516.
- Consent (D-045): the browser sends `consent=true` and the `consent_version` it showed; the job
  stores `consent_version` and `consent_at`. A missing consent, or a version other than the
  current one, is refused before any charge.
- A photo is uploaded for every new job, including one with a saved voice (Assumed: the voice is
  reused, the photo is not; the Voice-Choice board keeps the photo step).
- Lists reuse the wallet's page shape (`items, total, page, page_size`; `page_size` up to 100).
- Search and the language filter on scripts and videos run on the server.

## Settings

| Setting | Default | Decision |
| --- | --- | --- |
| `consent_version`, `consent_text` | `2026-11-17`, the Q-11 sentence | D-045, Q-11 |
| `daily_video_limit` | 50, outside production only | D-046 |
| `save_all_voices` | off | D-043 |

## Defaults taken from T-507 (Assumed, owner to confirm where marked)

- A banner clip of another shape is scaled to fit and padded with black bars, never cropped
  (**owner to confirm**).
- The AI video is re-encoded when banners are joined (H.264 CRF 18, AAC 192 kbps); without
  banners it is delivered untouched.
- An AI video with an odd picture size cannot be joined and falls back to no banners (D-019).
- T-509 sweeps leftover `.part` files from interrupted joins.

## Phases

| Phase | Backend | Frontend |
| --- | --- | --- |
| 1 | T-501 job list → T-502 consent → T-503 daily limit (BE-Jobs, in order) ∥ T-504 scripts → T-506 templates (BE-Content) | T-510 Home ∥ T-511 Videos and detail |
| 2 | T-505 script text or saved id | T-513 script picker and My scripts |
| 3 | T-509 joining as `video_assembling`, only with banners | T-514 banners switch → T-515 joining step and fallback |
| 4 | T-516 saved voices | T-517 voice choice |
| 5 | — | T-512 loading, empty and error states; accessibility |
| 6 | Gates B and D: merge, both checks, exit-evidence browser run, M5 report | |

T-507 and T-508 are done (MOCK-VERIFIED).

## Stop conditions

Stop and report if: a board needs a field not in this contract; consent, privacy or cost
behaviour would differ from a decision; joining real model output is needed (Gate C); or the
same failure repeats twice without new evidence.
