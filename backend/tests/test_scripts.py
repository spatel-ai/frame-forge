"""T-504: the script library (R-43, R-50; R-12 for owner-only access).

Mock provider only; free; no network. Service tests use a connection per call, as job creation
will (T-505)."""

import threading
from dataclasses import replace
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.main import create_app
from app.scripts import service

HTTPS = "https://testserver"


@pytest.fixture
def client(tmp_path, database_url):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as c:
        yield c


@pytest.fixture
def engine(client):
    return client.app.state.service.store.engine


@pytest.fixture
def uid(client, sign_up):
    return sign_up(client)


def save(engine, user_id, language, body):
    with engine.begin() as conn:
        return service.save_or_touch(conn, user_id, language, body)


def rows(engine, user_id):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT * FROM scripts WHERE user_id = :u ORDER BY created_at"), {"u": user_id}
        ).all()


def test_same_text_twice_is_one_row_and_touches_last_used(engine, uid):
    """R-43: saving the same text and language again keeps one row and moves last_used_at."""
    a = save(engine, uid, "English", "Hello there.")
    first = rows(engine, uid)[0].last_used_at
    b = save(engine, uid, "English", "Hello there.")
    assert a == b
    got = rows(engine, uid)
    assert len(got) == 1 and got[0].last_used_at > first
    assert got[0].created_at < got[0].last_used_at


def test_other_language_or_text_is_a_separate_row(engine, uid):
    """R-43: language is part of the identity; so is the exact text."""
    a = save(engine, uid, "English", "Hello there.")
    b = save(engine, uid, "Hindi", "Hello there.")
    c = save(engine, uid, "English", "Hello there")
    assert len({a, b, c}) == 3 and len(rows(engine, uid)) == 3


def test_deleted_script_can_be_saved_again_as_a_new_row(client, engine, uid):
    """R-50: delete is soft; the same text saved later is a new live row."""
    a = save(engine, uid, "English", "Hello there.")
    assert client.delete(f"/api/v1/scripts/{a}").status_code == 204
    assert client.get(f"/api/v1/scripts/{a}").status_code == 404
    b = save(engine, uid, "English", "Hello there.")
    assert a != b
    assert len(rows(engine, uid)) == 2
    assert [i["id"] for i in client.get("/api/v1/scripts").json()["items"]] == [b]


def test_list_order_search_filter_and_paging(client, engine, uid):
    """R-43: most recently used first; q is a case-insensitive substring with wildcards taken
    literally; language is exact; paging reports totals."""
    a = save(engine, uid, "English", "Welcome to the Spring sale")
    b = save(engine, uid, "Hindi", "100% off today_only")
    c = save(engine, uid, "English", "Goodbye for now")
    save(engine, uid, "English", "Welcome to the Spring sale")  # touch a: now newest
    body = client.get("/api/v1/scripts").json()
    assert [i["id"] for i in body["items"]] == [a, c, b]
    assert body["total"] == 3 and body["page"] == 1 and body["page_size"] == 20
    datetime.fromisoformat(body["items"][0]["last_used_at"])
    assert body["items"][0]["last_used_at"].endswith("+00:00")

    def ids(**params):
        return [i["id"] for i in client.get("/api/v1/scripts", params=params).json()["items"]]

    assert ids(q="SPRING") == [a]
    assert ids(q="%") == [b]  # a literal percent sign, not "match everything"
    assert ids(q="_") == [b]
    assert ids(q="o_o") == []
    assert ids(language="Hindi") == [b]
    assert ids(language="English", q="good") == [c]
    assert ids(language="english") == []
    page2 = client.get("/api/v1/scripts", params={"page": 2, "page_size": 2}).json()
    assert [i["id"] for i in page2["items"]] == [b] and page2["total"] == 3
    assert client.get("/api/v1/scripts", params={"page_size": 101}).status_code == 422


def test_only_the_owner_can_list_read_or_delete(client, engine, uid, sign_up):
    """R-12: another user sees none of it; 404 script_not_found, never 403."""
    sid = save(engine, uid, "English", "Private words")
    with TestClient(client.app, base_url=HTTPS) as other:
        sign_up(other, "other@example.com")
        assert other.get("/api/v1/scripts").json() == {
            "items": [],
            "total": 0,
            "page": 1,
            "page_size": 20,
        }
        for r in (other.get(f"/api/v1/scripts/{sid}"), other.delete(f"/api/v1/scripts/{sid}")):
            assert r.status_code == 404 and r.json()["code"] == "script_not_found"
    got = client.get(f"/api/v1/scripts/{sid}")
    assert got.status_code == 200 and got.json()["text"] == "Private words"
    assert client.get("/api/v1/scripts/nope").json()["code"] == "script_not_found"
    assert client.delete("/api/v1/scripts/nope").status_code == 404


def test_delete_never_touches_jobs(client, engine, uid):
    """R-50: a job keeps its own script text when the saved script is deleted."""
    sid = save(engine, uid, "English", "Hello.")
    with engine.connect() as conn:
        before = conn.execute(text("SELECT count(*) FROM jobs")).scalar_one()
    assert client.delete(f"/api/v1/scripts/{sid}").status_code == 204
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM jobs")).scalar_one() == before


def test_concurrent_save_of_the_same_text_makes_one_row(database_url, client, uid):
    """R-43: eight threads, one connection each, released together by a barrier, save the same
    text; exactly one row exists and every thread got its id."""
    n = 8
    barrier = threading.Barrier(n)
    ids: list[str] = []
    errors: list[BaseException] = []

    def work():
        eng = create_engine(database_url, poolclass=NullPool)
        try:
            with eng.connect() as conn:
                barrier.wait(timeout=10)
                ids.append(service.save_or_touch(conn, uid, "English", "Race me."))
                conn.commit()
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            eng.dispose()

    threads = [threading.Thread(target=work) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    eng = create_engine(database_url, poolclass=NullPool)
    try:
        assert len(rows(eng, uid)) == 1
    finally:
        eng.dispose()
    assert len(ids) == n and len(set(ids)) == 1
