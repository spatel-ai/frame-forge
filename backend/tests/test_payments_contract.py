"""The M4 payments contract (T-400) and the payment settings (D-042). R-02, R-03.

Needs no database: reads the OpenAPI document and builds Settings only. No network."""

from dataclasses import replace

import pytest

from app.core.config import Settings
from app.main import create_app

TEST_KEY = "rzp_test_" + "a" * 14


def _openapi(settings: Settings | None = None):
    return create_app(settings).openapi()


def test_payment_routes_match_the_contract():
    """R-02: create order, order status, verify and the webhook exist with their error codes."""
    paths = _openapi()["paths"]
    assert set(paths["/api/v1/payments/orders"]["post"]["responses"]) >= {
        "201",
        "401",
        "403",
        "422",
        "502",
    }
    assert set(paths["/api/v1/payments/orders/{order_id}"]["get"]["responses"]) >= {
        "200",
        "401",
        "404",
    }
    assert set(paths["/api/v1/payments/verify"]["post"]["responses"]) >= {
        "200",
        "400",
        "401",
        "404",
        "409",
        "502",
    }
    assert set(paths["/api/v1/webhooks/razorpay"]["post"]["responses"]) >= {"200", "400"}
    # D-060: the browser reads the fee from the server instead of computing money.
    assert set(paths["/api/v1/payments/quote"]["get"]["responses"]) >= {"200", "401", "422"}


def test_order_and_quote_carry_the_fee_in_integer_paise():
    """R-02, D-060: the order and the quote show price, fee, GST on the fee and the total, all
    integers."""
    schemas = _openapi()["components"]["schemas"]
    parts = {"price_paise", "fee_paise", "fee_gst_paise", "amount_paise"}
    for name in ("OrderOut", "QuoteOut"):
        props = schemas[name]["properties"]
        assert parts <= set(props), name
        assert {props[k]["type"] for k in parts | {"credits"}} == {"integer"}, name


def test_money_fields_are_integers():
    """R-02, D-047: credits and paise are integers (D-014); no float reaches the contract."""
    schemas = _openapi()["components"]["schemas"]
    assert set(schemas["CreateOrderIn"]["properties"]) == {"credits"}  # D-047: never rupees
    assert schemas["CreateOrderIn"]["properties"]["credits"]["type"] == "integer"
    order = schemas["OrderOut"]["properties"]
    assert {order[k]["type"] for k in ("amount_paise", "credits")} == {"integer"}
    status = schemas["OrderStatusOut"]["properties"]
    assert status["credits"]["type"] == "integer"
    assert "rupees" not in status


def test_verify_takes_our_order_id_and_no_amount():
    """R-03: the browser sends our order id and Razorpay's proof, never an amount or a credit."""
    verify = _openapi()["components"]["schemas"]["VerifyIn"]["properties"]
    assert set(verify) == {"order_id", "razorpay_payment_id", "razorpay_signature"}


def test_no_secret_in_any_response_shape():
    """R-03: only the public key id may reach the browser."""
    schemas = _openapi()["components"]["schemas"]
    for name, schema in schemas.items():
        for prop in schema.get("properties", {}):
            assert "secret" not in prop, f"{name}.{prop}"


def test_mock_checkout_exists_only_in_mock_development():
    """R-03, D-042: the stand-in for Razorpay Checkout is absent outside mock development."""
    path = "/api/v1/payments/mock/complete"
    assert (
        path in _openapi(replace(Settings(), payments="mock", environment="development"))["paths"]
    )
    assert (
        path not in _openapi(replace(Settings(), payments="mock", environment="staging"))["paths"]
    )
    live = replace(
        Settings(),
        payments="razorpay",
        razorpay_key_id=TEST_KEY,
        razorpay_key_secret="s",
        razorpay_webhook_secret="w",
    )
    assert path not in _openapi(live)["paths"]


def test_payments_default_to_mock(monkeypatch):
    """D-042: with AVATAR_PAYMENTS unset, payments are mock and make no network call."""
    monkeypatch.delenv("AVATAR_PAYMENTS", raising=False)
    assert Settings().payments == "mock"


@pytest.mark.parametrize("missing", ["razorpay_key_id", "razorpay_key_secret"])
def test_razorpay_mode_refuses_to_start_without_every_value(missing):
    """D-042: razorpay mode with an empty key id or key secret refuses to start."""
    values = {
        "razorpay_key_id": TEST_KEY,
        "razorpay_key_secret": "s",
        "razorpay_webhook_secret": "w",
    }
    values[missing] = ""
    with pytest.raises(ValueError, match="needs"):
        replace(Settings(), payments="razorpay", **values)


@pytest.mark.parametrize("environment", ["development", "staging", ""])
def test_a_non_test_key_is_refused_outside_production(environment):
    """D-042: outside production only a test key runs, so no real money can move."""
    with pytest.raises(ValueError, match="not a test key"):
        replace(
            Settings(),
            environment=environment,
            payments="razorpay",
            razorpay_key_id="rzp_live_" + "b" * 14,
            razorpay_key_secret="s",
            razorpay_webhook_secret="w",
        )


