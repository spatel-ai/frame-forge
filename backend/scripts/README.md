# Backend scripts

## make_banner_clips.py

Generates four simple starter banner clips with ffmpeg, so the joining step (M5) has real clips
to test with.

- Output: 720×1280 (portrait 9:16, D-063), 25 fps, H.264 (yuv420p), AAC stereo 48 kHz MP4.
- `start-logo-reveal.mp4` (2 s, purple, "Frameforge", quiet tone)
- `start-simple-title.mp4` (2 s, light, "Frameforge", silent)
- `end-thank-you.mp4` (2.5 s, purple, "Thank you for watching", quiet tone)
- `end-call-to-action.mp4` (3 s, light, "Made with Frameforge", silent)

Text uses ffmpeg's `drawtext` filter when the build has it and a system font exists. Otherwise the
clips are plain colour, and the script prints a warning.

Run it from the repository root (needs `ffmpeg` and `ffprobe` on PATH):

```bash
uv run python backend/scripts/make_banner_clips.py            # writes backend/data/banners
uv run python backend/scripts/make_banner_clips.py <out_dir>  # writes to another folder
```

After writing, the script runs `ffprobe` on each clip, prints a summary, and exits non-zero if a
clip is not 720×1280 (portrait 9:16, D-063) or its duration is more than 0.1 s from the expected length.

Banners are free and optional (D-058). The owner can replace these clips with their own later;
keep the same size, frame rate and audio format so the joining step accepts them.

## Banner templates command (`app.templates.cli`)

Adds, lists and retires the start and end banner clips customers can pick (R-44, R-46, R-47).
Free: no network, no paid service. Needs `ffprobe` and the database. Run from `backend/`:

```bash
uv run python -m app.templates.cli add --kind start --name "Festive opening" clip.mp4
uv run python -m app.templates.cli list          # active only; add --all to include retired
uv run python -m app.templates.cli retire <id>   # sets active=false; never deletes
```

`add` measures the clip with ffprobe and refuses (exit code 2, nothing written) anything that is
not a playable video, has no picture, or is longer than the `max_template_seconds` setting (5 s).
It copies the clip to `<data_dir>/templates/<id>.mp4`; the preview is the same file. The starter
clips from `make_banner_clips.py` can be added this way.
