"""The banner library's work: checks, files and database rows (D-067; R-12, customer rules 1, 4, 5).

A banner is a logo or designed card the customer uploads once. The upload is verified and
re-encoded with Pillow (transparency kept) and stored as PNG at
`<data_dir>/banners/<user_id>/<banner_id>.png`. Every query is scoped to `user_id`, so another
user's banner cannot be found at all (R-12). Deleting is soft and keeps the file, because a past
job may still use it. Image content and banner names are never logged.

For job code: `get_owned_file(engine, user_id, banner_id)` returns the stored PNG path or None."""

import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy import Engine, func, select, text, update

from ..core.config import Settings
from ..core.errors import ApiError
from .models import Banner

MAX_BANNERS_PER_USER = 20
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIN_SIDE_PX = 200
MAX_SIDE_PX = 4000
NAME_MAX = 60
_FORMATS = {"PNG", "JPEG", "WEBP"}


@dataclass(frozen=True)
class BannerRow:
    id: str
    name: str
    image_file: str
    width: int
    height: int
    created_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def banners_dir(data_dir: Path, user_id: str) -> Path:
    return data_dir / "banners" / user_id


def _invalid(field: str, message: str) -> ApiError:
    return ApiError(422, message, "validation_error", fields={field: message})


def check_name(name: str) -> str:
    """The stripped name, or a 422 naming `name`."""
    name = name.strip()
    if not name:
        raise _invalid("name", "Give the banner a name.")
    if len(name) > NAME_MAX:
        raise _invalid("name", f"Use a name of at most {NAME_MAX} characters.")
    return name


def clean_image(raw: bytes) -> tuple[bytes, int, int]:
    """Verify an upload and re-encode it as PNG, keeping transparency (customer rule 5).
    Returns (png bytes, width, height); raises a 422 naming `image`."""
    if not raw:
        raise _invalid("image", "The image file is empty. Choose an image and try again.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise _invalid("image", "The image is larger than 5 MB. Choose a smaller image.")
    unreadable = "The file is not a readable image. Choose a PNG, JPEG or WebP image."
    try:
        image = Image.open(BytesIO(raw))
        image_format = image.format
        size = image.size
    except Exception:
        raise _invalid("image", unreadable) from None
    if image_format not in _FORMATS:
        raise _invalid("image", "Use a PNG, JPEG or WebP image.")
    # Sizes are checked before decoding, so an oversized picture is never expanded in memory.
    if min(size) < MIN_SIDE_PX:
        raise _invalid(
            "image",
            f"The image must be at least {MIN_SIDE_PX} pixels on each side. Choose a larger image.",
        )
    if max(size) > MAX_SIDE_PX:
        raise _invalid(
            "image",
            f"The image must be at most {MAX_SIDE_PX} pixels on each side. Choose a smaller image.",
        )
    try:
        image.load()
        upright = ImageOps.exif_transpose(image)
        has_alpha = upright.mode in ("RGBA", "LA", "PA") or "transparency" in upright.info
        out = BytesIO()
        upright.convert("RGBA" if has_alpha else "RGB").save(out, "PNG")
        return out.getvalue(), upright.width, upright.height
    except Exception:
        raise _invalid("image", unreadable) from None


_COLUMNS = (
    Banner.id,
    Banner.name,
    Banner.image_file,
    Banner.width,
    Banner.height,
    Banner.created_at,
)


def create(engine: Engine, data_dir: Path, user_id: str, name: str, raw: bytes) -> BannerRow:
    """Check and save a banner. Both inputs are checked first and reported together; nothing is
    written to disk or the database when any check fails. The per-user limit is counted under a
    row lock on the user, so two uploads at once cannot pass the limit together."""
    problems: dict[str, str] = {}
    clean_name = ""
    png = b""
    width = height = 0
    try:
        clean_name = check_name(name)
    except ApiError as exc:
        problems.update(exc.fields or {})
    try:
        png, width, height = clean_image(raw)
    except ApiError as exc:
        problems.update(exc.fields or {})
    if problems:
        raise ApiError(422, next(iter(problems.values())), "validation_error", fields=problems)

    banner_id = uuid.uuid4().hex
    image_file = f"{banner_id}.png"
    folder = banners_dir(data_dir, user_id)
    final = folder / image_file
    partial = folder / f".{banner_id}.part"
    now = _now()
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT id FROM users WHERE id = :u FOR UPDATE"), {"u": user_id})
            live = conn.execute(
                select(func.count())
                .select_from(Banner)
                .where(Banner.user_id == user_id, Banner.deleted_at.is_(None))
            ).scalar_one()
            if live >= MAX_BANNERS_PER_USER:
                raise _invalid(
                    "image",
                    f"You can keep up to {MAX_BANNERS_PER_USER} banners. "
                    "Delete one you no longer use, then try again.",
                )
            folder.mkdir(parents=True, exist_ok=True)
            partial.write_bytes(png)
            os.replace(partial, final)
            conn.execute(
                text(
                    "INSERT INTO banners (id, user_id, name, image_file, width, height, "
                    "created_at) VALUES (:id, :u, :name, :file, :w, :h, :now)"
                ),
                {
                    "id": banner_id,
                    "u": user_id,
                    "name": clean_name,
                    "file": image_file,
                    "w": width,
                    "h": height,
                    "now": now,
                },
            )
    except BaseException:
        # Nothing was committed, so leave nothing on disk either.
        partial.unlink(missing_ok=True)
        final.unlink(missing_ok=True)
        raise
    return BannerRow(banner_id, clean_name, image_file, width, height, now)


def list_banners(engine: Engine, user_id: str) -> list[BannerRow]:
    """The user's live banners, newest first."""
    with engine.connect() as conn:
        rows = conn.execute(
            select(*_COLUMNS)
            .where(Banner.user_id == user_id, Banner.deleted_at.is_(None))
            .order_by(Banner.created_at.desc(), Banner.id)
        ).all()
    return [BannerRow(*r) for r in rows]


def get_banner(engine: Engine, user_id: str, banner_id: str) -> BannerRow | None:
    """One live banner of this user, or None (missing, deleted or someone else's: R-12)."""
    with engine.connect() as conn:
        r = conn.execute(
            select(*_COLUMNS).where(
                Banner.id == banner_id, Banner.user_id == user_id, Banner.deleted_at.is_(None)
            )
        ).first()
    return BannerRow(*r) if r else None


def delete_banner(engine: Engine, user_id: str, banner_id: str) -> bool:
    """Soft delete; the file stays. False when there is no live banner of this user's."""
    with engine.begin() as conn:
        result = conn.execute(
            update(Banner)
            .where(Banner.id == banner_id, Banner.user_id == user_id, Banner.deleted_at.is_(None))
            .values(deleted_at=_now())
        )
    return result.rowcount == 1


def get_owned_file(
    engine: Engine, user_id: str, banner_id: str, data_dir: Path | None = None
) -> Path | None:
    """The stored PNG of one of this user's live banners, or None (missing, deleted, someone
    else's, or the file is gone). `data_dir` defaults to `Settings().data_dir`; the app's own
    routes pass the running app's setting."""
    row = get_banner(engine, user_id, banner_id)
    if row is None:
        return None
    base = data_dir if data_dir is not None else Settings().data_dir
    path = banners_dir(base, user_id) / row.image_file
    return path if path.is_file() else None
