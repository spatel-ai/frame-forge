"""Generate simple starter banner clips for the joining step, using ffmpeg.

Usage:
    uv run python backend/scripts/make_banner_clips.py [out_dir]

Default out_dir is backend/data/banners. Requires ffmpeg and ffprobe on PATH.
Writes four 1280x720, 25 fps, H.264 (yuv420p) + AAC stereo 48 kHz MP4 clips.

Text is drawn with ffmpeg's drawtext filter when the ffmpeg build has it and a
system font is found. Otherwise the clips are plain colour, and a warning is
printed. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

WIDTH = 1280
HEIGHT = 720
FPS = 25
SAMPLE_RATE = 48000
DURATION_TOLERANCE_S = 0.1
TONE_VOLUME = 0.05

PURPLE = "4A3AFF"
LIGHT = "F4F5FA"
DARK_TEXT = "14182B"
WHITE = "FFFFFF"

DEFAULT_OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "banners"

FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
)


@dataclass(frozen=True)
class Clip:
    filename: str
    duration_s: float
    background: str
    text: str
    text_colour: str
    tone: bool  # True: quiet 440 Hz sine tone. False: silence.
    fade_in: bool


CLIPS: tuple[Clip, ...] = (
    Clip("start-logo-reveal.mp4", 2.0, PURPLE, "Frameforge", WHITE, tone=True, fade_in=True),
    Clip("start-simple-title.mp4", 2.0, LIGHT, "Frameforge", DARK_TEXT, tone=False, fade_in=False),
    Clip(
        "end-thank-you.mp4", 2.5, PURPLE, "Thank you for watching", WHITE, tone=True, fade_in=False
    ),
    Clip(
        "end-call-to-action.mp4",
        3.0,
        LIGHT,
        "Made with Frameforge",
        DARK_TEXT,
        tone=False,
        fade_in=False,
    ),
)


def has_drawtext(ffmpeg: str) -> bool:
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-filters"], check=True, capture_output=True, text=True
    )
    return any(line.split()[1:2] == ["drawtext"] for line in result.stdout.splitlines())


def pick_font() -> Path | None:
    return next((path for path in FONT_CANDIDATES if path.is_file()), None)


def drawtext_filter(clip: Clip, font: Path) -> str:
    options = [
        f"fontfile='{font}'",
        f"text={clip.text}",
        f"fontcolor=0x{clip.text_colour}",
        "fontsize=80",
        "x=(w-text_w)/2",
        "y=(h-text_h)/2",
    ]
    if clip.fade_in:
        options.append("alpha='if(lt(t,0.6),t/0.6,1)'")
    return "drawtext=" + ":".join(options)


def render_command(ffmpeg: str, clip: Clip, out_path: Path, vf: str | None) -> list[str]:
    if clip.tone:
        audio_src = f"sine=frequency=440:sample_rate={SAMPLE_RATE}:duration={clip.duration_s}"
    else:
        audio_src = (
            f"anullsrc=channel_layout=stereo:sample_rate={SAMPLE_RATE}:duration={clip.duration_s}"
        )
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=0x{clip.background}:s={WIDTH}x{HEIGHT}:r={FPS}:d={clip.duration_s}",
        "-f",
        "lavfi",
        "-i",
        audio_src,
    ]
    if vf is not None:
        cmd += ["-vf", vf]
    if clip.tone:
        cmd += ["-af", f"volume={TONE_VOLUME}"]
    cmd += [
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-t",
        str(clip.duration_s),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    return cmd


def probe(ffprobe: str, path: Path) -> dict:
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels"
            ":format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def problems_for(clip: Clip, data: dict) -> list[str]:
    problems: list[str] = []
    streams = data.get("streams", [])
    video = [s for s in streams if s.get("codec_type") == "video"]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    if not video:
        problems.append("no video stream")
    elif (video[0].get("width"), video[0].get("height")) != (WIDTH, HEIGHT):
        problems.append(f"size {video[0].get('width')}x{video[0].get('height')}")
    if not audio:
        problems.append("no audio stream")
    duration = float(data["format"]["duration"])
    if abs(duration - clip.duration_s) > DURATION_TOLERANCE_S:
        problems.append(f"duration {duration:.3f}s, expected {clip.duration_s}s")
    return problems


def print_summary(clip: Clip, data: dict, problems: list[str]) -> None:
    print(json.dumps(data, indent=2))
    status = "OK" if not problems else "FAIL: " + "; ".join(problems)
    print(f"{clip.filename}: {status}")
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate starter banner clips with ffmpeg.")
    parser.add_argument("out_dir", nargs="?", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if ffmpeg is None or ffprobe is None:
        print("ffmpeg and ffprobe must both be on PATH.", file=sys.stderr)
        return 1

    font: Path | None = None
    if has_drawtext(ffmpeg):
        font = pick_font()
        if font is None:
            print("WARNING: no system font found; writing plain colour clips (no text).")
    else:
        print("WARNING: this ffmpeg build has no drawtext filter; writing plain colour clips.")

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    for clip in CLIPS:
        out_path = out_dir / clip.filename
        vf = drawtext_filter(clip, font) if font is not None else None
        try:
            subprocess.run(render_command(ffmpeg, clip, out_path, vf), check=True)
        except subprocess.CalledProcessError as exc:
            print(f"ffmpeg failed for {clip.filename} (exit {exc.returncode})", file=sys.stderr)
            return 1

    failed = False
    for clip in CLIPS:
        data = probe(ffprobe, out_dir / clip.filename)
        problems = problems_for(clip, data)
        print_summary(clip, data, problems)
        failed = failed or bool(problems)

    print(f"Wrote {len(CLIPS)} clips to {out_dir}" + (" with errors." if failed else "."))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
