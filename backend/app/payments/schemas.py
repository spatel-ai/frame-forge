"""Request and response shapes for the payment routes: the M4 contract (task T-400).

The customer buys whole credits (D-047); ₹1 = 1 credit (D-007), so the rupees paid equal the
credits. Only `amount_paise`, sent to Razorpay, is money. Always integers (D-014).
See docs/M4-PLAN.md and docs/RAZORPAY-FACTS.md."""

from typing import Literal

from pydantic import BaseModel, Field

from ..wallet.schemas import WalletOut

# `created`: waiting for payment. `paid`: credited (exactly once). `failed`: a definite failure was
# seen; a later capture of the same order still credits it (HLD §5.1).
OrderStatus = Literal["created", "paid", "failed"]


class CreateOrderIn(BaseModel):
    # Whole credits. The limits (500 to 10,000, Q-06) are checked by the service so the 422
    # names the field with the customer's message.
    credits: int


class OrderOut(BaseModel):
    order_id: str  # ours
    razorpay_order_id: str
    amount_paise: int
    credits: int
    # Public key id for Razorpay Checkout; never a secret. In mock mode, "mock".
    key_id: str
    status: OrderStatus


class OrderStatusOut(BaseModel):
    order_id: str
    status: OrderStatus
    credits: int
    created_at: str


class VerifyIn(BaseModel):
    # Our order id: the signature is checked against the Razorpay order id WE stored for it,
    # never one sent by the browser (HLD §5.1).
    order_id: str
    razorpay_payment_id: str = Field(min_length=1, max_length=64)
    razorpay_signature: str = Field(min_length=1, max_length=256)


class VerifyOut(BaseModel):
    order_id: str
    status: OrderStatus
    credits: int
    wallet: WalletOut


class MockCompleteIn(BaseModel):
    order_id: str
    outcome: Literal["captured", "failed"]


class MockCompleteOut(BaseModel):
    """What Razorpay Checkout's handler would give the browser, signed with the mock secret."""

    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
