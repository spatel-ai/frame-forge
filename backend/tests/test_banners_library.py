"""The customer's banner library (D-067; R-12 owner-only access, customer rule 5 re-encoding).

Mock provider only; free; no network."""

from dataclasses import replace
from datetime import datetime
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.banners import service
from app.core.config import Settings
from app.main import create_app

HTTPS = "https://testserver"


@pytest.fixture
def client(tmp_path, database_url):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as c:
        yield c


@pytest.fixture
def uid(client, sign_up):
    return sign_up(client)


def image_bytes(
    fmt: str = "PNG",
    size: tuple[int, int] = (300, 240),
    mode: str = "RGBA",
    colour=(200, 10, 10, 128),
) -> bytes:
    out = BytesIO()
    Image.new(mode, size, colour if mode == "RGBA" else colour[:3]).save(out, fmt)
    return out.getvalue()


def upload(client, name="Spring logo", data: bytes | None = None, filename="logo.png"):
    return client.post(
        "/api/v1/banners",
        data={"name": name},
        files={"image": (filename, data if data is not None else image_bytes(), "image/png")},
    )


def files_under(root: Path) -> list[Path]:
    return (
        [p for p in (root / "banners").rglob("*") if p.is_file()]
        if (root / "banners").exists()
        else []
    )


def test_upload_is_listed_and_served_with_alpha_kept(client, uid, tmp_path) -> None:
    """D-067: a PNG with transparency is stored as PNG with its alpha."""
    r = upload(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Spring logo"
    assert body["image_url"] == f"/api/v1/banners/{body['id']}/image"
    datetime.fromisoformat(body["created_at"])
    assert body["created_at"].endswith("+00:00") and "." not in body["created_at"]
    assert [i["id"] for i in client.get("/api/v1/banners").json()["items"]] == [body["id"]]
    img = client.get(body["image_url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    with Image.open(BytesIO(img.content)) as im:
        assert im.format == "PNG" and im.mode == "RGBA" and im.size == (300, 240)
        assert im.getpixel((0, 0))[3] == 128
    assert files_under(tmp_path) == [tmp_path / "banners" / uid / f"{body['id']}.png"]


def test_jpeg_and_webp_are_reencoded_as_png_and_name_is_stripped(client, uid) -> None:
    for fmt in ("JPEG", "WEBP"):
        r = upload(
            client, name="  Logo  ", data=image_bytes(fmt, mode="RGB", colour=(1, 2, 3, 255))
        )
        assert r.status_code == 201, r.text
        assert r.json()["name"] == "Logo"
        with Image.open(BytesIO(client.get(r.json()["image_url"]).content)) as im:
            assert im.format == "PNG"


def test_list_is_newest_first(client, uid) -> None:
    ids = [upload(client, name=f"b{i}").json()["id"] for i in range(3)]
    assert [i["id"] for i in client.get("/api/v1/banners").json()["items"]] == ids[::-1]


def test_other_user_gets_404_and_empty_list(client, uid, sign_up) -> None:
    """R-12: another user's banner is 404 banner_not_found, never 403."""
    bid = upload(client).json()["id"]
    with TestClient(client.app, base_url=HTTPS) as other:
        sign_up(other, "other@example.com")
        assert other.get("/api/v1/banners").json() == {"items": []}
        for r in (
            other.get(f"/api/v1/banners/{bid}/image"),
            other.delete(f"/api/v1/banners/{bid}"),
        ):
            assert r.status_code == 404 and r.json()["code"] == "banner_not_found"
    assert client.get(f"/api/v1/banners/{bid}/image").status_code == 200


def test_delete_hides_the_banner_but_keeps_the_file(client, uid, tmp_path) -> None:
    bid = upload(client).json()["id"]
    assert client.delete(f"/api/v1/banners/{bid}").status_code == 204
    assert client.get("/api/v1/banners").json() == {"items": []}
    for r in (client.get(f"/api/v1/banners/{bid}/image"), client.delete(f"/api/v1/banners/{bid}")):
        assert r.status_code == 404 and r.json()["code"] == "banner_not_found"
    assert len(files_under(tmp_path)) == 1
    engine = client.app.state.service.store.engine
    assert service.get_owned_file(engine, uid, bid, tmp_path) is None
    assert client.get("/api/v1/banners/nope/image").json()["code"] == "banner_not_found"


def test_get_owned_file_returns_the_owners_path_only(client, uid, tmp_path) -> None:
    bid = upload(client).json()["id"]
    engine = client.app.state.service.store.engine
    path = service.get_owned_file(engine, uid, bid, tmp_path)
    assert path == tmp_path / "banners" / uid / f"{bid}.png" and path.is_file()
    assert service.get_owned_file(engine, "someone-else", bid, tmp_path) is None


@pytest.mark.parametrize(
    ("name", "data", "field"),
    [
        ("", None, "name"),
        ("   ", None, "name"),
        ("x" * 61, None, "name"),
        ("ok", image_bytes(size=(199, 300)), "image"),
        ("ok", image_bytes(size=(300, 199)), "image"),
        ("ok", image_bytes(size=(4001, 300), mode="RGB", colour=(1, 1, 1, 1)), "image"),
        ("ok", image_bytes("GIF", mode="RGB", colour=(1, 1, 1, 1)), "image"),
        ("ok", b"this is not an image", "image"),
        ("ok", b"", "image"),
        ("ok", b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024 + 10), "image"),
    ],
    ids=[
        "empty-name",
        "blank-name",
        "long-name",
        "narrow",
        "short",
        "too-wide",
        "gif",
        "not-an-image",
        "empty-file",
        "over-5mb",
    ],
)
def test_refusals_are_plain_422_and_write_nothing(client, uid, tmp_path, name, data, field) -> None:
    r = upload(client, name=name, data=data)
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error" and field in body["fields"]
    assert body["fields"][field]  # a plain message under the field at fault
    assert client.get("/api/v1/banners").json() == {"items": []}
    assert files_under(tmp_path) == []


def test_both_fields_are_reported_together(client, uid) -> None:
    r = upload(client, name="   ", data=b"junk")
    assert set(r.json()["fields"]) == {"name", "image"}


def test_boundary_sizes_are_accepted(client, uid) -> None:
    assert upload(client, data=image_bytes(size=(200, 200))).status_code == 201
    assert (
        upload(
            client, data=image_bytes(size=(4000, 200), mode="RGB", colour=(1, 1, 1, 1))
        ).status_code
        == 201
    )
    assert upload(client, name="x" * 60).status_code == 201


def test_at_most_20_live_banners(client, uid, tmp_path) -> None:
    ids = [
        upload(client, name=f"b{i}", data=image_bytes(size=(200, 200))).json()["id"]
        for i in range(20)
    ]
    r = upload(client)
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
    assert "20" in r.json()["detail"]
    assert len(files_under(tmp_path)) == 20
    # Deleting one makes room again.
    assert client.delete(f"/api/v1/banners/{ids[0]}").status_code == 204
    assert upload(client).status_code == 201


def test_anonymous_is_401(client) -> None:
    anon = TestClient(client.app, base_url=HTTPS)
    assert anon.get("/api/v1/banners").status_code == 401
