"""Measure videos with ffprobe and join start clip + AI video + end clip with ffmpeg.

Rules (backend CLAUDE.md, "Rules for scripts, templates and joining" 5-8):
- no paid service is called, so a join may be retried;
- the AI video is measured, never assumed (R-67), and is never modified or overwritten;
- ffmpeg and ffprobe get an argument list, never a shell string; paths only appear after `-i`
  and as the output, never inside a filter graph, so they need no escaping.

The output is written to a temporary file next to `out_path` and renamed into place, so a failed
run leaves no half-written file.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any

PROBE_TIMEOUT_S = 30
JOIN_TIMEOUT_S = 600

# Used only when the AI video has no sound at all; the starter banners use the same format.
DEFAULT_SAMPLE_RATE = 48000
DEFAULT_CHANNELS = 2

_LAYOUT_BY_CHANNELS = {1: "mono", 2: "stereo"}


class MediaError(Exception):
    """A video could not be measured or joined. `str(error)` is a plain message; `details` holds
    tool output for the server log (never for the customer)."""

    def __init__(self, message: str, details: str = "") -> None:
        super().__init__(message)
        self.details = details


@dataclass(frozen=True)
class MediaInfo:
    width: int
    height: int
    frame_rate: Fraction
    duration: float  # seconds
    has_audio: bool
    sample_rate: int | None  # Hz; None without audio
    channels: int | None  # None without audio
    channel_layout: str | None  # as ffprobe reports it, e.g. "stereo"; None without audio
    sample_aspect_ratio: str  # "num:den", "1:1" when unknown


def _tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise MediaError(f"{name} is not installed or not on PATH; banners cannot be added.")
    return path


def _run(cmd: list[str], timeout: int, failure: str) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{failure} It took too long.") from exc
    except OSError as exc:
        raise MediaError(failure, str(exc)) from exc
    if result.returncode != 0:
        raise MediaError(failure, result.stderr[-4000:])
    return result


def _fraction(value: Any) -> Fraction | None:
    try:
        f = Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        return None
    return f if f > 0 else None


def _float(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def measure(path: str | os.PathLike[str]) -> MediaInfo:
    """Measure a video file with ffprobe. Raises MediaError if it is not a playable video."""
    source = Path(path)
    if not source.is_file():
        raise MediaError(f"The video file {source.name} was not found.")
    failure = f"The file {source.name} could not be read as a video."
    result = _run(
        [
            _tool("ffprobe"),
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,r_frame_rate,avg_frame_rate,duration,"
            "sample_rate,channels,channel_layout,sample_aspect_ratio:format=duration",
            "-of",
            "json",
            str(source),
        ],
        PROBE_TIMEOUT_S,
        failure,
    )
    try:
        data = json.loads(result.stdout)
        streams = list(data.get("streams") or [])
        fmt = data.get("format") or {}
    except (ValueError, AttributeError, TypeError) as exc:
        raise MediaError(failure, result.stdout[-4000:]) from exc

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None:
        raise MediaError(f"The file {source.name} has no picture.")
    width, height = video.get("width"), video.get("height")
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        raise MediaError(failure, f"bad size {width}x{height}")
    # avg_frame_rate is the true rate for constant and variable rate files; r_frame_rate is a
    # fallback (it can be a timebase-like value such as 90000/1 for variable rate video).
    rate = _fraction(video.get("avg_frame_rate")) or _fraction(video.get("r_frame_rate"))
    if rate is None:
        raise MediaError(failure, "no frame rate")
    duration = _float(video.get("duration")) or _float(fmt.get("duration"))
    if duration is None:
        raise MediaError(failure, "no duration")
    sar = str(video.get("sample_aspect_ratio") or "")
    if _fraction(sar.replace(":", "/")) is None:
        sar = "1:1"

    sample_rate = channels = None
    layout = None
    if audio is not None:
        sample_rate = (
            int(audio["sample_rate"]) if str(audio.get("sample_rate", "")).isdigit() else None
        )
        channels = audio.get("channels") if isinstance(audio.get("channels"), int) else None
        layout = audio.get("channel_layout") or None
        if not sample_rate or not channels:
            raise MediaError(failure, "unreadable sound track")
    return MediaInfo(
        width=width,
        height=height,
        frame_rate=rate,
        duration=duration,
        has_audio=audio is not None,
        sample_rate=sample_rate,
        channels=channels,
        channel_layout=layout,
        sample_aspect_ratio=sar,
    )


def _layout(info: MediaInfo) -> tuple[int, str]:
    """Target sample rate and channel layout string for the joined file."""
    if not info.has_audio or info.sample_rate is None or info.channels is None:
        return DEFAULT_SAMPLE_RATE, _LAYOUT_BY_CHANNELS[DEFAULT_CHANNELS]
    layout = info.channel_layout or _LAYOUT_BY_CHANNELS.get(info.channels, f"{info.channels}c")
    return info.sample_rate, layout


def _segment_filters(index: int, part: MediaInfo, target: MediaInfo, rate: int, layout: str) -> str:
    """Filters that bring input `index` to the AI video's picture and sound format."""
    w, h = target.width, target.height
    fps = f"{target.frame_rate.numerator}/{target.frame_rate.denominator}"
    d = f"{part.duration:.6f}"
    video = (
        f"[{index}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"setsar={target.sample_aspect_ratio.replace(':', '/')},fps={fps},format=yuv420p,"
        f"trim=duration={d},setpts=PTS-STARTPTS[v{index}]"
    )
    if part.has_audio:
        sound = f"[{index}:a:0]aresample={rate},"
    else:
        sound = f"anullsrc=r={rate}:cl={layout},"
    # Pad then trim, so each part's sound is exactly as long as its picture and the parts after
    # it stay in sync.
    sound += (
        f"aformat=sample_fmts=fltp:sample_rates={rate}:channel_layouts={layout},"
        f"apad=whole_dur={d},atrim=duration={d},asetpts=PTS-STARTPTS[a{index}]"
    )
    return f"{video};{sound}"


