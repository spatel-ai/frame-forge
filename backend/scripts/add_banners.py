"""Add the banners to an existing video file, exactly as the app does after fal.ai returns one.

    cd backend
    uv run python scripts/add_banners.py <input video> [output video]

Free: only ffmpeg on this machine, no fal.ai call, no database, no S3. Uses the banner files in
backend/assets/banners (opening, closing, corner emblem). The input video is never changed."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings  # noqa: E402
from app.media import MediaError, compose, measure  # noqa: E402


def main(argv: list[str]) -> int:
    if not 1 <= len(argv) <= 2:
        print(__doc__)
        return 2
    source = Path(argv[0]).expanduser().resolve()
    out = (
        Path(argv[1]).expanduser().resolve()
        if len(argv) == 2
        else source.with_name(f"{source.stem}-with-banners.mp4")
    )
    settings = Settings()
    banners = settings.banner_dir
    try:
        compose(
            source,
            banners / "start.mp4",
            banners / "end.mp4",
            banners / "overlay.png",
            out,
            settings.banner_pad_color,
        )
        info = measure(out)
    except MediaError as exc:
        print(f"FAILED: {exc}")
        if exc.details:
            print(exc.details[-800:])
        return 1
    print(f"Done: {out}")
    sound = "yes" if info.has_audio else "no"
    print(f"{info.width}x{info.height}, {info.duration:.1f} s, sound: {sound}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
