"""Joining banner clips around the AI video (T-507; HLD 5.4, D-019).

Clips are generated on the fly with ffmpeg into temporary folders. Free: nothing here calls a
paid service, the database or the network. Skipped when ffmpeg or ffprobe is not on PATH.
"""

import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

from app.media import MediaError, join, measure

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are needed for the joining tests",
)

RED, BLUE, GREEN = (255, 0, 0), (0, 0, 255), (0, 255, 0)
START_S, AI_S, END_S = 0.6, 1.0, 0.8
TOLERANCE_S = 0.2


def make_clip(
    path: Path,
    *,
    size: str,
    fps: str,
    duration: float,
    colour: str,
    audio: tuple[int, int] | None = (48000, 2),
) -> Path:
    """A solid-colour H.264 clip; `audio` is (sample rate, channels) or None for no sound."""
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={colour}:s={size}:r={fps}:d={duration}",
    ]
    if audio is not None:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate={audio[0]}"]
        cmd += ["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-ac", str(audio[1])]
    cmd += ["-t", str(duration), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    subprocess.run([*cmd, str(path)], check=True, stdin=subprocess.DEVNULL)
    return path


@pytest.fixture(scope="module")
def clips(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    d = tmp_path_factory.mktemp("clips")
    return {
        "ai": make_clip(d / "ai.mp4", size="640x360", fps="25", duration=AI_S, colour="blue"),
        "start": make_clip(
            d / "start.mp4", size="320x180", fps="30", duration=START_S, colour="red"
        ),
        "end": make_clip(d / "end.mp4", size="640x360", fps="25", duration=END_S, colour="lime"),
        "start_silent": make_clip(
            d / "start_silent.mp4",
            size="640x360",
            fps="25",
            duration=START_S,
            colour="red",
            audio=None,
        ),
        "ai_silent": make_clip(
            d / "ai_silent.mp4",
            size="640x360",
            fps="25",
            duration=AI_S,
            colour="blue",
            audio=None,
        ),
        "ai_ntsc_mono": make_clip(
            d / "ai_ntsc_mono.mp4",
            size="320x180",
            fps="30000/1001",
            duration=AI_S,
            colour="blue",
            audio=(44100, 1),
        ),
        "ai_portrait": make_clip(
            d / "ai_portrait.mp4", size="180x320", fps="25", duration=AI_S, colour="blue"
        ),
        "start_wide": make_clip(
            d / "start_wide.mp4", size="640x360", fps="30", duration=START_S, colour="red"
        ),
    }


def pixel(video: Path, at_s: float, x: int, y: int) -> tuple[int, int, int]:
    """RGB of a 2x2 area at (x, y) of the frame at `at_s` seconds."""
    raw = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            f"{at_s:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-vf",
            f"crop=2:2:{x}:{y},scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    r, g, b = raw[:3]
    return r, g, b


def near(actual: tuple[int, int, int], expected: tuple[int, int, int]) -> bool:
    return all(abs(a - e) <= 40 for a, e in zip(actual, expected, strict=True))


def loudest_db(video: Path, start_s: float, end_s: float) -> float:
    """Peak sound level in dB between two times (about -91 for digital silence)."""
    stderr = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-ss",
            str(start_s),
            "-to",
            str(end_s),
            "-i",
            str(video),
            "-vn",
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stderr
    line = next(ln for ln in stderr.splitlines() if "max_volume:" in ln)
    return float(line.split("max_volume:")[1].split()[0])


def decodes(video: Path) -> None:
    """The whole file decodes without error, i.e. it plays."""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(video), "-f", "null", "-"],
        check=True,
        capture_output=True,
    )


def check_matches_ai(out: Path, ai: Path, expected_s: float) -> None:
    got, want = measure(out), measure(ai)
    assert (got.width, got.height) == (want.width, want.height)
    assert got.frame_rate == want.frame_rate
    assert abs(got.duration - expected_s) <= TOLERANCE_S, got.duration
    assert got.has_audio
    if want.has_audio:
        assert (got.sample_rate, got.channels) == (want.sample_rate, want.channels)
    decodes(out)


def test_measure_reads_the_file(clips):
    """R-67: size, frame rate, length and sound are measured, not assumed."""
    info = measure(clips["start"])
    assert (info.width, info.height, info.frame_rate) == (320, 180, Fraction(30))
    assert abs(info.duration - START_S) < 0.1
    assert (info.has_audio, info.sample_rate, info.channels) == (True, 48000, 2)
    silent = measure(clips["ai_silent"])
    assert (silent.has_audio, silent.sample_rate, silent.channels) == (False, None, None)


def test_both_banners_in_order(clips, tmp_path):
    """R-44: start + AI + end become one MP4 at the AI video's size and frame rate, in order."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai"], clips["start"], clips["end"], out) is True
    check_matches_ai(out, clips["ai"], START_S + AI_S + END_S)
    assert near(pixel(out, 0.1, 320, 180), RED)
    assert near(pixel(out, START_S + AI_S / 2, 320, 180), BLUE)
    assert near(pixel(out, START_S + AI_S + END_S - 0.15, 320, 180), GREEN)


def test_start_only(clips, tmp_path):
    """R-44: start banner only; the video ends with the AI part."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai"], clips["start"], None, out) is True
    check_matches_ai(out, clips["ai"], START_S + AI_S)
    assert near(pixel(out, 0.1, 320, 180), RED)
    assert near(pixel(out, START_S + AI_S - 0.15, 320, 180), BLUE)


