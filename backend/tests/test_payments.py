"""T-402 to T-406: buying credits, in mock mode with signed fixtures. R-02 (a purchase credits the
wallet exactly once, whatever order verify, webhook and reconciliation arrive in) and R-03 (credits
only from server-verified proof, never from the browser's word).

No network: the MockGateway keeps payments in memory, the RazorpayGateway tests use
`httpx.MockTransport`, and webhook signatures are computed here with a test secret set through
`dataclasses.replace(Settings(), ...)`. Signatures are computed independently of the app's code.

The five exit cases (M4-PLAN): normal flow, tab closed before verification, webhook delivered
twice, webhook before the browser's call, failed then successful payment. Race cases are in
test_payments_concurrency.py."""

import hashlib
import hmac
import json
import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import Settings
from app.main import create_app
from app.payments import gateway as gw
from app.payments.gateway import GatewayError, MockGateway, RazorpayGateway
from app.payments.service import quote
from app.wallet import ledger

HTTPS = "https://testserver"
WEBHOOK_SECRET = "whsec_test_only"
MOCK_SECRET = "frameforge-mock-checkout-secret"  # D-042: the mock Checkout's fixed secret


# ---- harness -----------------------------------------------------------------------------


@pytest.fixture
def settings(tmp_path, database_url) -> Settings:
    return replace(
        Settings(),
        provider="mock",
        payments="mock",
        environment="development",
        data_dir=tmp_path,
        database_url=database_url,
        razorpay_webhook_secret=WEBHOOK_SECRET,
        payment_fee_bps=200,
        payment_fee_gst_bps=0,
    )


@pytest.fixture
def client(settings, make_user):
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as anon:
        owner = make_user(anon, "owner@example.com")
        owner.anon = anon  # type: ignore[attr-defined]
        yield owner


def engine_of(c: TestClient):
    return c.app.state.service.store.engine  # type: ignore[attr-defined]


def mock_gateway(c: TestClient) -> MockGateway:
    return c.app.state.payments.gateway  # type: ignore[attr-defined]


def buy(c: TestClient, credits: int = 1000) -> dict:
    r = c.post("/api/v1/payments/orders", json={"credits": credits})
    assert r.status_code == 201, r.text
    return r.json()


def pay(c: TestClient, order_id: str, outcome: str = "captured") -> dict:
    r = c.post("/api/v1/payments/mock/complete", json={"order_id": order_id, "outcome": outcome})
    assert r.status_code == 200, r.text
    return r.json()


def verify(c: TestClient, order_id: str, handler: dict) -> httpx.Response:
    return c.post(
        "/api/v1/payments/verify",
        json={
            "order_id": order_id,
            "razorpay_payment_id": handler["razorpay_payment_id"],
            "razorpay_signature": handler["razorpay_signature"],
        },
    )


def sign(body: bytes, secret: str = WEBHOOK_SECRET) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def event_body(event: str, payment_id: str, order_id: str, amount: int, status: str) -> bytes:
    """A webhook body shaped as RAZORPAY-FACTS §G describes. `captured: true` is set even on
    non-captured payments, as in the docs' samples, so the app must read `status`."""
    payload = {
        "payment": {
            "entity": {
                "id": payment_id,
                "entity": "payment",
                "amount": amount,
                "currency": "INR",
                "status": status,
                "order_id": order_id,
                "captured": True,
            }
        }
    }
    if event == "order.paid":
        payload["order"] = {"entity": {"id": order_id, "amount": amount, "status": "paid"}}
    return json.dumps(
        {
            "entity": "event",
            "account_id": "acc_test",
            "event": event,
            "contains": list(payload),
            "payload": payload,
            "created_at": 1_700_000_000,
        }
    ).encode()


