"""Developer-only command to add test credits (task T-306, R-13).

    uv run python -m app.wallet.cli grant <email> <credits>

This is the M3 development-only exception to "credits are granted only by the one crediting
routine" (backend rule 7): it goes through the ledger's `grant` (so the ledger stays the only
writer), but it exists only until payments (M4) are the real way to get credits. It refuses to
run unless AVATAR_ENV is "development" (exit 2). Unknown email: exit 1. It uses
Settings().database_url and never prints it."""

import argparse
import sys
import uuid

from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from ..auth.store import AuthStore
from ..core.config import Settings
from .ledger import WalletStore


def _positive_int(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"credits must be a whole number, not {text!r}") from None
    if value <= 0:
        raise argparse.ArgumentTypeError("credits must be greater than 0")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.wallet.cli", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    g = sub.add_parser("grant", help="add test credits to a user (development only)")
    g.add_argument("email")
    g.add_argument("credits", type=_positive_int)
    args = parser.parse_args(argv)  # exits with 2 on bad input

    settings = Settings()
    if settings.environment != "development":
        print(
            "Refused: this command only runs when AVATAR_ENV is 'development'. "
            "In other environments credits come from payments.",
            file=sys.stderr,
        )
        return 2

    engine = create_engine(settings.database_url, poolclass=NullPool)
    try:
        user = AuthStore(engine).get_user_by_email(args.email.strip().lower())
        if user is None:
            print("No user with that email.", file=sys.stderr)
            return 1
        WalletStore(engine).grant(
            user["id"], args.credits, ref_id=uuid.uuid4().hex, created_by="cli"
        )
        w = WalletStore(engine).get_wallet(user["id"])
    finally:
        engine.dispose()
    print(
        f"Granted {args.credits} credits. Balance: {w.balance_credits}, "
        f"available: {w.available_credits}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