def test_end_only(clips, tmp_path):
    """R-44: end banner only; the video starts with the AI part."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai"], None, clips["end"], out) is True
    check_matches_ai(out, clips["ai"], AI_S + END_S)
    assert near(pixel(out, 0.1, 320, 180), BLUE)
    assert near(pixel(out, AI_S + END_S - 0.15, 320, 180), GREEN)


def test_no_banners_writes_nothing(clips, tmp_path):
    """R-44: with no banner the function says so and writes no file; the AI video is kept."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai"], None, None, out) is False
    assert list(tmp_path.iterdir()) == []
    assert clips["ai"].is_file()


def test_clip_of_other_size_and_rate_follows_unusual_ai_format(clips, tmp_path):
    """R-67: a 640x360 30 fps stereo clip is converted to a 320x180, 29.97 fps, 44.1 kHz mono AI
    video; nothing is assumed about the AI video's format."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai_ntsc_mono"], clips["start_wide"], clips["end"], out) is True
    check_matches_ai(out, clips["ai_ntsc_mono"], START_S + AI_S + END_S)
    assert measure(out).frame_rate == Fraction(30000, 1001)


def test_clip_of_other_shape_is_fitted_with_bars(clips, tmp_path):
    """R-67: a landscape clip before a portrait AI video is scaled to fit, keeping its shape,
    with black bars; the output keeps the AI video's portrait size."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai_portrait"], clips["start_wide"], None, out) is True
    check_matches_ai(out, clips["ai_portrait"], START_S + AI_S)
    assert near(pixel(out, 0.1, 90, 160), RED)  # centre: the clip
    assert near(pixel(out, 0.1, 90, 10), (0, 0, 0))  # top: a bar
    assert near(pixel(out, START_S + AI_S / 2, 90, 10), BLUE)  # the AI part is not barred


def test_silent_clip_stays_silent(clips, tmp_path):
    """R-44 (Q-16): a clip without sound gets a silent track, so the join still works."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai"], clips["start_silent"], clips["end"], out) is True
    check_matches_ai(out, clips["ai"], START_S + AI_S + END_S)
    assert loudest_db(out, 0.0, START_S - 0.1) < -50  # the silent banner stays silent
    assert loudest_db(out, START_S + 0.1, START_S + AI_S - 0.1) > -40  # the AI sound is kept


def test_ai_video_without_sound(clips, tmp_path):
    """R-67: an AI video without sound still joins; the result has a sound track (48 kHz
    stereo) so the banners' own sound is kept."""
    out = tmp_path / "out.mp4"
    assert join(clips["ai_silent"], clips["start"], clips["end"], out) is True
    check_matches_ai(out, clips["ai_silent"], START_S + AI_S + END_S)
    info = measure(out)
    assert (info.sample_rate, info.channels) == (48000, 2)


@pytest.mark.parametrize("broken", ["ai", "start"])
def test_broken_input_raises_and_leaves_nothing(clips, tmp_path, broken):
    """R-67: a file that is not a video raises MediaError and no file is left in the output
    folder, not even a temporary one."""
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"this is not a video")
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    ai = bad if broken == "ai" else clips["ai"]
    start = bad if broken == "start" else clips["start"]
    with pytest.raises(MediaError):
        join(ai, start, clips["end"], out_dir / "out.mp4")
    assert list(out_dir.iterdir()) == []


def test_truncated_clip_raises_and_leaves_nothing(clips, tmp_path):
    """R-67: a clip cut short mid-file fails cleanly; the AI video is untouched."""
    bad = tmp_path / "cut.mp4"
    bad.write_bytes(clips["end"].read_bytes()[:2000])
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    before = clips["ai"].read_bytes()
    with pytest.raises(MediaError):
        join(clips["ai"], None, bad, out_dir / "out.mp4")
    assert list(out_dir.iterdir()) == []
    assert clips["ai"].read_bytes() == before


def test_failed_ffmpeg_run_leaves_no_temp_file(clips, tmp_path):
    """R-67: an AI video that measures fine but cannot be encoded (odd size 321x181, which H.264
    4:2:0 cannot hold) fails during the ffmpeg run itself; the temporary file is removed."""
    odd = tmp_path / "odd.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=321x181:r=25:d=0.5",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv444p",
            str(odd),
        ],
        check=True,
    )
    assert (measure(odd).width, measure(odd).height) == (321, 181)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    with pytest.raises(MediaError) as error:
        join(odd, clips["start"], None, out_dir / "out.mp4")
    assert error.value.details  # ffmpeg's own message is kept for the log
    assert list(out_dir.iterdir()) == []


def test_unwritable_output_folder_raises_media_error(clips, tmp_path):
    """R-44: a folder that cannot be written raises the module's error, not a raw OSError."""
    blocker = tmp_path / "not-a-folder"
    blocker.write_text("x")
    with pytest.raises(MediaError):
        join(clips["ai"], clips["start"], None, blocker / "out.mp4")


def test_missing_ffmpeg_gives_a_clear_error(clips, tmp_path, monkeypatch):
    """R-67: without ffmpeg/ffprobe on PATH, measuring and joining raise MediaError naming it."""
    monkeypatch.setattr("app.media.joining.shutil.which", lambda name: None)
    with pytest.raises(MediaError, match="ffprobe"):
        measure(clips["ai"])
    with pytest.raises(MediaError, match="ffmpeg"):
        join(clips["ai"], clips["start"], None, tmp_path / "out.mp4")
    assert list(tmp_path.iterdir()) == []


def test_joined_file_is_readable(clips, tmp_path):
    """R-44: the joined file gets the usual 0644 mode, not the temp file's 0600."""
    out = tmp_path / "out.mp4"
    join(clips["ai"], None, clips["end"], out)
    assert out.stat().st_mode & 0o777 == 0o644


def test_output_cannot_replace_the_ai_video(clips):
    """R-44: the AI video is kept; joining refuses to write over it."""
    with pytest.raises(MediaError):
        join(clips["ai"], clips["start"], None, clips["ai"])
