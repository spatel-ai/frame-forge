"""Script library shapes (T-500 contract; built in T-504)."""

from pydantic import BaseModel


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