def webhook(
    c: TestClient,
    body: bytes,
    event_id: str | None = None,
    signature: str | None = "auto",
) -> httpx.Response:
    headers = {"Content-Type": "application/json"}
    if signature == "auto":
        signature = sign(body)
    if signature is not None:
        headers["X-Razorpay-Signature"] = signature
    headers["x-razorpay-event-id"] = event_id if event_id is not None else uuid.uuid4().hex
    if event_id == "":
        del headers["x-razorpay-event-id"]
    # The anonymous client: Razorpay has no session.
    return c.anon.post("/api/v1/webhooks/razorpay", content=body, headers=headers)  # type: ignore[attr-defined]


def captured_webhook(c: TestClient, order: dict, handler: dict, event_id=None, event=None):
    payment = mock_gateway(c).fetch_payment(handler["razorpay_payment_id"])
    body = event_body(
        event or "payment.captured",
        payment.id,
        order["razorpay_order_id"],
        payment.amount,
        payment.status,
    )
    return webhook(c, body, event_id)


def purchases(c: TestClient) -> list[tuple]:
    with engine_of(c).connect() as conn:
        return conn.execute(
            text(
                "SELECT user_id, credits, ref_type, ref_id FROM ledger_entries "
                "WHERE kind = 'purchase'"
            )
        ).all()


def balance(c: TestClient) -> int:
    return c.get("/api/v1/wallet").json()["balance_credits"]


def invariant(c: TestClient) -> bool:
    with engine_of(c).connect() as conn:
        return ledger.invariant_holds(conn, c.user_id)  # type: ignore[attr-defined]


def order_status(c: TestClient, order_id: str) -> str:
    return c.get(f"/api/v1/payments/orders/{order_id}").json()["status"]


def assert_credited_once(c: TestClient, order: dict, credits: int = 1000) -> None:
    rows = purchases(c)
    assert len(rows) == 1, rows
    assert rows[0][1] == credits and rows[0][2] == "payment"
    assert balance(c) == credits  # the credits bought, never the fee
    assert order_status(c, order["order_id"]) == "paid"
    assert invariant(c)


# ---- the five purchase cases (M4 exit evidence) ------------------------------------------


def test_case1_normal_flow_credits_once(client):
    """R-02, R-03 (case 1, normal flow + repeat): order → Checkout → verify credits 1,000 once.
    Verify again, and the webhook that follows, change nothing."""
    order = buy(client)
    assert (order["status"], order["key_id"], order["credits"]) == ("created", "mock", 1000)
    handler = pay(client, order["order_id"])
    r = verify(client, order["order_id"], handler)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["credits"]) == ("paid", 1000)
    assert body["wallet"] == {
        "balance_credits": 1000,
        "reserved_credits": 0,
        "available_credits": 1000,
    }
    again = verify(client, order["order_id"], handler)
    assert again.status_code == 200 and again.json() == body
    assert captured_webhook(client, order, handler).status_code == 200
    assert_credited_once(client, order)
    assert purchases(client)[0][3] == handler["razorpay_payment_id"]


def test_case2_tab_closed_the_webhook_credits(client):
    """R-02 (case 2, tab closed before verification): no verify call; the signed
    payment.captured webhook credits the order once."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    r = captured_webhook(client, order, handler)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert_credited_once(client, order)


def test_case2b_tab_closed_and_webhook_missed_reconciliation_credits(client):
    """R-02 (case 2, webhook also missed): reconciliation finds the captured payment after 30
    minutes and credits once; a second run credits nothing."""
    order = buy(client)
    pay(client, order["order_id"])
    service = client.app.state.payments  # type: ignore[attr-defined]
    now = datetime.now(timezone.utc)
    assert service.reconcile_once(now) == 0  # too young: left to verify and the webhook
    assert purchases(client) == []
    later = now + timedelta(minutes=31)
    assert service.reconcile_once(later) == 1
    assert service.reconcile_once(later) == 0
    assert_credited_once(client, order)


def test_case3_webhook_delivered_twice(client):
    """R-02 (case 3): the same event id twice is stored once and credits once; a different event
    for the same payment (order.paid) is a no-op too."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    event_id = "evt_" + uuid.uuid4().hex
    assert captured_webhook(client, order, handler, event_id).status_code == 200
    assert captured_webhook(client, order, handler, event_id).status_code == 200
    assert captured_webhook(client, order, handler, event="order.paid").status_code == 200
    assert_credited_once(client, order)
    with engine_of(client).connect() as conn:
        events = conn.execute(text("SELECT event_id, processed_at FROM webhook_events")).all()
    assert len(events) == 2 and all(e.processed_at is not None for e in events)


