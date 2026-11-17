"""Wallet routes and the developer grant command (T-306). R-13. Mock only: no network."""

import re
import uuid
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import Settings
from app.main import create_app
from app.wallet import cli
from app.wallet.ledger import WalletStore

ISO_SECONDS = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$")


@pytest.fixture
def app(tmp_path, database_url):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    return create_app(settings, start_poller=False)


@pytest.fixture
def client(app):
    with TestClient(app, base_url="https://testserver") as c:
        yield c


@pytest.fixture
def owner(client, sign_up):
    return sign_up(client, "owner@example.com")


@pytest.fixture
def store(app, client):
    return WalletStore(app.state.service.store.engine)


def test_new_user_wallet_is_zero(client, owner):
    """R-13: a user with no wallet row sees 0, 0, 0."""
    r = client.get("/api/v1/wallet")
    assert r.status_code == 200
    assert r.json() == {"balance_credits": 0, "reserved_credits": 0, "available_credits": 0}
    t = client.get("/api/v1/wallet/transactions").json()
    assert t == {"items": [], "total": 0, "page": 1, "page_size": 20}


def test_wallet_after_grants_and_hold(client, owner, store):
    """R-13: balance, reserved and available follow the ledger."""
    store.grant(owner, 100, uuid.uuid4().hex, "test")
    store.grant(owner, 50, uuid.uuid4().hex, "test")
    store.hold(owner, uuid.uuid4().hex, 40)
    assert client.get("/api/v1/wallet").json() == {
        "balance_credits": 150,
        "reserved_credits": 40,
        "available_credits": 110,
    }


def test_other_user_never_sees_it(client, owner, store, make_user):
    """R-13: another user sees neither this user's balance nor entries."""
    store.grant(owner, 100, uuid.uuid4().hex, "test")
    other = make_user(client, "other@example.com")
    assert other.get("/api/v1/wallet").json()["balance_credits"] == 0
    t = other.get("/api/v1/wallet/transactions").json()
    assert t["items"] == [] and t["total"] == 0
    assert client.get("/api/v1/wallet").json()["balance_credits"] == 100


def test_transactions_newest_first_with_fields(client, owner, store):
    """R-13: newest first; fields match the ledger; job_id None for a grant, set for a job."""
    job = uuid.uuid4().hex
    g = store.grant(owner, 100, uuid.uuid4().hex, "test")
    c = store.voice_charge(owner, job, 10)
    items = client.get("/api/v1/wallet/transactions").json()["items"]
    assert [i["id"] for i in items] == [c.id, g.id]
    assert items[0] == {
        "id": c.id,
        "kind": "voice_charge",
        "credits": -10,
        "reserved_delta": 0,
        "balance_after": 90,
        "reserved_after": 0,
        "job_id": job,
        "created_at": items[0]["created_at"],
    }
    assert items[1]["kind"] == "grant"
    assert items[1]["job_id"] is None
    assert items[1]["credits"] == 100 and items[1]["balance_after"] == 100


def test_created_at_matches_jobs_format(client, owner, store):
    """R-13: created_at is UTC ISO text in whole seconds, as the jobs API's now_iso()."""
    from app.jobs.db import now_iso

    store.grant(owner, 5, uuid.uuid4().hex, "test")
    created = client.get("/api/v1/wallet/transactions").json()["items"][0]["created_at"]
    assert ISO_SECONDS.match(created), created
    assert ISO_SECONDS.match(now_iso())


def test_paging_and_bounds(client, owner, store):
    """R-13: page 2, total, echoed page and page_size; bounds give 422."""
    ids = [store.grant(owner, 1, uuid.uuid4().hex, "test").id for _ in range(5)]
    r = client.get("/api/v1/wallet/transactions?page=2&page_size=2").json()
    assert (r["total"], r["page"], r["page_size"]) == (5, 2, 2)
    assert [i["id"] for i in r["items"]] == [ids[2], ids[1]]
    last = client.get("/api/v1/wallet/transactions?page=3&page_size=2").json()
    assert [i["id"] for i in last["items"]] == [ids[0]]
    for q in ("page_size=101", "page_size=0", "page=0"):
        assert client.get(f"/api/v1/wallet/transactions?{q}").status_code == 422
    assert client.get("/api/v1/wallet/transactions?page_size=100").status_code == 200


def test_anonymous_gets_401(client):
    """R-13: both routes need a session."""
    for path in ("/api/v1/wallet", "/api/v1/wallet/transactions"):
        r = client.get(path)
        assert r.status_code == 401
        assert r.json()["code"] == "not_authenticated"


# ---- the command ---------------------------------------------------------------------


@pytest.fixture
def run_cli(app, database_url, monkeypatch, capsys):
    def run(*argv: str, environment: str = "development"):
        monkeypatch.setattr(
            cli,
            "Settings",
            lambda: replace(Settings(), database_url=database_url, environment=environment),
        )
        try:
            code = cli.main(list(argv))
        except SystemExit as exc:  # argparse refusals
            code = int(exc.code or 0)
        return code, capsys.readouterr()

    return run


def _count(app, table="ledger_entries") -> int:
    with app.state.service.store.engine.connect() as conn:
        return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()


def test_cli_grant_in_development(client, owner, run_cli):
    """R-13: development success prints the balance; the grant shows in the ledger as `grant`."""
    code, out = run_cli("grant", "  OWNER@Example.com ", "75")
    assert code == 0
    assert "Balance: 75" in out.out and "available: 75" in out.out
    t = client.get("/api/v1/wallet/transactions").json()
    assert t["total"] == 1 and t["items"][0]["kind"] == "grant"
    assert t["items"][0]["credits"] == 75 and t["items"][0]["job_id"] is None
    code, out = run_cli("grant", "owner@example.com", "25")
    assert code == 0 and "Balance: 100" in out.out


@pytest.mark.parametrize("environment", ["production", "staging", ""])
def test_cli_refuses_outside_development(client, owner, app, run_cli, environment):
    """R-13: refused with exit 2 and nothing written."""
    code, out = run_cli("grant", "owner@example.com", "10", environment=environment)
    assert code == 2
    assert "development" in out.err
    assert _count(app) == 0 and _count(app, "wallets") == 0


def test_cli_unknown_email(client, owner, app, run_cli):
    """R-13: unknown email exits 1, writes nothing, shows no other user's data."""
    code, out = run_cli("grant", "nobody@example.com", "10")
    assert code == 1
    assert "owner@example.com" not in out.out + out.err
    assert _count(app) == 0


@pytest.mark.parametrize("bad", ["0", "-5", "1.5", "abc", ""])
def test_cli_refuses_bad_credits(client, owner, app, run_cli, bad):
    """R-13: credits must be a positive whole number."""
    code, _ = run_cli("grant", "owner@example.com", bad)
    assert code == 2
    assert _count(app) == 0
