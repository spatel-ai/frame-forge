"""T-501: GET /api/v1/jobs, the caller's video history (R-13; R-12 for ownership).

Jobs are written straight into the store so each test controls status, script and age.
Mock provider only; free; no network."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import Settings
from app.main import create_app

HTTPS = "https://testserver"
IN_PROGRESS = (
    "audio_generating",
    "audio_ready",
    "video_submitting",
    "video_generating",
    "video_assembling",
)


@pytest.fixture
def anon(tmp_path, database_url):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as c:
        yield c


@pytest.fixture
def alice(anon, make_user):
    return make_user(anon, "alice@example.com")


@pytest.fixture
def bob(anon, make_user):
    return make_user(anon, "bob@example.com")


def add(
    client: TestClient,
    user_id: str | None,
    job_id: str,
    script: str = "Hello there.",
    status: str = "audio_ready",
    age_minutes: int = 0,
) -> None:
    """Insert a job `age_minutes` old; a larger age is older."""
    store = client.app.state.service.store  # type: ignore[attr-defined]
    store.create(job_id, user_id, "English", script, "image.png")
    with store.engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE jobs SET user_id = :u, status = :s, "
                "created_at = now() - make_interval(mins => :m) WHERE id = :i"
            ),
            {"u": user_id, "s": status, "m": age_minutes, "i": job_id},
        )


def ids(r) -> list[str]:
    assert r.status_code == 200, r.text
    return [j["id"] for j in r.json()["items"]]


def test_anonymous_gets_401(anon):
    """R-13: the list needs a session."""
    r = anon.get("/api/v1/jobs")
    assert r.status_code == 401
    assert r.json()["code"] == "not_authenticated"


def test_only_the_callers_jobs_appear(anon, alice, bob):
    """R-12: another user's jobs and jobs with no owner never appear, and never count."""
    add(anon, alice.user_id, "a1")
    add(anon, bob.user_id, "b1")
    add(anon, None, "orphan")
    r = alice.get("/api/v1/jobs")
    assert ids(r) == ["a1"]
    assert r.json()["total"] == 1
    assert ids(bob.get("/api/v1/jobs")) == ["b1"]


def test_empty_history(alice):
    """R-13: a user with no jobs gets an empty page, not an error."""
    r = alice.get("/api/v1/jobs")
    assert r.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}


def test_newest_first_with_id_tiebreak(anon, alice):
    """R-13: created_at descending; equal times fall back to id descending."""
    add(anon, alice.user_id, "old", age_minutes=30)
    add(anon, alice.user_id, "new", age_minutes=1)
    add(anon, alice.user_id, "mid", age_minutes=10)
    assert ids(alice.get("/api/v1/jobs")) == ["new", "mid", "old"]
    with anon.app.state.service.store.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("UPDATE jobs SET created_at = '2026-01-01T00:00:00Z'"))
    assert ids(alice.get("/api/v1/jobs")) == ["old", "new", "mid"]


def test_status_filters_and_totals(anon, alice, bob):
    """R-13: ready is completed, in_progress is the five working statuses, failed is failed;
    total follows the filter."""
    for n, status in enumerate(IN_PROGRESS):
        add(anon, alice.user_id, f"p{n}", status=status, age_minutes=n)
    add(anon, alice.user_id, "done1", status="completed", age_minutes=20)
    add(anon, alice.user_id, "done2", status="completed", age_minutes=21)
    add(anon, alice.user_id, "bad", status="failed", age_minutes=22)
    add(anon, bob.user_id, "bobdone", status="completed")

    def listed(status: str):
        r = alice.get("/api/v1/jobs", params={"status": status})
        return set(ids(r)), r.json()["total"]

    assert listed("all") == ({f"p{n}" for n in range(5)} | {"done1", "done2", "bad"}, 8)
    assert listed("ready") == ({"done1", "done2"}, 2)
    assert listed("in_progress") == ({f"p{n}" for n in range(5)}, 5)
    assert listed("failed") == ({"bad"}, 1)


def test_search_is_case_insensitive_and_scoped(anon, alice, bob):
    """R-13: substring match on the script, ignoring case; only the caller's jobs are searched
    (R-12)."""
    add(anon, alice.user_id, "j1", script="Welcome to the Spring SALE", age_minutes=2)
    add(anon, alice.user_id, "j2", script="Goodbye", age_minutes=1)
    add(anon, bob.user_id, "j3", script="spring sale for bob")
    r = alice.get("/api/v1/jobs", params={"q": "spring sale"})
    assert ids(r) == ["j1"]
    assert r.json()["total"] == 1


def test_search_treats_percent_and_underscore_literally(anon, alice):
    """R-13: `%` and `_` are not LIKE wildcards."""
    add(anon, alice.user_id, "pct", script="Save 50% today", age_minutes=3)
    add(anon, alice.user_id, "und", script="my_name is Sam", age_minutes=2)
    add(anon, alice.user_id, "plain", script="Save 50 dollars; myXname", age_minutes=1)
    assert ids(alice.get("/api/v1/jobs", params={"q": "50%"})) == ["pct"]
    assert ids(alice.get("/api/v1/jobs", params={"q": "my_name"})) == ["und"]
    assert ids(alice.get("/api/v1/jobs", params={"q": "%"})) == ["pct"]
    assert ids(alice.get("/api/v1/jobs", params={"q": "_"})) == ["und"]


def test_search_and_status_combine(anon, alice):
    """R-13: filters apply together and the total matches both."""
    add(anon, alice.user_id, "a", script="promo one", status="completed", age_minutes=2)
    add(anon, alice.user_id, "b", script="promo two", status="failed", age_minutes=1)
    r = alice.get("/api/v1/jobs", params={"q": "promo", "status": "failed"})
    assert ids(r) == ["b"]
    assert r.json()["total"] == 1


def test_paging_and_beyond_the_end(anon, alice):
    """R-13: pages slice the newest-first list; past the end gives no items and the true total."""
    for n in range(5):
        add(anon, alice.user_id, f"j{n}", age_minutes=n)
    p1 = alice.get("/api/v1/jobs", params={"page": 1, "page_size": 2})
    p3 = alice.get("/api/v1/jobs", params={"page": 3, "page_size": 2})
    p9 = alice.get("/api/v1/jobs", params={"page": 9, "page_size": 2})
    assert ids(p1) == ["j0", "j1"]
    assert ids(p3) == ["j4"]
    assert p1.json()["total"] == 5
    assert p9.json() == {"items": [], "total": 5, "page": 9, "page_size": 2}


def test_summary_fields(anon, alice):
    """R-13: script_excerpt is the first 120 characters; failure_kind follows the stored job."""
    add(anon, alice.user_id, "long", script="x" * 300, age_minutes=2)
    add(anon, alice.user_id, "bad", status="failed", age_minutes=1)
    items = {j["id"]: j for j in alice.get("/api/v1/jobs").json()["items"]}
    assert items["long"]["script_excerpt"] == "x" * 120
    assert items["long"]["failure_kind"] is None
    assert items["bad"]["failure_kind"] == "voice_failed"  # failed with no audio file
    assert set(items["long"]) == {
        "id",
        "status",
        "language",
        "script_excerpt",
        "audio_duration_seconds",
        "failure_kind",
        "created_at",
        "updated_at",
    }


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page_size": 0},
        {"page_size": 101},
        {"status": "done"},
        {"q": "x" * 201},
    ],
)
def test_bad_query_values_are_422(alice, params):
    """R-13: out-of-range or unknown query values are a 422 in the house error shape."""
    r = alice.get("/api/v1/jobs", params=params)
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "validation_error"