def test_case4_webhook_before_verify(client):
    """R-02 (case 4): the webhook credits first; the browser's verify then answers paid with the
    wallet and credits nothing more."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    assert captured_webhook(client, order, handler).status_code == 200
    r = verify(client, order["order_id"], handler)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid" and r.json()["wallet"]["balance_credits"] == 1000
    assert_credited_once(client, order)


def test_case5_failed_then_captured(client):
    """R-02 (case 5): a failed payment gives 409 payment_not_captured and marks the order
    failed, crediting nothing; a payment.failed webhook does the same. A later captured payment
    for the same order still credits once, and a stale payment.failed after that leaves the
    order paid."""
    order = buy(client)
    failed = pay(client, order["order_id"], "failed")
    r = verify(client, order["order_id"], failed)
    assert r.status_code == 409 and r.json()["code"] == "payment_not_captured", r.text
    assert order_status(client, order["order_id"]) == "failed"
    failed_payment = mock_gateway(client).fetch_payment(failed["razorpay_payment_id"])
    failed_body = event_body(
        "payment.failed",
        failed_payment.id,
        order["razorpay_order_id"],
        failed_payment.amount,
        "failed",
    )
    assert webhook(client, failed_body).status_code == 200
    assert purchases(client) == [] and balance(client) == 0

    captured = pay(client, order["order_id"])
    assert captured["razorpay_payment_id"] != failed["razorpay_payment_id"]
    r = verify(client, order["order_id"], captured)
    assert r.status_code == 200 and r.json()["status"] == "paid", r.text
    assert captured_webhook(client, order, captured).status_code == 200
    assert webhook(client, failed_body).status_code == 200  # a new delivery of the stale event
    assert_credited_once(client, order)


# ---- verify: proof comes from the server, never the browser ------------------------------


def test_verify_refuses_a_bad_signature_and_credits_nothing(client):
    """R-03: a signature made with another secret, with Razorpay's order id swapped, or with
    characters that are not even ASCII is 400 payment_signature_invalid; nothing is credited."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    pid = handler["razorpay_payment_id"]
    forged = hmac.new(b"guess", f"{order['razorpay_order_id']}|{pid}".encode(), hashlib.sha256)
    for sig in (forged.hexdigest(), "0" * 64, "é" * 10):
        r = verify(
            client, order["order_id"], {"razorpay_payment_id": pid, "razorpay_signature": sig}
        )
        assert r.status_code == 400 and r.json()["code"] == "payment_signature_invalid", r.text
    # A lone surrogate, sent as a JSON escape (valid JSON, not encodable): refused by input
    # validation before the signature check (whose own guard is defence in depth), never a 500.
    raw = '{"order_id": "%s", "razorpay_payment_id": "%s", "razorpay_signature": "\\ud800"}' % (
        order["order_id"],
        pid,
    )
    r = client.post(
        "/api/v1/payments/verify", content=raw, headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error", r.text
    assert "razorpay_signature" in r.json()["fields"]
    # A valid signature for another order's id does not verify this order.
    other = buy(client)
    other_handler = pay(client, other["order_id"])
    r = verify(client, order["order_id"], other_handler)
    assert r.status_code == 400 and r.json()["code"] == "payment_signature_invalid"
    assert purchases(client) == [] and balance(client) == 0


def test_verify_signature_uses_our_stored_order_id(client):
    """R-03: the signature the app expects is HMAC(our stored razorpay_order_id | payment id)
    with the mock secret (facts §F; D-042), computed here independently."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    expected = hmac.new(
        MOCK_SECRET.encode(),
        f"{order['razorpay_order_id']}|{handler['razorpay_payment_id']}".encode(),
        hashlib.sha256,
    ).hexdigest()
    assert handler["razorpay_signature"] == expected
    assert handler["razorpay_order_id"] == order["razorpay_order_id"]


def test_verify_refuses_an_amount_without_the_fee(client):
    """R-03, D-060: a captured payment whose amount is the price without the fee is refused by
    verify (409) and by the webhook (acknowledged, nothing credited)."""
    order = buy(client)
    assert order["amount_paise"] == order["price_paise"] + order["fee_paise"] > order["price_paise"]
    handler = pay(client, order["order_id"])
    gateway = mock_gateway(client)
    pid = handler["razorpay_payment_id"]
    gateway._payments[pid] = replace(gateway._payments[pid], amount=order["price_paise"])
    r = verify(client, order["order_id"], handler)
    assert r.status_code == 409 and r.json()["code"] == "payment_not_captured", r.text
    # No promise that credits will appear by themselves: the mismatch needs staff.
    assert "contact us" in r.json()["detail"] and "will appear" not in r.json()["detail"]
    body = event_body(
        "payment.captured", pid, order["razorpay_order_id"], order["price_paise"], "captured"
    )
    assert webhook(client, body).status_code == 200
    assert purchases(client) == [] and order_status(client, order["order_id"]) == "created"


def test_mock_secret_is_refused_in_razorpay_mode(client):
    """R-03, D-042: with the real gateway (its key secret is not the mock one), a handler signed
    with the public mock secret is 400 payment_signature_invalid, before any Razorpay call."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    calls: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(500)

    payments = client.app.state.payments  # type: ignore[attr-defined]
    payments.gateway = RazorpayGateway(
        "rzp_test_x", "a-real-key-secret", transport=httpx.MockTransport(record)
    )
    r = verify(client, order["order_id"], handler)
    assert r.status_code == 400 and r.json()["code"] == "payment_signature_invalid", r.text
    assert calls == [] and purchases(client) == []


def test_verify_before_capture_is_409(client):
    """R-03: a payment still `authorized` is not credited: 409 payment_not_captured, order stays
    created."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    gateway = mock_gateway(client)
    pid = handler["razorpay_payment_id"]
    gateway._payments[pid] = replace(gateway._payments[pid], status="authorized")
    r = verify(client, order["order_id"], handler)
    assert r.status_code == 409 and r.json()["code"] == "payment_not_captured"
    assert order_status(client, order["order_id"]) == "created" and purchases(client) == []


def test_verify_gateway_down_is_502_without_provider_text(client):
    """R-03: when Razorpay cannot be reached, verify answers 502 payment_provider_unavailable,
    leaks nothing from the provider, and credits nothing."""
    order = buy(client)
    handler = pay(client, order["order_id"])

    def down(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": {"description": "SECRET-PROVIDER-TEXT"}})

    payments = client.app.state.payments  # type: ignore[attr-defined]
    payments.gateway = RazorpayGateway(
        "rzp_test_x", MOCK_SECRET, transport=httpx.MockTransport(down)
    )
    r = verify(client, order["order_id"], handler)
    assert r.status_code == 502 and r.json()["code"] == "payment_provider_unavailable"
    assert "SECRET-PROVIDER-TEXT" not in r.text
    assert purchases(client) == []


# ---- orders, limits and the fee (T-402, D-059, D-060) -------------------------------------


@pytest.mark.parametrize(
    ("credits", "status"), [(999, 422), (1000, 201), (10_000, 201), (10_001, 422), (0, 422)]
)
def test_purchase_limits(client, credits, status):
    """R-02, D-047, D-059: whole credits from 1,000 to 10,000; outside, 422 with a customer
    message under `credits`."""
    r = client.post("/api/v1/payments/orders", json={"credits": credits})
    assert r.status_code == status, r.text
    if status == 422:
        body = r.json()
        assert body["code"] == "validation_error"
        assert body["fields"]["credits"] == "Choose a whole number of credits from 1,000 to 10,000."
    q = client.get("/api/v1/payments/quote", params={"credits": credits})
    assert q.status_code == (200 if status == 201 else 422), q.text
    if status == 422:
        assert "credits" in q.json()["fields"]


def test_non_integer_credits_are_refused(client):
    """R-02, D-014: a fraction or text is 422 under `credits`; no order is made."""
    for bad in (1000.5, "lots", None):
        r = client.post("/api/v1/payments/orders", json={"credits": bad})
        assert r.status_code == 422 and "credits" in r.json()["fields"], r.text
    with engine_of(client).connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM payment_orders")).scalar_one() == 0


def test_quote_equals_the_order_amounts(client):
    """R-02, D-060: the quote the browser shows equals the order's amounts; the Razorpay order is
    created for the total; credits stay the credits."""
    q = client.get("/api/v1/payments/quote", params={"credits": 2500}).json()
    assert q == {
        "credits": 2500,
        "price_paise": 250_000,
        "fee_paise": 5_103,
        "fee_gst_paise": 0,
        "amount_paise": 255_103,
    }
    order = buy(client, 2500)
    assert {k: order[k] for k in q} == q
    with engine_of(client).connect() as conn:
        row = conn.execute(text("SELECT amount_paise, credits FROM payment_orders")).one()
    assert tuple(row) == (255_103, 2500)
    assert mock_gateway(client)._orders[order["razorpay_order_id"]] == 255_103


def test_fee_is_grossed_up_so_the_price_arrives_in_full():
    """R-02, D-062, D-014: Razorpay takes 2% of the whole amount plus 18% GST on that fee, so the
    total is grossed up. 1,000 credits: ceil(100000 / 0.9764) = 102418 paise (₹1,024.18), shown as
    a ₹20.50 fee and ₹3.68 GST. For every amount, what Razorpay leaves is at least the price."""
    q = quote(1000, 200, 1800)
    assert (q.price_paise, q.fee_paise, q.fee_gst_paise, q.amount_paise) == (
        100_000,
        2_050,
        368,
        102_418,
    )
    for credits in range(1000, 10_001, 37):
        q = quote(credits, 200, 1800)
        razorpay_keeps = q.amount_paise * 200 * 11_800 / 100_000_000
        assert q.amount_paise - razorpay_keeps >= q.price_paise
        assert q.amount_paise == q.price_paise + q.fee_paise + q.fee_gst_paise
    assert quote(1000, 200, 0).amount_paise == 102_041  # ceil(100000 / 0.98)
    assert quote(1000, 0, 1800) == quote(1000, 0, 0)  # no fee, no GST on it
    assert all(isinstance(v, int) for v in vars(quote(1001, 199, 1800)).values())


def test_purchase_with_a_rounded_fee_credits_the_credits(settings, make_user):
    """D-060 (R-02): with a fee that is not a whole number of paise, the whole flow still
    charges the rounded total and credits exactly the credits bought."""
    s = replace(settings, payment_fee_bps=199, payment_fee_gst_bps=1800)
    with TestClient(create_app(s, start_poller=False), base_url=HTTPS) as anon:
        c = make_user(anon, "fee@example.com")
        c.anon = anon
        order = buy(c, 1001)
        assert (order["fee_paise"], order["fee_gst_paise"], order["amount_paise"]) == (
            2041,
            367,
            102_508,
        )
        r = verify(c, order["order_id"], pay(c, order["order_id"]))
        assert r.status_code == 200, r.text
        assert_credited_once(c, order, credits=1001)


def test_config_shows_the_fee_settings(client):
    """R-02, D-060: config carries the fee rates for display."""
    body = client.get("/api/v1/config").json()
    assert (body["payment_fee_bps"], body["payment_fee_gst_bps"]) == (200, 0)
    assert body["min_purchase_credits"] == 1000


def test_create_order_gateway_down_is_502_and_stores_nothing(client):
    """R-03: Razorpay unreachable → 502 payment_provider_unavailable; no order row; no provider
    text."""

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("SECRET-PROVIDER-TEXT")

    payments = client.app.state.payments  # type: ignore[attr-defined]
    payments.gateway = RazorpayGateway("rzp_test_x", "s", transport=httpx.MockTransport(boom))
    r = client.post("/api/v1/payments/orders", json={"credits": 1000})
    assert r.status_code == 502 and r.json()["code"] == "payment_provider_unavailable"
    assert "SECRET" not in r.text
    with engine_of(client).connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM payment_orders")).scalar_one() == 0


def test_unconfirmed_user_cannot_buy(client, make_user):
    """R-03, D-049: an unconfirmed email gets 403 email_not_verified with a buying message."""
    c = make_user(client.anon, "late@example.com", confirmed=False)
    r = c.post("/api/v1/payments/orders", json={"credits": 1000})
    assert r.status_code == 403 and r.json()["code"] == "email_not_verified"
    assert "buying credits" in r.json()["detail"]


def test_another_users_order_is_404_everywhere(client, make_user):
    """R-03 (customer rule 1): another user cannot see, verify or mock-pay the owner's order:
    404 order_not_found, and nothing is credited to anyone."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    other = make_user(client.anon, "other@example.com")
    assert other.get(f"/api/v1/payments/orders/{order['order_id']}").status_code == 404
    r = verify(other, order["order_id"], handler)
    assert r.status_code == 404 and r.json()["code"] == "order_not_found"
    r = other.post(
        "/api/v1/payments/mock/complete",
        json={"order_id": order["order_id"], "outcome": "captured"},
    )
    assert r.status_code == 404
    assert purchases(client) == []


def test_order_status_route(client):
    """R-02: the owner sees their order's status, credits and creation time."""
    order = buy(client)
    body = client.get(f"/api/v1/payments/orders/{order['order_id']}").json()
    assert (body["order_id"], body["status"], body["credits"]) == (
        order["order_id"],
        "created",
        1000,
    )
    assert body["created_at"].endswith("+00:00")


# ---- the webhook (T-404) -------------------------------------------------------------------


def test_webhook_refuses_unsigned_and_wrongly_signed_and_stores_nothing(client):
    """R-03 (rule 8): no signature, a wrong one, one over a different body, or no event id →
    400 webhook_signature_invalid; nothing stored, nothing credited."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    payment = mock_gateway(client).fetch_payment(handler["razorpay_payment_id"])
    body = event_body(
        "payment.captured", payment.id, order["razorpay_order_id"], payment.amount, "captured"
    )
    tampered = body.replace(b'"amount": ', b'"amount":  ')  # same JSON, other bytes
    for r in (
        webhook(client, body, signature=None),
        webhook(client, body, signature="0" * 64),
        webhook(client, body, signature=sign(body, "another-secret")),
        webhook(client, tampered, signature=sign(body)),
        webhook(client, body, signature=sign(body, MOCK_SECRET)),
        webhook(client, body, event_id=""),
    ):
        assert r.status_code == 400 and r.json()["code"] == "webhook_signature_invalid", r.text
    with engine_of(client).connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM webhook_events")).scalar_one() == 0
    assert purchases(client) == []


def test_webhook_with_no_secret_configured_refuses_everything(settings, make_user):
    """R-03: with an empty webhook secret, even a body 'signed' with the empty key is refused."""
    s = replace(settings, razorpay_webhook_secret="")
    with TestClient(create_app(s, start_poller=False), base_url=HTTPS) as anon:
        body = b'{"event":"payment.captured"}'
        r = anon.post(
            "/api/v1/webhooks/razorpay",
            content=body,
            headers={"X-Razorpay-Signature": sign(body, ""), "x-razorpay-event-id": "e1"},
        )
    assert r.status_code == 400 and r.json()["code"] == "webhook_signature_invalid"


def test_signed_webhook_we_ignore_is_still_acknowledged(client):
    """R-02: a signed event we do not act on, an unknown order, a payment without an order, or a
    body that is not an object are all 200 (Razorpay must not retry them) and credit nothing."""
    bodies = [
        json.dumps({"event": "refund.created", "payload": {}}).encode(),
        event_body("payment.captured", "pay_unknown", "order_unknown", 102000, "captured"),
        json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {}}}}).encode(),
        json.dumps({"event": "payment.captured", "payload": [1]}).encode(),
        json.dumps({"event": "order.paid", "payload": {"payment": "x"}}).encode(),
        b"[1, 2, 3]",
        b"not json at all",
    ]
    for body in bodies:
        assert webhook(client, body).status_code == 200
    assert purchases(client) == []
    with engine_of(client).connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM webhook_events")).scalar_one() == len(bodies)


def test_webhook_authorized_payment_does_not_credit(client):
    """R-03 (facts §G): `captured: true` in the entity is ignored; status `authorized` credits
    nothing."""
    order = buy(client)
    handler = pay(client, order["order_id"])
    body = event_body(
        "payment.captured",
        handler["razorpay_payment_id"],
        order["razorpay_order_id"],
        order["amount_paise"],
        "authorized",
    )
    assert webhook(client, body).status_code == 200
    assert purchases(client) == []


# ---- reconciliation (T-405) ---------------------------------------------------------------


def test_reconcile_window_and_failed_orders(client):
    """R-02: reconciliation looks at created and failed orders 30 minutes to 3 days old. A
    failed order later captured is credited; an order older than 3 days is left alone; a paid
    order is never looked at again."""
    service = client.app.state.payments  # type: ignore[attr-defined]
    now = datetime.now(timezone.utc)
    failed_then_paid = buy(client)
    old = buy(client)
    handler = pay(client, failed_then_paid["order_id"], "failed")
    verify(client, failed_then_paid["order_id"], handler)
    assert order_status(client, failed_then_paid["order_id"]) == "failed"
    pay(client, failed_then_paid["order_id"])
    pay(client, old["order_id"])
    with engine_of(client).begin() as conn:
        conn.execute(
            text("UPDATE payment_orders SET created_at = :t WHERE id = :i"),
            {"t": now - timedelta(days=4), "i": old["order_id"]},
        )
    assert service.reconcile_once(now + timedelta(hours=1)) == 1
    assert order_status(client, failed_then_paid["order_id"]) == "paid"
    assert order_status(client, old["order_id"]) == "created"
    assert len(purchases(client)) == 1 and invariant(client)


def test_without_a_webhook_secret_reconciliation_polls_sooner(settings, make_user):
    """R-03, D-064: with no webhook secret, every webhook is refused and reconciliation credits a
    paid order after 2 minutes instead of 30."""
    s = replace(settings, razorpay_webhook_secret="")
    with TestClient(create_app(s, start_poller=False), base_url=HTTPS) as anon:
        c = make_user(anon, "nohook@example.com")
        c.anon = anon  # type: ignore[attr-defined]
        service = anon.app.state.payments  # type: ignore[attr-defined]
        assert service.webhooks_enabled is False
        order = buy(c)
        pay(c, order["order_id"])  # paid at the gateway; the browser never verified (tab closed)
        now = datetime.now(timezone.utc)
        assert service.reconcile_once(now + timedelta(minutes=1)) == 0
        assert service.reconcile_once(now + timedelta(minutes=3)) == 1
        assert order_status(c, order["order_id"]) == "paid"
        r = anon.post(
            "/api/v1/webhooks/razorpay",
            content=b'{"event": "payment.captured"}',
            headers={"x-razorpay-signature": "0" * 64, "x-razorpay-event-id": "evt_1"},
        )
        assert r.status_code == 400


def test_reconcile_survives_a_gateway_error(client):
    """R-02: one order's gateway error is logged and the run carries on with the next."""
    service = client.app.state.payments  # type: ignore[attr-defined]
    a, b = buy(client), buy(client)
    pay(client, b["order_id"])
    real = service.gateway.order_payments

    def flaky(razorpay_order_id):
        if razorpay_order_id == a["razorpay_order_id"]:
            raise GatewayError("down")
        return real(razorpay_order_id)

    service.gateway.order_payments = flaky
    assert service.reconcile_once(datetime.now(timezone.utc) + timedelta(hours=1)) == 1
    assert order_status(client, b["order_id"]) == "paid"


def test_reconcile_cli_runs(monkeypatch, database_url, capsys):
    """R-02, T-405: `python -m app.payments.cli reconcile` runs once in mock mode and reports."""
    from app.payments import cli

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("AVATAR_PAYMENTS", "mock")
    assert cli.main(["reconcile"]) == 0
    assert "0 order(s) credited" in capsys.readouterr().out


# ---- the Razorpay gateway against a fake transport (D-041; no network) ---------------------


def _recorder(responses: dict[tuple[str, str], httpx.Response]):
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return responses[(request.method, request.url.path)]

    return seen, httpx.MockTransport(handle)


def test_razorpay_gateway_create_order_request_shape():
    """R-02 (facts §A): POST /v1/orders with Basic auth key_id:key_secret and {amount, currency
    INR, receipt}; nothing else is sent; the order id comes back."""
    seen, transport = _recorder(
        {
            ("POST", "/v1/orders"): httpx.Response(
                200,
                json={
                    "id": "order_ABC",
                    "entity": "order",
                    "amount": 102000,
                    "amount_paid": 0,
                    "status": "created",
                },
            )
        }
    )
    g = RazorpayGateway("rzp_test_k", "sekret", transport=transport)
    assert g.create_order(102000, receipt="r" * 32) == "order_ABC"
    (req,) = seen
    assert str(req.url) == "https://api.razorpay.com/v1/orders"
    import base64

    assert (
        req.headers["authorization"] == "Basic " + base64.b64encode(b"rzp_test_k:sekret").decode()
    )
    assert json.loads(req.content) == {"amount": 102000, "currency": "INR", "receipt": "r" * 32}
    with pytest.raises(ValueError):
        g.create_order(100, receipt="x" * 41)


def test_razorpay_gateway_fetches_and_refuses_bad_answers():
    """R-03 (facts §B, §C, §I): fetch payment, fetch order and order payments parse the
    documented fields; non-2xx, non-JSON, float amounts and odd ids become GatewayError."""
    payment = {
        "id": "pay_1",
        "order_id": "order_1",
        "amount": 102000,
        "status": "captured",
        "captured": True,
    }
    _, transport = _recorder(
        {
            ("GET", "/v1/payments/pay_1"): httpx.Response(200, json=payment),
            ("GET", "/v1/orders/order_1"): httpx.Response(
                200,
                json={"id": "order_1", "amount": 102000, "amount_paid": 102000, "status": "paid"},
            ),
            ("GET", "/v1/orders/order_1/payments"): httpx.Response(
                200, json={"entity": "collection", "count": 1, "items": [payment]}
            ),
            ("GET", "/v1/payments/pay_500"): httpx.Response(500, text="boom"),
            ("GET", "/v1/payments/pay_html"): httpx.Response(200, text="<html>"),
            ("GET", "/v1/payments/pay_float"): httpx.Response(
                200, json={**payment, "id": "pay_float", "amount": 1020.0}
            ),
        }
    )
    g = RazorpayGateway("rzp_test_k", "s", transport=transport)
    p = g.fetch_payment("pay_1")
    assert (p.id, p.order_id, p.amount, p.status) == ("pay_1", "order_1", 102000, "captured")
    assert g.fetch_order("order_1").status == "paid"
    assert [x.id for x in g.order_payments("order_1")] == ["pay_1"]
    for bad in ("pay_500", "pay_html", "pay_float", "../orders", "pay 1", ""):
        with pytest.raises(GatewayError):
            g.fetch_payment(bad)


def test_build_gateway_follows_the_setting():
    """R-03, D-042: mock mode builds the MockGateway (no network); razorpay mode the real one."""
    assert isinstance(gw.build_gateway(replace(Settings(), payments="mock")), MockGateway)
    live = replace(
        Settings(),
        payments="razorpay",
        razorpay_key_id="rzp_test_" + "a" * 14,
        razorpay_key_secret="s",
        razorpay_webhook_secret="w",
    )
    g = gw.build_gateway(live)
    assert isinstance(g, RazorpayGateway) and g.key_id == live.razorpay_key_id
    g.close()
