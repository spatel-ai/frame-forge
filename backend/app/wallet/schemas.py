"""Response shapes for the wallet routes: the M3 contract (task T-300).

All amounts are whole credits (D-014); ₹1 paid = 1 credit (D-007).
Available = balance − reserved."""

from typing import Literal

from pydantic import BaseModel

LedgerKind = Literal[
    "purchase",  # M4: a confirmed Razorpay payment
    "grant",  # M3: the developer-only command (development environment only)
    "voice_charge",  # D-038: 10 credits when a job is submitted
    "voice_return",  # D-038: returned when the voice fails to generate
    "hold",  # D-005: the video price, reserved at approval
    "capture",  # D-005: the held price taken on delivery (or on an unknown outcome, Q-19)
    "release",  # D-005: the held price returned on a clear failure
    "adjustment",  # M6: an audited admin correction
    "refund",  # M4/M6: a Razorpay refund
]


class WalletOut(BaseModel):
    balance_credits: int
    reserved_credits: int
    available_credits: int


class LedgerEntryOut(BaseModel):
    id: str
    kind: LedgerKind
    # Signed change to the balance: negative for voice_charge and capture, positive for
    # purchase, grant and voice_return, zero for hold and release (they move `reserved` only).
    credits: int
    balance_after: int
    reserved_after: int
    job_id: str | None
    created_at: str


class TransactionsOut(BaseModel):
    items: list[LedgerEntryOut]  # newest first
    total: int
    page: int
    page_size: int
