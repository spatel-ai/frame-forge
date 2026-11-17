# T-518 fal Kling AI Avatar v2 facts (checked 2026-11-17, documentation only)

Endpoint in repo: `fal-ai/kling-video/ai-avatar/v2/standard` (backend/app/core/config.py). Called with `image_url`, `audio_url` only (providers.py).
Sources: FAL-STD = https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard (+ /api, /llms.txt); FAL-PRO = https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro; FAL-DOC = https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-ai-avatar-v2.md; KLING = https://kling.ai/document-api/api/video/avatar.md

Caveat: KLING is Kling's own direct API. I did NOT see fal.ai link to it, and fal's wrapper may differ. Treat KLING numbers as indicative only, not as fal's limits.

| # | Item | Fact | Source | Checked |
|---|------|------|--------|---------|
| 1 | Max/min input audio (fal) | Not verified - not found in official fal docs. Only: output "Matches audio length"; "Video automatically scaled to audio file duration". No statement on rejection, truncation or different billing. | FAL-STD, FAL-DOC | 2026-11-17 |
| 1b | Audio (Kling own API) | "duration between 2-300 seconds" (audio_id and sound_file); sound_file formats .mp3/.wav/.m4a/.aac, max 5MB. Kling page says version/mode support differs ("see Capability Map", not read). | KLING | 2026-11-17 |
| 1c | Audio formats (fal) | mp3, ogg, wav, m4a, aac | FAL-STD | 2026-11-17 |
| 2 | Max output video duration | fal: Not verified - not found. Output equals audio length. Output schema has `duration` (float, seconds), no cap stated. Kling: no output cap stated; implied by 300s audio cap. | FAL-STD /api, KLING | 2026-11-17 |
| 3 | Image limits (fal) | Formats listed: JPG, JPEG, PNG, WebP, GIF, AVIF (input hint also lists heic, heif). Size, aspect ratio, file size: Not verified - not found on fal. | FAL-STD | 2026-11-17 |
| 3b | Image (Kling own API) | file size <= 10MB, dimensions >= 300px, aspect ratio 1:2.5 to 2.5:1, formats .jpg/.jpeg/.png. | KLING | 2026-11-17 |
| 4 | Price, standard | CONFIRMED: "Your request will cost $0.0562 per second." (about 17.8 s per $1). No change. | FAL-STD, /llms.txt | 2026-11-17 |
| 4b | Price, pro | $0.115 per second. | FAL-PRO, FAL-DOC | 2026-11-17 |
| 5 | Failed generations billed | Not verified - not found in official docs (fal or Kling). | all | 2026-11-17 |
| 6 | Resolution / fps | Not verified - not found in official docs. Output is MP4. | FAL-STD, KLING | 2026-11-17 |

Other fal input fields (schema): `image_url` and `audio_url` required; `prompt` optional (default "."); `enable_safety_checker` optional (default true). Output: `video` (File), `duration` (float).

Third-party (not official, do not rely on): other sites quote 60 s, 5 min, 10 min for various Kling avatar versions; they conflict.

## Implication for D-044
No official fal statement of a maximum audio length. Only Kling's own API doc states 2-300 s. Raising our limit above 30 s needs a decision: either cap at 300 s on the Kling figure (unverified for fal), or run one small paid test, with fresh owner approval, at the target length. Cost at $0.0562/s: 60 s = $3.37, 300 s = $16.86 per video (arithmetic, not provider data).
