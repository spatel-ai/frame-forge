"""Command line for banner templates (T-506; R-44, R-46, R-47).

    uv run python -m app.templates.cli add --kind start|end --name "Festive opening" clip.mp4
    uv run python -m app.templates.cli list [--all]
    uv run python -m app.templates.cli retire <id>

Works in any environment and costs nothing: no network, no paid service. Exit code 0 on success,
2 when the request is refused (nothing is written)."""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import Engine

from ..core.config import Settings
from ..core.database import make_engine
from . import service


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.templates.cli")
    sub = p.add_subparsers(dest="command", required=True)
    add = sub.add_parser("add", help="add a start or end banner clip")
    add.add_argument("--kind", required=True, choices=service.KINDS)
    add.add_argument("--name", required=True)
    add.add_argument("clip", type=Path)
    ls = sub.add_parser("list", help="list templates (active only unless --all)")
    ls.add_argument("--all", action="store_true")
    retire = sub.add_parser("retire", help="retire a template (never deleted)")
    retire.add_argument("id")
    return p


def main(
    argv: Sequence[str] | None = None,
    *,
    engine: Engine | None = None,
    settings: Settings | None = None,
) -> int:
    args = _parser().parse_args(argv)  # an unknown kind exits 2 here
    settings = settings or Settings()
    engine = engine or make_engine(settings.database_url)
    if args.command == "add":
        try:
            template_id = service.add_template(engine, settings, args.kind, args.name, args.clip)
        except service.TemplateRefused as exc:
            print(f"Refused: {exc}", file=sys.stderr)
            return 2
        print(template_id)
        return 0
    if args.command == "list":
        for t in service.list_templates(engine, active_only=not args.all):
            state = "" if t.active else "  [retired]"
            sound = "sound" if t.has_audio else "silent"
            print(f"{t.id}  {t.kind:<5}  {t.duration_ms / 1000:.1f}s  {sound}  {t.name}{state}")
        return 0
    if not service.retire_template(engine, args.id):
        print("Refused: no active template with that id.", file=sys.stderr)
        return 2
    print(f"Retired {args.id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
