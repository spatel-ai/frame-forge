"""Declared response shapes for the job routes (task T-104).

The frontend generates its TypeScript types from these through the OpenAPI document."""

from typing import Literal

from pydantic import BaseModel

JobStatus = Literal[
    "audio_generating",
    "audio_ready",
    "video_submitting",
    "video_generating",
    "video_assembling",  # M5: joining the banners (D-019); only for jobs with a banner (D-058)
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
    # M5 (T-500). The consent sentence shown on Create and its version; POST /jobs sends the
    # version back so the job records what the customer agreed to (D-045, Q-11).
    consent_version: str
    consent_text: str
    # Video approvals allowed per customer per day; null means no limit (production, D-046).
    daily_video_limit: int | None


# Why a failed job failed, for the failure screens (M5 boards "Voice failures" and "Video
# failures"). Derived from the job's stored state; null unless status is "failed".
FailureKind = Literal[
    "voice_failed",  # the voice could not be made or came out empty: 10 credits returned
    "voice_unknown",  # the voice call's outcome is unknown: 10 credits returned (D-048)
    "voice_too_long",  # the voice is longer than a video can be: charge kept, voice saved (D-040)
    "video_failed",  # the video failed or timed out: hold released, voice kept (D-043)
    "video_unknown",  # the video submission's outcome is unknown: charged, flagged (Q-19, D-051)
]


class TemplateRef(BaseModel):
    id: str
    name: str


class JobOut(BaseModel):
    id: str
    status: JobStatus
    language: str
    script: str
    audio_duration_seconds: float | None
    # The video price in credits, fixed when the voice is ready (D-006); null before that.
    price_credits: int | None
    # Credits taken from the wallet for this job so far (voice charge, then the captured price).
    # Always voice_credits + video_credits.
    charged_credits: int
    # M5 (T-500), for the video detail's "What it cost": the voice charge less any return, and
    # the captured video price. Banners are free (D-020).
    voice_credits: int
    video_credits: int
    audio_url: str | None
    video_url: str | None
    error: str | None
    # M5 (T-500). Null unless status is "failed".
    failure_kind: FailureKind | None
    # True when this failed job's voice can start a new job without a new voice charge (D-043):
    # the voice exists and is within the current length limit.
    voice_reusable: bool
    # Flagged for staff (D-048, D-051, Q-19).
    needs_review: bool
    # When the customer gave consent for this job (D-045); null for jobs made before M5.
    consent_at: str | None
    # The saved script this job's text came from, if any (D-017). The job keeps its own copy.
    script_id: str | None
    # The failed job whose voice this job reuses (D-043), if any.
    voice_from_job_id: str | None
    # Banners chosen (D-058); null when none.
    start_template: TemplateRef | None
    end_template: TemplateRef | None
    # Null when no banner was chosen or joining has not finished; true when the delivered video
    # has them; false when joining failed and the video was delivered without them (D-019).
    banners_applied: bool | None
    created_at: str
    updated_at: str


class JobSummaryOut(BaseModel):
    """One row of the Videos list and Home (T-501)."""

    id: str
    status: JobStatus
    language: str
    # The first 120 characters of the job's script.
    script_excerpt: str
    audio_duration_seconds: float | None
    failure_kind: FailureKind | None
    created_at: str
    updated_at: str


class JobsOut(BaseModel):
    items: list[JobSummaryOut]  # newest first
    total: int
    page: int
    page_size: int


class SavedVoiceOut(BaseModel):
    """A voice from one of the caller's failed jobs that can start a new job (D-043, D-050)."""

    job_id: str
    language: str
    script: str
    audio_duration_seconds: float
    # What the video would cost with this voice: ceil(seconds x credits_per_second) (D-006).
    price_credits: int
    audio_url: str
    created_at: str


class SavedVoicesOut(BaseModel):
    items: list[SavedVoiceOut]  # newest first
