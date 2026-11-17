"""Payment routes: the M4 contract (task T-400).

Every handler answers 501 `not_implemented` until T-402 to T-404 build it.

- `/api/v1/payments/*` need a session and only ever touch the caller's own orders (another user's
  order is 404). Creating an order needs a confirmed email (403 `email_not_verified`, D-036).
- `POST /api/v1/webhooks/razorpay` has no session. It is trusted only through the signature on
  its raw body (backend rule 8). Razorpay's server sends no Origin header, so the origin check
  does not apply to it.
- `POST /api/v1/payments/mock/complete` exists only when AVATAR_PAYMENTS=mock and
  AVATAR_ENV=development (D-042). It plays the part of Razorpay Checkout so the real verify code
  runs without a network call."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ApiError, ErrorOut
from .schemas import (
    CreateOrderIn,
    MockCompleteIn,
    MockCompleteOut,
    OrderOut,
    OrderStatusOut,
    VerifyIn,
    VerifyOut,
)

router = APIRouter(prefix="/api/v1/payments", tags=["payments"])
webhook_router = APIRouter(prefix="/api/v1/webhooks", tags=["payments"])
mock_router = APIRouter(prefix="/api/v1/payments/mock", tags=["payments"])

User = Annotated[CurrentUser, Depends(current_user)]

_E: dict[str, Any] = {"model": ErrorOut}
R = dict[int | str, dict[str, Any]]


def _not_built() -> ApiError:
    return ApiError(501, "This is not built yet.", "not_implemented")


@router.post(
    "/orders",
    response_model=OrderOut,
    status_code=201,
    responses={401: _E, 403: _E, 422: _E, 502: _E},
    summary="Start buying credits: create a Razorpay order for whole rupees",
)
def create_order(body: CreateOrderIn, user: User) -> OrderOut:
    raise _not_built()


@router.get(
    "/orders/{order_id}",
    response_model=OrderStatusOut,
    responses={401: _E, 404: _E, 422: _E},
    summary="One of the caller's orders, for the 'still confirming' screen",
)
def get_order(order_id: str, user: User) -> OrderStatusOut:
    raise _not_built()


@router.post(
    "/verify",
    response_model=VerifyOut,
    responses={400: _E, 401: _E, 404: _E, 409: _E, 422: _E, 502: _E},
    summary="Confirm a payment after Checkout closes; credits the wallet once",
)
def verify_payment(body: VerifyIn, user: User) -> VerifyOut:
    raise _not_built()


@webhook_router.post(
    "/razorpay",
    status_code=200,
    responses={400: _E},
    summary="Razorpay webhook (signed raw body; deduped on the event id)",
)
def razorpay_webhook() -> dict[str, str]:
    raise _not_built()


@mock_router.post(
    "/complete",
    response_model=MockCompleteOut,
    responses={401: _E, 404: _E, 422: _E},
    summary="Development and mock mode only: act as Razorpay Checkout",
)
def mock_complete(body: MockCompleteIn, user: User) -> MockCompleteOut:
    raise _not_built()
