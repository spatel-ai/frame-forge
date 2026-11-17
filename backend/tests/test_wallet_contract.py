"""The M3 wallet and pricing contract (T-300) stays as agreed. R-04, R-09, R-13.

Needs no database: reads the OpenAPI document only."""

from app.main import create_app


def _openapi():
    return create_app().openapi()


def test_wallet_routes_match_the_contract():
    """R-13: the wallet routes exist, need a session, and the transactions list pages."""
    paths = _openapi()["paths"]
    assert set(paths["/api/v1/wallet"]["get"]["responses"]) >= {"200", "401"}
    tx = paths["/api/v1/wallet/transactions"]["get"]
    assert set(tx["responses"]) >= {"200", "401", "422"}
    assert {p["name"] for p in tx["parameters"]} == {"page", "page_size"}


def test_charging_routes_document_insufficient_credits():
    """R-09: create and approve can answer 402 insufficient_credits."""
    paths = _openapi()["paths"]
    assert "402" in paths["/api/v1/jobs"]["post"]["responses"]
    assert "402" in paths["/api/v1/jobs/{job_id}/approve"]["post"]["responses"]


def test_prices_are_credits_and_the_company_cost_is_never_sent():
    """R-09: config and job carry credit prices; no USD cost field reaches the browser."""
    schemas = _openapi()["components"]["schemas"]
    config = schemas["ConfigOut"]["properties"]
    job = schemas["JobOut"]["properties"]
    assert {"credits_per_second", "voice_price_credits"} <= set(config)
    assert {"price_credits", "charged_credits"} <= set(job)
    for props in (config, job):
        assert not any("usd" in name for name in props)


def test_wallet_shape():
    """R-04: balance, reserved and available, all integers."""
    wallet = _openapi()["components"]["schemas"]["WalletOut"]["properties"]
    assert {k: v["type"] for k, v in wallet.items()} == {
        "balance_credits": "integer",
        "reserved_credits": "integer",
        "available_credits": "integer",
    }


def test_ledger_entry_shows_both_changes():
    """R-13: an entry carries its balance and reserved changes, so the page never computes."""
    entry = _openapi()["components"]["schemas"]["LedgerEntryOut"]["properties"]
    assert {"credits", "reserved_delta", "balance_after", "reserved_after"} <= set(entry)