def join(
    ai_video: str | os.PathLike[str],
    start_clip: str | os.PathLike[str] | None,
    end_clip: str | os.PathLike[str] | None,
    out_path: str | os.PathLike[str],
) -> bool:
    """Join start clip + AI video + end clip into one MP4 (H.264 + AAC) at `out_path`.

    Every clip is converted to the AI video's picture size (scaled to fit, keeping its shape, with
    black bars), frame rate and sound format; a part without sound gets silence. Returns False and
    writes nothing when there is no clip (the caller keeps the AI video). Raises MediaError on any
    failure, leaving no file at `out_path`. The AI video file is never changed.
    """
    if start_clip is None and end_clip is None:
        return False
    ai = Path(ai_video)
    out = Path(out_path)
    parts = [Path(p) for p in (start_clip, ai_video, end_clip) if p is not None]
    out_resolved = out.resolve()
    if any(p.resolve() == out_resolved for p in parts):
        raise MediaError("The joined video cannot replace one of its own parts.")

    ffmpeg = _tool("ffmpeg")
    target = measure(ai)
    infos = [measure(p) for p in parts]
    rate, layout = _layout(target)

    cmd = [ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y"]
    for p in parts:
        cmd += ["-i", str(p)]
    graph = ";".join(
        _segment_filters(i, info, target, rate, layout) for i, info in enumerate(infos)
    )
    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(parts)))
    graph += f";{concat_inputs}concat=n={len(parts)}:v=1:a=1[vout][aout]"

    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{out.name}.", suffix=".part", dir=out.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        cmd += [
            "-filter_complex",
            graph,
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            f"{target.frame_rate.numerator}/{target.frame_rate.denominator}",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            str(rate),
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            str(tmp),
        ]
        _run(cmd, JOIN_TIMEOUT_S, "The banners could not be joined to the video.")
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)
    return True
