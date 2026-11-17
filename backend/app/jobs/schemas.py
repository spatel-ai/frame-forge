"""Declared response shapes for the job routes (task T-104).

The frontend generates its TypeScript types from these through the OpenAPI document."""

from typing import Literal

from pydantic import BaseModel

JobStatus = Literal[
    "audio_generating",
    "audio_ready",
    "video_submitting",
    "video_generating",
    "completed",
    "failed",
]


class ConfigOut(BaseModel):
    provider: Literal["mock", "fal"]
    max_audio_seconds: float
    max_script_chars: int
    max_image_mb: int
    languages: list[str]
    # Prices in whole credits (D-006, D-038). The company's own cost is never sent.
    credits_per_second: int
    voice_price_credits: int
    # Payments (M4, D-042). The key id is public; it is null in mock mode. Never a secret.
    payments: Literal["mock", "razorpay"]
    razorpay_key_id: str | None
    min_purchase_credits: int
    max_purchase_credits: int
    # The payment fee the customer pays, in basis points (D-060). Display only: amounts come
    # from GET /payments/quote, so the browser never computes money.
    payment_fee_bps: int
    payment_fee_gst_bps: int
    # Where customers write for help (D-055); null until the owner sets AVATAR_SUPPORT_EMAIL.
    support_email: str | None


class JobOut(BaseModel):
    id: str
    status: JobStatus
    language: str
    script: str
    audio_duration_seconds: float | None
    # The video price in credits, fixed when the voice is ready (D-006); null before that.
    price_credits: int | None
    # Credits taken from the wallet for this job so far (voice charge, then the captured price).
    charged_credits: int
    audio_url: str | None
    video_url: str | None
    error: str | None
    created_at: str
    updated_at: str
