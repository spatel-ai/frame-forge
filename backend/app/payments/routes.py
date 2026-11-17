"""Payment routes: the M4 contract (task T-400), built in T-402 to T-404.

- `/api/v1/payments/*` need a session and only ever touch the caller's own orders (another user's
  order is 404). Creating an order needs a confirmed email (403 `email_not_verified`, D-049).
- `POST /api/v1/webhooks/razorpay` has no session. It is trusted only through the signature on
  its raw body (backend rule 8). Razorpay's server sends no Origin header, so the origin check
  does not apply to it.
- `POST /api/v1/payments/mock/complete` exists only when AVATAR_PAYMENTS=mock and
  AVATAR_ENV=development (D-042). It plays the part of Razorpay Checkout so the real verify code
  runs without a network call.

The work is in `service.py`; these handlers only translate HTTP."""

import logging
from datetime import timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import Row
from starlette.concurrency import run_in_threadpool

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ApiError, ErrorOut
from ..wallet.schemas import WalletOut
from .schemas import (
    CreateOrderIn,
    MockCompleteIn,
    MockCompleteOut,
    OrderOut,
    OrderStatusOut,
    QuoteOut,
    VerifyIn,
    VerifyOut,
)
from .service import InvalidWebhook, PaymentService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/payments", tags=["payments"])
webhook_router = APIRouter(prefix="/api/v1/webhooks", tags=["payments"])
mock_router = APIRouter(prefix="/api/v1/payments/mock", tags=["payments"])

User = Annotated[CurrentUser, Depends(current_user)]

_E: dict[str, Any] = {"model": ErrorOut}


def _confirmed_user(user: User) -> CurrentUser:
    # D-049: buying needs a confirmed email. Worded for buying, not for making videos.
    if not user.email_verified:
        raise ApiError(
            403,
            "Confirm your email before buying credits. We sent you a link; you can ask for a "
            "new one.",
            "email_not_verified",
        )
    return user


ConfirmedUser = Annotated[CurrentUser, Depends(_confirmed_user)]


def _service(request: Request) -> PaymentService:
    return request.app.state.payments


def _iso(order: Row) -> str:
    return order.created_at.astimezone(timezone.utc).isoformat(timespec="seconds")


def _order_out(service: PaymentService, order: Row) -> OrderOut:
    return OrderOut(
        order_id=order.id,
        razorpay_order_id=order.razorpay_order_id,
        amount_paise=order.amount_paise,
        price_paise=order.price_paise,
        fee_paise=order.fee_paise,
        fee_gst_paise=order.fee_gst_paise,
        credits=order.credits,
        key_id=service.gateway.key_id,
        status=order.status,
    )


@router.get(
    "/quote",
    response_model=QuoteOut,
    responses={401: _E, 422: _E},
    summary="What buying a number of credits costs, with the payment fee (D-060)",
)
def get_quote(request: Request, user: User, credits: Annotated[int, Query()]) -> QuoteOut:
    q = _service(request).quote(credits)
    return QuoteOut(
        credits=q.credits,
        price_paise=q.price_paise,
        fee_paise=q.fee_paise,
        fee_gst_paise=q.fee_gst_paise,
        amount_paise=q.amount_paise,
    )


@router.post(
    "/orders",
    response_model=OrderOut,
    status_code=201,
    responses={401: _E, 403: _E, 422: _E, 502: _E},
    summary="Start buying credits: create a Razorpay order for a number of credits",
)
def create_order(request: Request, body: CreateOrderIn, user: ConfirmedUser) -> OrderOut:
    service = _service(request)
    return _order_out(service, service.create_order(user.id, body.credits))


@router.get(
    "/orders/{order_id}",
    response_model=OrderStatusOut,
    responses={401: _E, 404: _E, 422: _E},
    summary="One of the caller's orders, for the 'still confirming' screen",
)
def get_order(request: Request, order_id: str, user: User) -> OrderStatusOut:
    order = _service(request).get_owned(order_id, user.id)
    return OrderStatusOut(
        order_id=order.id, status=order.status, credits=order.credits, created_at=_iso(order)
    )


@router.post(
    "/verify",
    response_model=VerifyOut,
    responses={400: _E, 401: _E, 404: _E, 409: _E, 422: _E, 502: _E},
    summary="Confirm a payment after Checkout closes; credits the wallet once",
)
def verify_payment(request: Request, body: VerifyIn, user: User) -> VerifyOut:
    order, wallet = _service(request).verify(
        user.id, body.order_id, body.razorpay_payment_id, body.razorpay_signature
    )
    return VerifyOut(
        order_id=order.id,
        status=order.status,
        credits=order.credits,
        wallet=WalletOut(
            balance_credits=wallet.balance_credits,
            reserved_credits=wallet.reserved_credits,
            available_credits=wallet.available_credits,
        ),
    )


@webhook_router.post(
    "/razorpay",
    status_code=200,
    responses={400: _E},
    summary="Razorpay webhook (signed raw body; deduped on the event id)",
)
async def razorpay_webhook(request: Request) -> dict[str, str]:
    # The raw bytes, exactly as sent: the signature is checked on them before any parsing.
    body = await request.body()
    try:
        outcome = await run_in_threadpool(
            _service(request).handle_webhook,
            body,
            request.headers.get("x-razorpay-signature"),
            request.headers.get("x-razorpay-event-id"),
        )
    except InvalidWebhook:
        raise ApiError(
            400, "This notification is not signed correctly.", "webhook_signature_invalid"
        ) from None
    log.info("razorpay webhook: %s", outcome)
    return {"status": "ok"}


@mock_router.post(
    "/complete",
    response_model=MockCompleteOut,
    responses={401: _E, 404: _E, 422: _E},
    summary="Development and mock mode only: act as Razorpay Checkout",
)
def mock_complete(request: Request, body: MockCompleteIn, user: User) -> MockCompleteOut:
    razorpay_order_id, payment_id, signature = _service(request).mock_complete(
        user.id, body.order_id, body.outcome
    )
    return MockCompleteOut(
        razorpay_order_id=razorpay_order_id,
        razorpay_payment_id=payment_id,
        razorpay_signature=signature,
    )
