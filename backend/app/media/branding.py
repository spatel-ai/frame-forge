"""Turning a customer's banner image into the video's opening, closing and corner emblem
(D-067, R-12 for the owner's own image).

Works on files alone: no database, no wallet, no network, no paid service, so it may be run again.
ffmpeg gets an argument list, never a shell string (joining rule 8). This ffmpeg build has no
`drawtext`, so only `color`, `scale`, `fade`, `overlay`, `format` and `anullsrc` are used.

Output files are written under temporary names and renamed at the end; on any failure none of the
three files is left behind."""

import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from PIL import Image

from .joining import MediaError

DEFAULT_PAD_COLOR = "0x15215e"
START_SECONDS = 2.0
END_SECONDS = 3.0
FADE_SECONDS = 0.5
WIDTH_SHARE = 0.55  # the logo fills about this much of the frame width
MAX_UPSCALE = 2.0
MAX_HEIGHT_SHARE = 0.8  # a tall logo is held inside the frame
ZOOM_FROM = 0.92
ZOOM_SECONDS = 2.0
OVERLAY_MAX_SIDE = 1024
_TIMEOUT_S = 120
_FAILURE = "We could not prepare your banner for the video."


@dataclass(frozen=True)
class BrandClips:
    start: Path
    end: Path
    overlay: Path
    pad_color: str  # ffmpeg colour, e.g. "0x15215e"


def pad_color(image: Image.Image) -> str:
    """The average colour of the four corner regions when they are opaque; the default navy when
    the corners are transparent (a logo with no background of its own)."""
    rgba = image.convert("RGBA")
    w, h = rgba.size
    cw, ch = max(1, w // 20), max(1, h // 20)
    boxes = [(0, 0), (w - cw, 0), (0, h - ch), (w - cw, h - ch)]
    r = g = b = a = n = 0
    for x, y in boxes:
        data = rgba.crop((x, y, x + cw, y + ch)).tobytes()
        for i in range(0, len(data), 4):
            r, g, b, a, n = r + data[i], g + data[i + 1], b + data[i + 2], a + data[i + 3], n + 1
    if n == 0 or a / n < 128:
        return DEFAULT_PAD_COLOR
    return f"0x{round(r / n):02x}{round(g / n):02x}{round(b / n):02x}"


def _target_size(iw: int, ih: int, width: int, height: int) -> tuple[int, int]:
    """Logo size at 100% zoom: about 55% of the frame width, never above 2x, aspect kept."""
    scale = min(WIDTH_SHARE * width / iw, MAX_UPSCALE, MAX_HEIGHT_SHARE * height / ih)
    return max(2, round(iw * scale)), max(2, round(ih * scale))


def filter_graph(tw: int, th: int, width: int, height: int, fps: str, duration: float) -> str:
    """The video graph: logo scaled by a time-based zoom, faded in on its alpha channel, then
    centred over the plain background. Input 0 is the colour source, input 1 the looped image."""
    zoom = f"({ZOOM_FROM}+{1 - ZOOM_FROM:.2f}*min(t/{ZOOM_SECONDS},1))"
    return (
        f"[1:v]format=rgba,"
        f"scale=w='trunc({tw}*{zoom}/2)*2':h='trunc({th}*{zoom}/2)*2':eval=frame,"
        f"fade=t=in:st=0:d={FADE_SECONDS}:alpha=1[logo];"
        f"[0:v][logo]overlay=x='(W-w)/2':y='(H-h)/2':eval=frame:format=auto,"
        f"format=yuv420p[v]"
    )


def _remove(*paths: Path) -> None:
    for p in paths:
        p.unlink(missing_ok=True)


def _encode(
    ffmpeg: str,
    image: Path,
    out: Path,
    *,
    color: str,
    width: int,
    height: int,
    fps: str,
    duration: float,
    graph: str,
) -> None:
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={color}:s={width}x{height}:r={fps}:d={duration}",
        "-framerate",
        fps,
        "-loop",
        "1",
        "-i",
        str(image),
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-filter_complex",
        graph,
        "-map",
        "[v]",
        "-map",
        "2:a",
        "-t",
        str(duration),
        "-r",
        fps,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(out),
    ]
    try:
        result = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{_FAILURE} It took too long.") from exc
    except OSError as exc:
        raise MediaError(_FAILURE, str(exc)) from exc
    if result.returncode != 0:
        raise MediaError(_FAILURE, result.stderr[-4000:])


def render_brand_clips(
    image: Path,
    width: int,
    height: int,
    fps: int | float | Fraction | str,
    out_dir: Path,
) -> BrandClips:
    """Make `start.mp4` (2.0 s), `end.mp4` (3.0 s) and `overlay.png` in `out_dir` from one image.

    Each clip is H.264 yuv420p at exactly `width` x `height` and `fps`, with a silent stereo
    48 kHz AAC track. Raises MediaError; no partial file is left in `out_dir`."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise MediaError("ffmpeg is not installed or not on PATH; banners cannot be added.")
    if width < 2 or height < 2 or width % 2 or height % 2:
        raise MediaError(f"{_FAILURE} The video size must be even.")
    fps_text = str(fps)
    try:
        if Fraction(fps_text) <= 0:
            raise ValueError
    except (ValueError, ZeroDivisionError):
        raise MediaError(f"{_FAILURE} The frame rate is not valid.") from None

    try:
        with Image.open(image) as opened:
            opened.load()
            source = opened.convert("RGBA")
    except Exception as exc:
        raise MediaError(_FAILURE, f"unreadable banner image: {type(exc).__name__}") from exc

    out_dir.mkdir(parents=True, exist_ok=True)
    names = {"start": "start.mp4", "end": "end.mp4", "overlay": "overlay.png"}
    final = {k: out_dir / v for k, v in names.items()}
    part = {k: out_dir / f".{v}.part" for k, v in names.items()}
    color = pad_color(source)
    tw, th = _target_size(source.width, source.height, width, height)
    try:
        for key, seconds in (("start", START_SECONDS), ("end", END_SECONDS)):
            _encode(
                ffmpeg,
                image,
                part[key],
                color=color,
                width=width,
                height=height,
                fps=fps_text,
                duration=seconds,
                graph=filter_graph(tw, th, width, height, fps_text, seconds),
            )
        side = max(source.size)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.paste(source, ((side - source.width) // 2, (side - source.height) // 2))
        if side > OVERLAY_MAX_SIDE:
            square = square.resize((OVERLAY_MAX_SIDE, OVERLAY_MAX_SIDE), Image.Resampling.LANCZOS)
        square.save(part["overlay"], "PNG")
        for key in names:
            part[key].replace(final[key])
    except BaseException as exc:
        _remove(*part.values(), *final.values())
        if isinstance(exc, (MediaError, KeyboardInterrupt, SystemExit)):
            raise
        if isinstance(exc, Exception):
            raise MediaError(_FAILURE, f"{type(exc).__name__}: {exc}") from exc
        raise
    return BrandClips(final["start"], final["end"], final["overlay"], color)
