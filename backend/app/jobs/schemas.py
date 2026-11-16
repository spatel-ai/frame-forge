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
    video_price_per_second_usd: float


class JobOut(BaseModel):
    id: str
    status: JobStatus
    language: str
    script: str
    audio_duration_seconds: float | None
    estimated_video_cost_usd: float | None
    audio_url: str | None
    video_url: str | None
    error: str | None
    created_at: str
    updated_at: str
