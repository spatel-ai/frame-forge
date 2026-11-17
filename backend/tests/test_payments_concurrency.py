"""T-406: race cases for buying credits. R-02 (a purchase credits the wallet exactly once,
whatever order and timing verify, the webhook and reconciliation arrive with).

Each thread has its own database connection and transaction; a `threading.Barrier` releases them
together. The PaymentService runs on an engine whose pool gives every thread a connection, so the
order row lock, not the pool, is what serialises them. After each scenario the wallet invariant
checks from test_wallet_concurrency.py run.

MockGateway only (in memory); webhook bodies are signed here with a test secret. No network."""

import hashlib
import hmac
import json
import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core.config import Settings
from app.payments.gateway import MOCK_CHECKOUT_SECRET, MockGateway
from app.payments.service import PaymentService
from tests.test_wallet_concurrency import big_engine, check_invariants, run_together, unexpected

WEBHOOK_SECRET = "whsec_race_test"
CREDITS = 1000


@pytest.fixture
def service(database_url):
    settings = replace(
        Settings(),
        payments="mock",
        database_url=database_url,
        razorpay_webhook_secret=WEBHOOK_SECRET,
    )
    engine = big_engine(database_url, 40)
    yield PaymentService(settings, engine, MockGateway())
    engine.dispose()


@pytest.fixture
def user(database_url, seed_user):
    return seed_user(database_url, "owner@example.com")


