"""The payment gateway (task T-402, D-041): the ONLY code that talks to Razorpay.

Every endpoint, field and status below is taken from docs/RAZORPAY-FACTS.md (T-401, checked
2026-11-17); the section is named next to each use. Nothing here was run against Razorpay: that
is the owner-approved test-mode run T-407.

- `RazorpayGateway`: httpx with HTTP basic auth key_id:key_secret (facts §A, §C).
- `MockGateway`: no network. Order and payment ids are derived from our order id, so they are
  deterministic and do not collide across restarts (the columns are UNIQUE). Payments live in
  memory; `complete` plays the part of a customer paying (D-042).

`build_gateway(settings)` picks one by `settings.payments`. Errors never carry Razorpay's text:
callers turn `GatewayError` into 502 `payment_provider_unavailable`."""

import logging
import re
import threading
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from ..core.config import Settings

log = logging.getLogger(__name__)

# Facts §A, §B, §C.
RAZORPAY_API = "https://api.razorpay.com/v1"
CURRENCY = "INR"  # facts §J rule 1: currency is ours to choose; amounts are in paise
TIMEOUT_SECONDS = 10.0

# The fixed secret the mock Checkout signs with (D-042). Public by design: it only works in mock
# mode, where no money moves. Never used for the webhook.
MOCK_CHECKOUT_SECRET = "frameforge-mock-checkout-secret"

# A Razorpay id goes into a URL path, so only plain id characters are accepted.
_ID = re.compile(r"^[A-Za-z0-9_]{1,64}$")


class GatewayError(Exception):
    """Razorpay could not be reached, refused the call, or answered something unexpected. The
    message is for logs only and never holds a secret or Razorpay's own text."""


@dataclass(frozen=True)
class Payment:
    """A payment as Razorpay reports it (facts §B, §C, §G): `status` is one of created,
    authorized, captured, refunded, failed; `amount` is in paise."""

    id: str
    order_id: str | None
    amount: int
    status: str


@dataclass(frozen=True)
class RemoteOrder:
    """An order as Razorpay reports it (facts §A, §B): `status` is created, attempted or paid."""

    id: str
    amount: int
    amount_paid: int
    status: str


class Gateway(Protocol):
    key_id: str
    # The secret the Checkout handler's signature is made with (facts §F: the API key secret; in
    # mock mode MOCK_CHECKOUT_SECRET).
    checkout_secret: str

    def create_order(self, amount_paise: int, receipt: str) -> str: ...
    def fetch_payment(self, payment_id: str) -> Payment: ...
    def fetch_order(self, razorpay_order_id: str) -> RemoteOrder: ...
    def order_payments(self, razorpay_order_id: str) -> list[Payment]: ...
    def close(self) -> None: ...


def valid_id(value: str) -> bool:
    return bool(_ID.fullmatch(value))


def _int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise GatewayError(f"Razorpay answer has a non-integer {name}")
    return value


