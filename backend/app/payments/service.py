"""Buying credits (tasks T-402 to T-405; HLD §5.1; D-016).

One crediting routine, `credit_order`, is reached from three places (backend rule 7):

- `PaymentService.verify`: the browser's confirmation. The Checkout signature is checked with the
  Razorpay order id WE stored (facts §F), then the payment is fetched from Razorpay (facts §C):
  the browser's word is never used for status or amount.
- `PaymentService.handle_webhook`: Razorpay's webhook. The signature is checked on the raw body
  before it is parsed (facts §G, rule 8); the delivery is deduped on `x-razorpay-event-id` in the
  same transaction that credits, so a failure rolls both back and Razorpay's retry runs again.
- `PaymentService.reconcile_once`: orders still unpaid after 30 minutes (up to 3 days) are looked
  up at Razorpay (facts §B, §C).

`credit_order` locks the order row, then requires: the payment belongs to this order, its status
is `captured`, and its amount equals the order's. It then marks the order paid and writes the
ledger `purchase` in the caller's ONE transaction. An order already paid is a no-op, so whatever
order the three arrive in, a purchase is credited exactly once (rule 9). The ledger's UNIQUE
(kind, ref_type, ref_id) on ('purchase', 'payment', <payment id>) is the last line of defence.

No network call is ever made while a row lock is held. Logs carry our order id only, never a
full Razorpay id, a signature or a body (customer rule 4)."""

import asyncio
import enum
import hashlib
import hmac
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Connection, Engine, Row, Table, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..core.config import Settings
from ..core.errors import ApiError
from ..wallet import ledger
from .gateway import Gateway, GatewayError, MockGateway, Payment, parse_payment
from .models import CREATED, FAILED, PAID, PaymentOrder, WebhookEvent

log = logging.getLogger(__name__)

_orders: Table = PaymentOrder.__table__  # type: ignore[assignment]
_events: Table = WebhookEvent.__table__  # type: ignore[assignment]

# Reconciliation (M4-PLAN, Assumed): every 5 minutes, orders older than 30 minutes and younger
# than 3 days (a payment left `authorized` is refunded after 3 days, facts §D).
RECONCILE_EVERY_SECONDS = 300
RECONCILE_MIN_AGE = timedelta(minutes=30)
RECONCILE_MAX_AGE = timedelta(days=3)
RECONCILE_BATCH = 200

# Webhook events whose payment entity goes through the crediting routine (facts §G).
_PAYMENT_EVENTS = frozenset({"payment.captured", "order.paid", "payment.failed"})

PROVIDER_DOWN = "We could not reach the payment service. Please try again in a minute."


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---- price (D-060) ------------------------------------------------------------------------


@dataclass(frozen=True)
class Quote:
    credits: int
    price_paise: int
    fee_paise: int
    fee_gst_paise: int
    amount_paise: int


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def quote(credits: int, fee_bps: int, fee_gst_bps: int) -> Quote:
    """Integers only (D-014). ₹1 = 1 credit (D-007), so the price is credits × 100 paise.

    Razorpay takes `fee_bps` of the WHOLE amount charged plus `fee_gst_bps` GST on that fee
    (Standard plan, checked 2026-11-17: 2% + 18%). So the owner receives exactly the price
    (D-062), the total is grossed up: total = ceil(price / (1 - rate x (1 + gst))). For 1,000
    credits at 2% + 18%: ceil(100000 / 0.9764) = 102418 paise (₹1,024.18).

    The extra is shown as two lines: the GST share of it (rounded down) and the rest as the
    payment fee. Neither becomes credits."""
    price = credits * 100
    scale = 100_000_000  # 10_000 x 10_000: basis points of basis points
    denominator = scale - fee_bps * (10_000 + fee_gst_bps)
    total = _ceil_div(price * scale, denominator)
    extra = total - price
    fee_gst = extra * fee_gst_bps // (10_000 + fee_gst_bps)
    return Quote(credits, price, extra - fee_gst, fee_gst, total)


# ---- signatures (facts §F, §G) ----------------------------------------------------------