def paid_order(service: PaymentService, user: str):
    """An order with a captured mock payment; returns (order row, payment, handler signature)."""
    order = service.create_order(user, CREDITS)
    gateway: MockGateway = service.gateway  # type: ignore[assignment]
    payment = gateway.complete(order.razorpay_order_id, order.amount_paise, "captured")
    signature = hmac.new(
        MOCK_CHECKOUT_SECRET.encode(),
        f"{order.razorpay_order_id}|{payment.id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return order, payment, signature


def signed_event(event: str, payment) -> tuple[bytes, str]:
    body = json.dumps(
        {
            "event": event,
            "payload": {
                "payment": {
                    "entity": {
                        "id": payment.id,
                        "order_id": payment.order_id,
                        "amount": payment.amount,
                        "status": payment.status,
                    }
                }
            },
        }
    ).encode()
    return body, hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def purchase_rows(service: PaymentService) -> list:
    with service.engine.connect() as conn:
        return conn.execute(
            text("SELECT user_id, credits, ref_id FROM ledger_entries WHERE kind = 'purchase'")
        ).all()


def assert_one_purchase(service: PaymentService, user: str, payment_id: str) -> None:
    rows = purchase_rows(service)
    assert [tuple(r) for r in rows] == [(user, CREDITS, payment_id)]
    with service.engine.connect() as conn:
        status = conn.execute(text("SELECT status FROM payment_orders")).scalar_one()
    assert status == "paid"
    check_invariants(service.engine)


def test_verify_and_webhook_at_once_credit_once(service, user):
    """R-02 (race): the browser's verify and Razorpay's payment.captured webhook arrive at the
    same moment, ten times over (five each). Exactly one purchase entry; every verify answers
    paid; the invariants hold."""
    order, payment, signature = paid_order(service, user)
    body, webhook_sig = signed_event("payment.captured", payment)
    n = 10

    def work(i: int):
        if i % 2 == 0:
            o, _wallet = service.verify(user, order.id, payment.id, signature)
            return ("verify", o.status)
        return ("webhook", service.handle_webhook(body, webhook_sig, f"evt_{i}"))

    results = run_together(n, work)
    unexpected(results)
    assert all(r == ("verify", "paid") for r in results if r[0] == "verify")  # type: ignore[index]
    outcomes = [r[1] for r in results if r[0] == "webhook"]  # type: ignore[index]
    assert set(outcomes) <= {"credited", "already_paid"}
    credited_by_webhook = outcomes.count("credited")
    assert credited_by_webhook <= 1
    assert_one_purchase(service, user, payment.id)


def test_same_webhook_many_times_at_once_is_stored_and_credited_once(service, user):
    """R-02 (race, rule 8): twenty deliveries of ONE event id at once: one webhook_events row,
    exactly one 'credited', every other delivery a duplicate; one purchase entry."""
    _order, payment, _sig = paid_order(service, user)
    body, sig = signed_event("payment.captured", payment)
    event_id = "evt_" + uuid.uuid4().hex
    results = run_together(20, lambda _i: service.handle_webhook(body, sig, event_id))
    unexpected(results)
    assert results.count("credited") == 1
    assert results.count("duplicate") == 19
    with service.engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM webhook_events")).scalar_one() == 1
    assert_one_purchase(service, user, payment.id)


def test_verify_webhook_and_reconcile_at_once_credit_once(service, user):
    """R-02 (race): verify, payment.captured, order.paid and reconciliation all run on one order
    at the same moment (several of each). Exactly one purchase entry; reconciliation credits at
    most once in total; the invariants hold."""
    order, payment, signature = paid_order(service, user)
    captured_body, captured_sig = signed_event("payment.captured", payment)
    paid_body, paid_sig = signed_event("order.paid", payment)
    later = datetime.now(timezone.utc) + timedelta(hours=1)  # the order is due for reconcile
    n = 16

    def work(i: int):
        kind = i % 4
        if kind == 0:
            return ("verify", service.verify(user, order.id, payment.id, signature)[0].status)
        if kind == 1:
            return ("webhook", service.handle_webhook(captured_body, captured_sig, f"c{i}"))
        if kind == 2:
            return ("webhook", service.handle_webhook(paid_body, paid_sig, f"p{i}"))
        return ("reconcile", service.reconcile_once(later))

    results = run_together(n, work)
    unexpected(results)
    assert all(r[1] == "paid" for r in results if r[0] == "verify")  # type: ignore[index]
    assert sum(r[1] for r in results if r[0] == "reconcile") <= 1  # type: ignore[index,misc]
    assert_one_purchase(service, user, payment.id)


def test_two_captured_payments_on_one_order_credit_once(service, user):
    """R-02 (race): two DIFFERENT captured payments are reported for one order at the same
    moment (Razorpay permits none after the first, facts §A, but the routine must not rely on
    it). The ledger key differs per payment, so only the order row lock and the paid check stop
    a second credit: exactly one purchase entry, for whichever payment won."""
    order, first, first_sig = paid_order(service, user)
    gateway: MockGateway = service.gateway  # type: ignore[assignment]
    second = gateway.complete(order.razorpay_order_id, order.amount_paise, "captured")
    second_sig = hmac.new(
        MOCK_CHECKOUT_SECRET.encode(),
        f"{order.razorpay_order_id}|{second.id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    bodies = [signed_event("payment.captured", p) for p in (first, second)]
    n = 12

    def work(i: int):
        kind = i % 4
        if kind == 0:
            return service.verify(user, order.id, first.id, first_sig)[0].status
        if kind == 1:
            return service.verify(user, order.id, second.id, second_sig)[0].status
        body, sig = bodies[kind - 2]
        return service.handle_webhook(body, sig, f"evt_{i}")

    results = run_together(n, work)
    unexpected(results)
    rows = purchase_rows(service)
    assert len(rows) == 1, rows
    assert rows[0][2] in (first.id, second.id)
    with service.engine.connect() as conn:
        paid_by = conn.execute(text("SELECT razorpay_payment_id FROM payment_orders")).scalar_one()
    assert paid_by == rows[0][2]
    check_invariants(service.engine)


def test_many_verifies_at_once_credit_once(service, user):
    """R-02 (repeat + race): the same verify sent twenty times at once credits once."""
    order, payment, signature = paid_order(service, user)
    results = run_together(
        20, lambda _i: service.verify(user, order.id, payment.id, signature)[1].balance_credits
    )
    unexpected(results)
    assert set(results) == {CREDITS}
    assert_one_purchase(service, user, payment.id)