def test_a_test_key_starts_in_development():
    """D-042: a test key with both secrets is accepted in development."""
    s = replace(
        Settings(),
        environment="development",
        payments="razorpay",
        razorpay_key_id=TEST_KEY,
        razorpay_key_secret="s",
        razorpay_webhook_secret="w",
    )
    assert s.payments == "razorpay"


def test_secrets_never_appear_in_repr():
    """R-03: the key secret and webhook secret are kept out of repr(), so logs cannot carry them."""
    s = replace(
        Settings(),
        razorpay_key_secret="TOP-SECRET-KEY",
        razorpay_webhook_secret="TOP-SECRET-HOOK",
    )
    assert "TOP-SECRET" not in repr(s)


def test_unknown_payments_mode_is_refused():
    """D-042: a typo in AVATAR_PAYMENTS stops the app instead of guessing."""
    with pytest.raises(ValueError, match="AVATAR_PAYMENTS"):
        replace(Settings(), payments="razorpy")


def test_config_tells_the_browser_the_payment_mode_and_limits():
    """R-02: config carries the mode, the public key id and the purchase limits (Q-06)."""
    config = _openapi()["components"]["schemas"]["ConfigOut"]["properties"]
    assert {
        "payments",
        "razorpay_key_id",
        "min_purchase_credits",
        "max_purchase_credits",
        "payment_fee_bps",
        "payment_fee_gst_bps",
    } <= set(config)
    assert Settings().min_purchase_credits == 1_000  # D-059
    assert Settings().max_purchase_credits == 10_000


def test_fee_settings_default_and_validation(monkeypatch):
    """R-02, D-062: Razorpay's Standard rate, 200 bps (2%) with 18% GST on it, by default; both
    must be whole numbers of 0 or more, and together below 100%."""
    monkeypatch.delenv("AVATAR_PAYMENT_FEE_BPS", raising=False)
    monkeypatch.delenv("AVATAR_PAYMENT_FEE_GST_BPS", raising=False)
    s = Settings()
    assert (s.payment_fee_bps, s.payment_fee_gst_bps) == (200, 1800)
    monkeypatch.setenv("AVATAR_PAYMENT_FEE_GST_BPS", "0")
    assert Settings().payment_fee_gst_bps == 0
    for bad in (-1, 2.5, True):
        with pytest.raises(ValueError, match="basis points"):
            replace(Settings(), payment_fee_bps=bad)
    with pytest.raises(ValueError, match="below 100%"):
        replace(Settings(), payment_fee_bps=10_000)


def test_config_hides_the_key_id_in_mock_mode(tmp_path, database_url):
    """R-03, D-042: in mock mode the browser gets no Razorpay key id, even if one is set, and no
    secret ever appears in the config answer."""
    from fastapi.testclient import TestClient

    settings = replace(
        Settings(),
        provider="mock",
        payments="mock",
        data_dir=tmp_path,
        database_url=database_url,
        razorpay_key_id=TEST_KEY,
        razorpay_key_secret="TOP-SECRET-KEY",
        razorpay_webhook_secret="TOP-SECRET-HOOK",
    )
    with TestClient(create_app(settings, start_poller=False), base_url="https://testserver") as c:
        r = c.get("/api/v1/config")
    assert r.status_code == 200
    body = r.json()
    assert (body["payments"], body["razorpay_key_id"]) == ("mock", None)
    assert (body["min_purchase_credits"], body["max_purchase_credits"]) == (1_000, 10_000)
    assert "TOP-SECRET" not in r.text


def test_support_email_comes_from_the_setting(tmp_path, database_url):
    """D-055: config returns the support address when set, and null when it is empty."""
    from fastapi.testclient import TestClient

    for value, expected in (("", None), ("help@example.com", "help@example.com")):
        settings = replace(
            Settings(),
            provider="mock",
            data_dir=tmp_path,
            database_url=database_url,
            support_email=value,
        )
        with TestClient(
            create_app(settings, start_poller=False), base_url="https://testserver"
        ) as c:
            assert c.get("/api/v1/config").json()["support_email"] == expected


def test_mock_payments_are_refused_in_production():
    """D-042: production never runs the mock gateway, whose checkout secret is public."""
    with pytest.raises(ValueError, match="not allowed in production"):
        replace(Settings(), environment="production", payments="mock")


def test_razorpay_mode_starts_without_a_webhook_secret():
    """D-064: the webhook is optional; razorpay mode starts with only the key id and secret."""
    s = replace(
        Settings(),
        payments="razorpay",
        razorpay_key_id=TEST_KEY,
        razorpay_key_secret="s",
        razorpay_webhook_secret="",
    )
    assert s.payments == "razorpay" and s.razorpay_webhook_secret == ""