def _hmac_hex(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def checkout_signature(razorpay_order_id: str, payment_id: str, secret: str) -> str:
    """Facts §F: hex HMAC-SHA256 of `order_id + "|" + razorpay_payment_id` with the API key
    secret, where order_id is the one stored on our server."""
    return _hmac_hex(secret, f"{razorpay_order_id}|{payment_id}".encode())


def webhook_signature(body: bytes, secret: str) -> str:
    """Facts §G: HMAC-SHA256 of the raw request body with the webhook secret. The digest
    encoding (hex) is Not verified in the docs read (facts §G, M4-PLAN Needs Verification); it
    is confirmed in T-407, and this is the one place to change it."""
    return _hmac_hex(secret, body)


def signatures_match(expected: str, given: str) -> bool:
    """Constant-time compare. A string that cannot be encoded (a lone surrogate from JSON) is a
    mismatch, not a 500."""
    try:
        given_bytes = given.encode()
    except UnicodeEncodeError:
        return False
    return hmac.compare_digest(expected.encode(), given_bytes)


# ---- the one crediting routine (T-403) ---------------------------------------------------


class Outcome(enum.Enum):
    CREDITED = "credited"  # this call wrote the purchase
    ALREADY_PAID = "already_paid"  # the order was paid before; nothing written
    NOT_CAPTURED = "not_captured"  # the payment is not captured (yet); nothing credited
    MISMATCH = "mismatch"  # another order's payment, or another amount; nothing credited
    UNKNOWN_ORDER = "unknown_order"  # no order of ours; nothing written


@dataclass(frozen=True)
class CreditResult:
    outcome: Outcome
    order: Row | None  # the order as it is after this call (inside the transaction)


def credit_order(conn: Connection, payment: Payment, order_id: str | None = None) -> CreditResult:
    """Credit an order for a payment, at most once. `payment` must come from the server side
    (a Razorpay fetch, or a webhook payload whose signature was checked), never from the browser.
    The order is found by our id when given, else by the payment's Razorpay order id. Runs in the
    caller's transaction and never commits.

    A `failed` payment moves a `created` order to `failed`; it never touches a paid order, and a
    later captured payment still credits a failed order (HLD §5.1)."""
    query = select(_orders).with_for_update()
    if order_id is not None:
        query = query.where(_orders.c.id == order_id)
    elif payment.order_id is not None:
        query = query.where(_orders.c.razorpay_order_id == payment.order_id)
    else:
        return CreditResult(Outcome.UNKNOWN_ORDER, None)
    order = conn.execute(query).first()
    if order is None:
        return CreditResult(Outcome.UNKNOWN_ORDER, None)

    if order.status == PAID:
        if order.razorpay_payment_id != payment.id and payment.status == "captured":
            # Razorpay permits no payment on a paid order (facts §A); if one appears, staff look.
            log.error("order %s is paid and another captured payment was reported", order.id)
        return CreditResult(Outcome.ALREADY_PAID, order)
    if payment.order_id != order.razorpay_order_id:
        log.error("payment reported for order %s belongs to another order", order.id)
        return CreditResult(Outcome.MISMATCH, order)
    if payment.status != "captured":
        if payment.status == "failed" and order.status == CREATED:
            order = conn.execute(
                update(_orders)
                .where(_orders.c.id == order.id, _orders.c.status == CREATED)
                .values(status=FAILED, updated_at=_now())
                .returning(*_orders.c)
            ).one()
        return CreditResult(Outcome.NOT_CAPTURED, order)
    if payment.amount != order.amount_paise:
        log.error("captured amount for order %s differs from the order amount", order.id)
        return CreditResult(Outcome.MISMATCH, order)

    now = _now()
    paid = conn.execute(
        update(_orders)
        .where(_orders.c.id == order.id, _orders.c.status.in_((CREATED, FAILED)))
        .values(status=PAID, razorpay_payment_id=payment.id, paid_at=now, updated_at=now)
        .returning(*_orders.c)
    ).first()
    if paid is None:  # cannot happen under the row lock; refuse rather than credit
        raise RuntimeError(f"order {order.id} changed under its lock")
    ledger.purchase(conn, order.user_id, order.credits, payment.id)
    log.info("order %s paid: %d credits", order.id, order.credits)
    return CreditResult(Outcome.CREDITED, paid)


# ---- the service ----------------------------------------------------------------------------


class InvalidWebhook(Exception):
    """Unsigned, wrongly signed, or without an event id. Nothing was stored."""


class PaymentService:
    def __init__(self, settings: Settings, engine: Engine, gateway: Gateway):
        self.settings = settings
        self.engine = engine
        self.gateway = gateway

    # -- orders (T-402) --

    def quote(self, credits: object) -> Quote:
        """What buying `credits` costs (D-060). 422 `fields.credits` outside the limits."""
        low, high = self.settings.min_purchase_credits, self.settings.max_purchase_credits
        if isinstance(credits, bool) or not isinstance(credits, int) or not low <= credits <= high:
            message = f"Choose a whole number of credits from {low:,} to {high:,}."
            raise ApiError(422, message, "validation_error", fields={"credits": message})
        return quote(credits, self.settings.payment_fee_bps, self.settings.payment_fee_gst_bps)

    def create_order(self, user_id: str, credits: int) -> Row:
        q = self.quote(credits)
        order_id = uuid.uuid4().hex  # 32 characters: Razorpay's receipt allows 40 (facts §A)
        try:
            razorpay_order_id = self.gateway.create_order(q.amount_paise, receipt=order_id)
        except GatewayError as exc:
            log.warning("creating a Razorpay order failed: %s", exc)
            raise ApiError(502, PROVIDER_DOWN, "payment_provider_unavailable") from None
        now = _now()
        with self.engine.begin() as conn:
            return conn.execute(
                _orders.insert()
                .values(
                    id=order_id,
                    user_id=user_id,
                    razorpay_order_id=razorpay_order_id,
                    amount_paise=q.amount_paise,
                    price_paise=q.price_paise,
                    fee_paise=q.fee_paise,
                    fee_gst_paise=q.fee_gst_paise,
                    credits=q.credits,
                    status=CREATED,
                    created_at=now,
                    updated_at=now,
                )
                .returning(*_orders.c)
            ).one()

    def get_owned(self, order_id: str, user_id: str) -> Row:
        """The caller's order. Missing and someone else's look the same: 404."""
        with self.engine.connect() as conn:
            order = conn.execute(
                select(_orders).where(_orders.c.id == order_id, _orders.c.user_id == user_id)
            ).first()
        if order is None:
            raise ApiError(404, "We could not find that payment.", "order_not_found")
        return order

    # -- the browser's confirmation (T-403) --

    def verify(
        self, user_id: str, order_id: str, payment_id: str, signature: str
    ) -> tuple[Row, ledger.WalletBalance]:
        order = self.get_owned(order_id, user_id)
        expected = checkout_signature(
            order.razorpay_order_id, payment_id, self.gateway.checkout_secret
        )
        if not signatures_match(expected, signature):
            raise ApiError(
                400,
                "We could not confirm this payment. If money left your account, contact us.",
                "payment_signature_invalid",
            )
        if not (order.status == PAID and order.razorpay_payment_id == payment_id):
            try:
                payment = self.gateway.fetch_payment(payment_id)  # never the browser's word
            except GatewayError as exc:
                log.warning("fetching the payment for order %s failed: %s", order.id, exc)
                raise ApiError(502, PROVIDER_DOWN, "payment_provider_unavailable") from None
            with self.engine.begin() as conn:
                result = credit_order(conn, payment, order_id=order.id)
            if result.outcome not in (Outcome.CREDITED, Outcome.ALREADY_PAID):
                if result.outcome is Outcome.MISMATCH:
                    # Logged for staff; no promise that credits will appear on their own.
                    message = (
                        "We could not match this payment to your order, so no credits were "
                        "added. Please contact us and we will sort it out."
                    )
                elif payment.status == "failed":
                    message = (
                        "The payment did not go through and no credits were added. If money "
                        "left your account, your bank normally returns it. You can try again."
                    )
                else:
                    message = (
                        "Your payment is not confirmed yet. If money left your account, your "
                        "credits will appear within a few minutes."
                    )
                raise ApiError(409, message, "payment_not_captured")
            order = result.order  # type: ignore[assignment]  # set for these two outcomes
        return order, ledger.get_wallet(self.engine, user_id)

    # -- the webhook (T-404) --

    def handle_webhook(self, body: bytes, signature: str | None, event_id: str | None) -> str:
        """Verify, dedupe, apply. Returns what happened (for logs and tests). Raises
        InvalidWebhook before anything is parsed or stored. Once the signature is good, nothing
        about the content raises: unknown orders and events are acknowledged and ignored."""
        secret = self.settings.razorpay_webhook_secret
        # An empty secret would let anyone sign; the mock Checkout secret is never accepted here.
        if not secret or not signature:
            raise InvalidWebhook("unsigned")
        if not signatures_match(webhook_signature(body, secret), signature):
            raise InvalidWebhook("bad signature")
        # Facts §G: `x-razorpay-event-id` is sent with every event; without it we cannot dedupe
        # (rule 8), so the delivery is refused and reconciliation covers the order.
        if not event_id or len(event_id) > 200:
            raise InvalidWebhook("no event id")

        try:
            data: Any = json.loads(body)
        except ValueError:
            data = None
        if not isinstance(data, dict):
            data = {}
        event_type = data.get("event") if isinstance(data.get("event"), str) else "unknown"

        with self.engine.begin() as conn:
            inserted = conn.execute(
                pg_insert(_events)
                .values(event_id=event_id, event_type=event_type, payload=data, received_at=_now())
                .on_conflict_do_nothing(index_elements=["event_id"])
                .returning(_events.c.event_id)
            ).first()
            if inserted is None:
                return "duplicate"
            outcome = self._apply_event(conn, event_type, data)
            conn.execute(
                update(_events).where(_events.c.event_id == event_id).values(processed_at=_now())
            )
        return outcome

    def _apply_event(self, conn: Connection, event_type: str, data: dict[str, Any]) -> str:
        if event_type not in _PAYMENT_EVENTS:
            return "ignored"
        # Facts §G: payload.payment.entity for payment.* and order.paid. Status is read from the
        # entity's `status`, never its `captured` boolean.
        payload = data.get("payload")
        entity = payload.get("payment") if isinstance(payload, dict) else None
        entity = entity.get("entity") if isinstance(entity, dict) else None
        try:
            payment = parse_payment(entity)
        except GatewayError:
            log.warning("webhook %s has no usable payment entity", event_type)
            return "ignored"
        if payment.order_id is None:
            return "ignored"
        return credit_order(conn, payment).outcome.value

    # -- reconciliation (T-405) --

    def reconcile_once(self, now: datetime | None = None) -> int:
        """Ask Razorpay about orders still unpaid after RECONCILE_MIN_AGE and younger than
        RECONCILE_MAX_AGE; credit any that were paid. `failed` orders are included because a
        failure can be followed by a capture (HLD §5.1). Returns how many orders were credited.
        One order's error never stops the others."""
        now = now or _now()
        with self.engine.connect() as conn:
            due = conn.execute(
                select(_orders.c.id, _orders.c.razorpay_order_id)
                .where(
                    _orders.c.status.in_((CREATED, FAILED)),
                    _orders.c.created_at <= now - RECONCILE_MIN_AGE,
                    _orders.c.created_at >= now - RECONCILE_MAX_AGE,
                )
                .order_by(_orders.c.created_at)
                .limit(RECONCILE_BATCH)
            ).all()
        credited = 0
        for order in due:
            try:
                credited += self._reconcile_order(order.id, order.razorpay_order_id)
            except GatewayError as exc:
                log.warning("reconciling order %s: %s", order.id, exc)
            except Exception:
                log.exception("reconciling order %s failed", order.id)
        return credited

    def _reconcile_order(self, order_id: str, razorpay_order_id: str) -> int:
        # Facts §B: whether captured payments appear in this list is Not verified, so a listed
        # payment that is not final is fetched again (facts §C), and if nothing captured is found
        # the order's own status is read.
        found_captured = False
        for listed in self.gateway.order_payments(razorpay_order_id):
            payment = listed
            if payment.status in ("created", "authorized"):
                payment = self.gateway.fetch_payment(listed.id)
            if payment.status == "captured":
                found_captured = True
            with self.engine.begin() as conn:
                result = credit_order(conn, payment, order_id=order_id)
            if result.outcome is Outcome.CREDITED:
                return 1
            if result.outcome is Outcome.ALREADY_PAID:
                return 0
        if not found_captured and self.gateway.fetch_order(razorpay_order_id).status == "paid":
            # Paid at Razorpay, yet no captured payment to credit by: never invent a reference.
            log.error("order %s is paid at Razorpay but no captured payment was listed", order_id)
        return 0

    async def run_reconciler(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.reconcile_once)
            except Exception:
                log.exception("reconciliation run failed")
            await asyncio.sleep(RECONCILE_EVERY_SECONDS)

    # -- the mock Checkout (D-042) --

    def mock_complete(self, user_id: str, order_id: str, outcome: str) -> tuple[str, str, str]:
        """Act as Razorpay Checkout: record a captured or failed payment in the MockGateway and
        return the handler's fields, signed with the mock secret. Credits nothing itself."""
        if not isinstance(self.gateway, MockGateway):
            raise ApiError(404, "Not found.", "not_found")
        order = self.get_owned(order_id, user_id)
        payment = self.gateway.complete(order.razorpay_order_id, order.amount_paise, outcome)
        signature = checkout_signature(
            order.razorpay_order_id, payment.id, self.gateway.checkout_secret
        )
        return order.razorpay_order_id, payment.id, signature
