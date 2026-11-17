"""Banner template shapes (T-500 contract; built in T-506)."""

from typing import Literal

from pydantic import BaseModel


class TemplateOut(BaseModel):
    id: str
    name: str
    kind: Literal["start", "end"]
    duration_ms: int
    has_audio: bool
    # GET /api/v1/templates/{id}/preview: a short playable clip (Q-16: plays the clip's sound).
    preview_url: str


class TemplatesOut(BaseModel):
    items: list[TemplateOut]  # active templates only, start then end, by name
