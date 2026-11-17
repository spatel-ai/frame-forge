"""Opening, closing and corner emblem made from a banner image (D-067; R-12).

Clips are made with ffmpeg into temp folders. Free: no network, no paid service. Skipped when
ffmpeg or ffprobe is missing."""

import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest
from PIL import Image

from app.media import MediaError, measure
from app.media import branding as branding_module
from app.media.branding import DEFAULT_PAD_COLOR, render_brand_clips

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are needed for the branding tests",
)

SIZE = (640, 360)
RED = (255, 0, 0)


def logo(path: Path, *, opaque_bg: tuple[int, int, int] | None) -> Path:
    """A 600x300 image with a red block in the middle; transparent or `opaque_bg` around it."""
    bg = (*opaque_bg, 255) if opaque_bg else (0, 0, 0, 0)
    im = Image.new("RGBA", (600, 300), bg)
    im.paste(Image.new("RGBA", (300, 150), (*RED, 255)), (150, 75))
    im.save(path, "PNG")
    return path


def frame(video: Path, second: float, out: Path) -> Image.Image:
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-ss", str(second), "-i", str(video)]
        + ["-frames:v", "1", str(out)],
        check=True,
        stdin=subprocess.DEVNULL,
    )
    return Image.open(out).convert("RGB")


def close(a: tuple[int, ...], b: tuple[int, ...], tol: int = 25) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b, strict=True))


@pytest.fixture(scope="module")
def made(tmp_path_factory: pytest.TempPathFactory):
    d = tmp_path_factory.mktemp("brand")
    src = logo(d / "logo.png", opaque_bg=None)
    clips = render_brand_clips(src, *SIZE, 25, d / "out")
    return d, clips


def test_durations_size_fps_and_silent_audio(made) -> None:
    """D-067: start 2.0 s, end 3.0 s, exact size and fps, a stereo 48 kHz audio track."""
    _, clips = made
    for path, seconds in ((clips.start, 2.0), (clips.end, 3.0)):
        info = measure(path)
        assert (info.width, info.height) == SIZE
        assert info.frame_rate == Fraction(25)
        assert info.duration == pytest.approx(seconds, abs=0.1)
        assert info.has_audio and info.sample_rate == 48000 and info.channels == 2


def test_transparent_corners_use_the_default_background(made) -> None:
    _, clips = made
    assert clips.pad_color == DEFAULT_PAD_COLOR == "0x15215e"


def test_first_frame_is_background_and_a_late_frame_shows_the_logo(made) -> None:
    d, clips = made
    bg = (0x15, 0x21, 0x5E)
    first = frame(clips.start, 0, d / "f0.png")
    assert close(first.getpixel((320, 180)), bg)
    late = frame(clips.start, 1.9, d / "f1.png")
    assert close(late.getpixel((320, 180)), RED)
    assert close(late.getpixel((5, 5)), bg)
    held = frame(clips.end, 2.9, d / "f2.png")
    assert close(held.getpixel((320, 180)), RED)


def test_opaque_corners_set_the_background_colour(tmp_path: Path) -> None:
    green = (10, 200, 30)
    src = logo(tmp_path / "g.png", opaque_bg=green)
    clips = render_brand_clips(src, *SIZE, 25, tmp_path / "out")
    assert clips.pad_color == "0x0ac81e"
    late = frame(clips.end, 2.5, tmp_path / "f.png")
    assert close(late.getpixel((5, 5)), green)


def test_overlay_is_a_square_with_transparent_padding(made) -> None:
    _, clips = made
    with Image.open(clips.overlay) as im:
        assert im.mode == "RGBA" and im.width == im.height == 600
        assert im.getpixel((0, 0))[3] == 0  # padding
        assert im.getpixel((300, 300)) == (*RED, 255)


def test_failure_leaves_no_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The end clip fails after the start clip succeeded: nothing remains in the folder."""
    src = logo(tmp_path / "logo.png", opaque_bg=None)
    real = branding_module._encode
    calls: list[Path] = []

    def flaky(*args, **kwargs):
        calls.append(args[2])
        if len(calls) == 2:
            raise MediaError("boom")
        return real(*args, **kwargs)

    monkeypatch.setattr(branding_module, "_encode", flaky)
    out = tmp_path / "out"
    with pytest.raises(MediaError):
        render_brand_clips(src, *SIZE, 25, out)
    assert len(calls) == 2
    assert list(out.iterdir()) == []


def test_unreadable_image_is_a_media_error_with_no_files(tmp_path: Path) -> None:
    bad = tmp_path / "bad.png"
    bad.write_bytes(b"not an image")
    out = tmp_path / "out"
    with pytest.raises(MediaError):
        render_brand_clips(bad, *SIZE, 25, out)
    assert not out.exists() or list(out.iterdir()) == []


def test_odd_size_is_refused(tmp_path: Path) -> None:
    src = logo(tmp_path / "logo.png", opaque_bg=None)
    with pytest.raises(MediaError):
        render_brand_clips(src, 641, 360, 25, tmp_path / "out")
