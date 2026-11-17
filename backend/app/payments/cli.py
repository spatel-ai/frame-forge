"""Run payment reconciliation once (task T-405).

    uv run python -m app.payments.cli reconcile

Asks the payment gateway about orders still unpaid 30 minutes to 3 days after they were made and
credits any that were paid, through the one crediting routine. With AVATAR_PAYMENTS=razorpay this
calls Razorpay and needs the owner's approval for that run (D-021). In mock mode the mock gateway
starts empty in this process, so nothing is found. Never prints the database URL."""

import argparse
import sys

from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from ..core.config import Settings
from .gateway import build_gateway
from .service import PaymentService


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.payments.cli", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("reconcile", help="credit orders paid at the gateway but not yet confirmed")
    parser.parse_args(argv)

    settings = Settings()
    engine = create_engine(settings.database_url, poolclass=NullPool)
    gateway = build_gateway(settings)
    try:
        credited = PaymentService(settings, engine, gateway).reconcile_once()
    finally:
        gateway.close()
        engine.dispose()
    print(f"Reconciliation done ({settings.payments} mode): {credited} order(s) credited.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
