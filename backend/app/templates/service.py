"""Banner template database work and the add command's checks (T-506; R-44, R-46, R-47).

Only the command line adds or retires templates here (admin screens arrive in M6). Templates are
retired, never deleted. Everything is free: the clip is measured with ffprobe and copied, nothing
else."""

import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Engine, case, insert, select, update

from ..core.config import Settings
from ..media import MediaError, measure
from .models import Template

KINDS = ("start", "end")


class TemplateRefused(Exception):
    """The clip or the arguments cannot become a template; `str(error)` is a plain message."""


@dataclass(frozen=True)
class TemplateRow:
    id: str
    name: str
    kind: str
    clip_file: str
    preview_file: str
    duration_ms: int
    has_audio: bool
    active: bool


_COLUMNS = (
    Template.id,
    Template.name,
    Template.kind,
    Template.clip_file,
    Template.preview_file,
    Template.duration_ms,
    Template.has_audio,
    Template.active,
)


def templates_dir(settings: Settings) -> Path:
    return settings.data_dir / "templates"


def _is_portrait_9_16(width: int, height: int) -> bool:
    """True for a portrait clip whose shape is 9:16 within 2% (D-063)."""
    return height > width and abs(width * 16 - height * 9) <= 0.02 * height * 9


def add_template(engine: Engine, settings: Settings, kind: str, name: str, clip: Path) -> str:
    """Measure `clip`, copy it into the templates folder and insert the row; returns the id.

    Refuses (nothing written) an unknown kind, a blank name, a file that is not a playable video,
    a clip with no picture, or one longer than `settings.max_template_seconds` (R-44)."""
    if kind not in KINDS:
        raise TemplateRefused(f"Kind must be one of: {', '.join(KINDS)}.")
    name = name.strip()
    if not name:
        raise TemplateRefused("A template needs a name.")
    try:
        info = measure(clip)
    except MediaError as exc:
        raise TemplateRefused(str(exc)) from exc
    if info.duration > settings.max_template_seconds:
        raise TemplateRefused(
            f"The clip is {info.duration:.1f} s; banners may be at most "
            f"{settings.max_template_seconds:g} s."
        )
    # D-063: videos are mostly watched on phones, so banners are portrait 9:16 (within 2%).
    if not _is_portrait_9_16(info.width, info.height):
        raise TemplateRefused(
            f"The clip is {info.width}x{info.height}; banners must be portrait 9:16, "
            "for example 720x1280 or 1080x1920."
        )
    duration_ms = round(info.duration * 1000)
    if duration_ms <= 0:
        raise TemplateRefused("The clip has no length.")
    template_id = uuid.uuid4().hex
    file_name = f"{template_id}.mp4"
    folder = templates_dir(settings)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / file_name
    shutil.copyfile(clip, target)
    try:
        with engine.begin() as conn:
            conn.execute(
                insert(Template).values(
                    id=template_id,
                    name=name,
                    kind=kind,
                    clip_file=file_name,
                    preview_file=file_name,  # the preview is the clip itself
                    duration_ms=duration_ms,
                    has_audio=info.has_audio,
                    active=True,
                    created_by=None,
                    created_at=datetime.now(timezone.utc),
                )
            )
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return template_id


def list_templates(engine: Engine, *, active_only: bool = True) -> list[TemplateRow]:
    """Templates, start then end, by name (R-46); retired ones only when asked for."""
    stmt = select(*_COLUMNS).order_by(
        case((Template.kind == "start", 0), else_=1), Template.name, Template.id
    )
    if active_only:
        stmt = stmt.where(Template.active.is_(True))
    with engine.connect() as conn:
        return [TemplateRow(*r) for r in conn.execute(stmt).all()]


def get_active(engine: Engine, template_id: str) -> TemplateRow | None:
    """An active template, or None (unknown or retired)."""
    with engine.connect() as conn:
        r = conn.execute(
            select(*_COLUMNS).where(Template.id == template_id, Template.active.is_(True))
        ).first()
    return TemplateRow(*r) if r else None


def retire_template(engine: Engine, template_id: str) -> bool:
    """Set active=false. False when there is no active template with that id. The row and file
    stay, because old jobs may still point at it."""
    with engine.begin() as conn:
        result = conn.execute(
            update(Template)
            .where(Template.id == template_id, Template.active.is_(True))
            .values(active=False)
        )
    return result.rowcount == 1
