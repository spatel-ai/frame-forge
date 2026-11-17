"""Banner templates (T-506; R-44, R-46, R-47): the add/list/retire command and the two routes.

Clips are generated with ffmpeg into temp folders. Free: no network, no paid service. Skipped when
ffmpeg or ffprobe is missing."""

import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.main import create_app
from app.templates import cli
from tests.test_media import make_clip

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are needed for the template tests",
)


@pytest.fixture
def settings(tmp_path, database_url) -> Settings:
    return replace(
        Settings(), provider="mock", data_dir=tmp_path / "data", database_url=database_url
    )


@pytest.fixture
def engine(database_url):
    e = create_engine(database_url, poolclass=NullPool)
    yield e
    e.dispose()


@pytest.fixture
def run(settings, engine):
    def go(*argv: str) -> int:
        return cli.main(list(argv), engine=engine, settings=settings)

    return go


def clip(tmp_path: Path, name: str, duration: float, audio=(48000, 2)) -> Path:
    return make_clip(
        tmp_path / name, size="320x180", fps="25", duration=duration, colour="red", audio=audio
    )


def rows(engine):
    with engine.connect() as conn:
        return conn.execute(text("SELECT * FROM templates ORDER BY name")).mappings().all()


def test_add_accepts_a_good_clip(run, engine, settings, tmp_path, capsys):
    """R-44: duration_ms and has_audio come from the measurement; the file is copied."""
    good = clip(tmp_path, "a.mp4", 1.0)
    assert run("add", "--kind", "start", "--name", "Festive opening", str(good)) == 0
    template_id = capsys.readouterr().out.strip()
    (row,) = rows(engine)
    assert row["id"] == template_id and row["kind"] == "start" and row["active"] is True
    assert row["has_audio"] is True and abs(row["duration_ms"] - 1000) < 150
    assert row["clip_file"] == row["preview_file"] == f"{template_id}.mp4"
    assert (settings.data_dir / "templates" / row["clip_file"]).is_file()

    quiet = clip(tmp_path, "b.mp4", 0.5, audio=None)
    assert run("add", "--kind", "end", "--name", "Quiet", str(quiet)) == 0
    assert [r["has_audio"] for r in rows(engine)] == [True, False]


def test_add_refuses_and_writes_nothing(run, engine, settings, tmp_path, capsys):
    """R-44: not a video, too long, no picture, unknown kind: exit 2, no row, no file."""
    junk = tmp_path / "junk.mp4"
    junk.write_bytes(b"this is not a video")
    long_clip = clip(tmp_path, "long.mp4", 6.0)  # over max_template_seconds (5.0)
    good = clip(tmp_path, "ok.mp4", 0.5)
    audio_only = tmp_path / "a.m4a"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi"]
        + ["-i", "sine=duration=1", str(audio_only)],
        check=True,
    )
    for path in (junk, long_clip, audio_only, tmp_path / "missing.mp4"):
        assert run("add", "--kind", "start", "--name", "X", str(path)) == 2, path
    with pytest.raises(SystemExit) as exc:
        run("add", "--kind", "middle", "--name", "X", str(good))
    assert exc.value.code == 2
    assert rows(engine) == []
    folder = settings.data_dir / "templates"
    assert not folder.exists() or list(folder.iterdir()) == []
    assert "Refused" in capsys.readouterr().err


def test_list_and_retire(run, engine, tmp_path, capsys):
    """R-46: list shows active only, start then end by name; retire sets active=false and keeps
    the row."""
    one = clip(tmp_path, "c.mp4", 0.5)
    for kind, name in (("end", "Alpha end"), ("start", "Zed start"), ("start", "Beta start")):
        assert run("add", "--kind", kind, "--name", name, str(one)) == 0
    ids = {r["name"]: r["id"] for r in rows(engine)}
    capsys.readouterr()
    run("list")
    names = [line.split("  ")[-1] for line in capsys.readouterr().out.strip().splitlines()]
    assert names == ["Beta start", "Zed start", "Alpha end"]
    assert run("retire", ids["Beta start"]) == 0
    assert run("retire", ids["Beta start"]) == 2  # already retired
    assert run("retire", "nope") == 2
    capsys.readouterr()
    run("list")
    assert "Beta start" not in capsys.readouterr().out
    assert len(rows(engine)) == 3


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings, start_poller=False), base_url="https://testserver") as c:
        yield c


def test_routes_list_and_preview(client, run, engine, settings, tmp_path, sign_up):
    """R-46, R-47: list is active only, start then end by name; preview streams the file; a
    retired or unknown template is 404 template_not_found; anonymous is 401."""
    assert client.get("/api/v1/templates").status_code == 401
    sign_up(client)
    one = clip(tmp_path, "d.mp4", 0.5)
    for kind, name in (("end", "B end"), ("start", "A start")):
        assert run("add", "--kind", kind, "--name", name, str(one)) == 0
    ids = {r["name"]: r["id"] for r in rows(engine)}
    items = client.get("/api/v1/templates").json()["items"]
    assert [i["name"] for i in items] == ["A start", "B end"]
    first = items[0]
    assert first["preview_url"] == f"/api/v1/templates/{first['id']}/preview"
    assert first["has_audio"] is True and first["kind"] == "start"

    r = client.get(first["preview_url"])
    assert r.status_code == 200 and r.headers["content-type"] == "video/mp4"
    assert r.content == (settings.data_dir / "templates" / f"{first['id']}.mp4").read_bytes()

    run("retire", ids["A start"])
    assert [i["name"] for i in client.get("/api/v1/templates").json()["items"]] == ["B end"]
    for bad in (ids["A start"], "unknown"):
        r = client.get(f"/api/v1/templates/{bad}/preview")
        assert r.status_code == 404 and r.json()["code"] == "template_not_found"