def _str(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise GatewayError(f"Razorpay answer has no {name}")
    return value


def parse_payment(data: Any) -> Payment:
    """A payment entity (facts §C; webhook `payload.payment.entity`, §G). Reads `status`, never
    the `captured` boolean (§G: samples show captured: true on non-captured payments)."""
    if not isinstance(data, dict):
        raise GatewayError("Razorpay payment is not an object")
    order_id = data.get("order_id")
    return Payment(
        id=_str(data.get("id"), "payment id"),
        order_id=order_id if isinstance(order_id, str) and order_id else None,
        amount=_int(data.get("amount"), "amount"),
        status=_str(data.get("status"), "status"),
    )


def _parse_order(data: Any) -> RemoteOrder:
    if not isinstance(data, dict):
        raise GatewayError("Razorpay order is not an object")
    return RemoteOrder(
        id=_str(data.get("id"), "order id"),
        amount=_int(data.get("amount"), "amount"),
        amount_paid=_int(data.get("amount_paid", 0), "amount_paid"),
        status=_str(data.get("status"), "status"),
    )


class RazorpayGateway:
    """Calls Razorpay's REST API (D-041). Needs the owner's approval for any real run (D-021,
    Gate C). Tests pass a fake `transport` so no request leaves the machine."""

    def __init__(
        self,
        key_id: str,
        key_secret: str,
        transport: httpx.BaseTransport | None = None,
        base_url: str = RAZORPAY_API,
    ):
        self.key_id = key_id
        self.checkout_secret = key_secret
        self._client = httpx.Client(
            base_url=base_url,
            auth=(key_id, key_secret),  # facts §A: Basic auth key_id:key_secret
            timeout=TIMEOUT_SECONDS,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def _call(self, method: str, path: str, json: dict[str, Any] | None = None) -> Any:
        try:
            r = self._client.request(method, path, json=json)
        except httpx.HTTPError as exc:
            raise GatewayError(f"Razorpay unreachable ({type(exc).__name__})") from None
        # Facts §A: success is 2xx (201/202 listed; 200 not described). Facts §I: errors are
        # 4xx/5xx with an error body we never pass on.
        if not 200 <= r.status_code < 300:
            raise GatewayError(f"Razorpay answered HTTP {r.status_code}")
        try:
            return r.json()
        except ValueError:
            raise GatewayError("Razorpay answer is not JSON") from None

    def create_order(self, amount_paise: int, receipt: str) -> str:
        """Facts §A: POST /v1/orders {amount (paise), currency, receipt (≤ 40 chars, unique)}.
        `partial_payment` and `payment_capture` are not sent (facts §A, §D). Returns the order
        id."""
        amount_paise = _int(amount_paise, "amount")
        if len(receipt) > 40:
            raise ValueError("receipt is longer than 40 characters")
        data = self._call(
            "POST", "/orders", {"amount": amount_paise, "currency": CURRENCY, "receipt": receipt}
        )
        order = _parse_order(data)
        if order.amount != amount_paise:
            raise GatewayError("Razorpay order amount differs from the request")
        return order.id

    def fetch_payment(self, payment_id: str) -> Payment:
        """Facts §C: GET /v1/payments/{id}."""
        if not valid_id(payment_id):
            raise GatewayError("not a payment id")
        payment = parse_payment(self._call("GET", f"/payments/{payment_id}"))
        if payment.id != payment_id:
            raise GatewayError("Razorpay answered for another payment")
        return payment

    def fetch_order(self, razorpay_order_id: str) -> RemoteOrder:
        """Facts §B: GET /v1/orders/{id}."""
        if not valid_id(razorpay_order_id):
            raise GatewayError("not an order id")
        return _parse_order(self._call("GET", f"/orders/{razorpay_order_id}"))

    def order_payments(self, razorpay_order_id: str) -> list[Payment]:
        """Facts §B: GET /v1/orders/{id}/payments → {entity: "collection", count, items}.
        Whether captured payments are listed is Not verified (§B); callers re-fetch each listed
        payment and also read the order's own status."""
        if not valid_id(razorpay_order_id):
            raise GatewayError("not an order id")
        data = self._call("GET", f"/orders/{razorpay_order_id}/payments")
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise GatewayError("Razorpay payment list has no items")
        return [parse_payment(item) for item in items]


class MockGateway:
    """No network, no money (D-042). Thread-safe: routes run in a thread pool."""

    key_id = "mock"
    checkout_secret = MOCK_CHECKOUT_SECRET

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._orders: dict[str, int] = {}  # razorpay order id -> amount (paise)
        self._payments: dict[str, Payment] = {}
        self._by_order: dict[str, list[str]] = {}

    def close(self) -> None:
        pass

    def create_order(self, amount_paise: int, receipt: str) -> str:
        amount_paise = _int(amount_paise, "amount")
        order_id = f"order_mock{receipt}"
        with self._lock:
            self._orders[order_id] = amount_paise
            self._by_order.setdefault(order_id, [])
        return order_id

    def complete(self, razorpay_order_id: str, amount_paise: int, outcome: str) -> Payment:
        """The customer pays (or fails to) in the mock Checkout. Each attempt is a new payment,
        as in Razorpay. `amount_paise` comes from our stored order, so an order made before a
        restart can still be completed."""
        if outcome not in ("captured", "failed"):
            raise ValueError(f"unknown outcome {outcome!r}")
        with self._lock:
            self._orders.setdefault(razorpay_order_id, amount_paise)
            attempts = self._by_order.setdefault(razorpay_order_id, [])
            suffix = razorpay_order_id.removeprefix("order_mock")
            payment = Payment(
                id=f"pay_mock{suffix}_{len(attempts) + 1}",
                order_id=razorpay_order_id,
                amount=self._orders[razorpay_order_id],
                status=outcome,
            )
            attempts.append(payment.id)
            self._payments[payment.id] = payment
        return payment

    def fetch_payment(self, payment_id: str) -> Payment:
        with self._lock:
            payment = self._payments.get(payment_id)
        if payment is None:
            raise GatewayError("mock payment not found")
        return payment

    def fetch_order(self, razorpay_order_id: str) -> RemoteOrder:
        with self._lock:
            if razorpay_order_id not in self._orders:
                raise GatewayError("mock order not found")
            amount = self._orders[razorpay_order_id]
            paid = any(
                self._payments[p].status == "captured"
                for p in self._by_order.get(razorpay_order_id, [])
            )
            attempted = bool(self._by_order.get(razorpay_order_id))
        status = "paid" if paid else "attempted" if attempted else "created"
        return RemoteOrder(razorpay_order_id, amount, amount if paid else 0, status)

    def order_payments(self, razorpay_order_id: str) -> list[Payment]:
        with self._lock:
            return [self._payments[p] for p in self._by_order.get(razorpay_order_id, [])]


def build_gateway(settings: Settings) -> Gateway:
    if settings.payments == "razorpay":
        return RazorpayGateway(settings.razorpay_key_id, settings.razorpay_key_secret)
    return MockGateway()
