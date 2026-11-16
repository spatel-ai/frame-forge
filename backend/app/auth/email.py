"""Sending email (D-037). Only a development sender exists: it writes the message to the log.

This logger is the ONLY place an email address or an emailed link may be logged."""

import logging
from typing import Protocol

from ..core.config import Settings

log = logging.getLogger("app.auth.email")


class EmailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class LogEmailSender:
    """Development: no mail leaves the machine; read the link in the server log."""

    def send(self, to: str, subject: str, body: str) -> None:
        log.info("Email to %s | %s\n%s", to, subject, body)


def build_email_sender(settings: Settings) -> EmailSender:
    if settings.environment == "development":
        return LogEmailSender()
    raise RuntimeError(
        f"AVATAR_ENV is {settings.environment!r} but no email provider is configured. "
        "Customers could not receive confirmation or reset emails. Set AVATAR_ENV=development "
        "to log emails instead, or configure a provider."
    )
