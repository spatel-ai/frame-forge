"""Script library shapes (T-500 contract; built in T-504)."""

from pydantic import BaseModel


class ScriptIn(BaseModel):
    """A script saved on its own from My scripts (owner request, 2026-11-17, R1 test order)."""

    language: str
    text: str


class ScriptOut(BaseModel):
    id: str
    language: str
    text: str
    created_at: str
    last_used_at: str


class ScriptsOut(BaseModel):
    items: list[ScriptOut]  # most recently used first
    total: int
    page: int
    page_size: int
