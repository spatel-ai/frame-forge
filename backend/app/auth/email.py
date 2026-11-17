"""Sending email (D-037, T-550; R-01, R-13).

`SmtpEmailSender` sends through the owner's Gmail with only the standard library: STARTTLS on
port 587, then login. `LogEmailSender` is the development fallback and writes the message to the
log. This module's logger is the ONLY place an email address or an emailed link may be logged;
the SMTP password is never logged anywhere."""

import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from typing import Protocol

from ..core.config import Settings

log = logging.getLogger("app.auth.email")

SMTP_TIMEOUT_SECONDS = 15


class EmailSender(Protocol):
    def send(self, to: str, subject: str, text: str, html: str | None = None) -> None: ...


class LogEmailSender:
    """Development: no mail leaves the machine; read the link in the server log."""

    def send(self, to: str, subject: str, text: str, html: str | None = None) -> None:
        log.info("Email to %s | %s\n%s", to, subject, text)


class SmtpEmailSender:
    """Gmail SMTP (smtp.gmail.com:587, STARTTLS, login). The From address is the username.
    `send` raises on failure; callers decide to catch (sign-up and reset do, R-01)."""

    def __init__(self, settings: Settings):
        self._host = settings.smtp_host
        self._port = settings.smtp_port
        self._username = settings.smtp_username
        self._password = settings.smtp_password
        self._from_name = settings.mail_from_name

    def send(self, to: str, subject: str, text: str, html: str | None = None) -> None:
        message = EmailMessage()
        message["From"] = formataddr((self._from_name, self._username))
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text)
        if html is not None:
            message.add_alternative(html, subtype="html")
        with smtplib.SMTP(self._host, self._port, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
            smtp.starttls()
            smtp.login(self._username, self._password)
            smtp.send_message(message)


def build_email_sender(settings: Settings) -> EmailSender:
    if settings.smtp_configured:
        return SmtpEmailSender(settings)
    if settings.environment == "development":
        return LogEmailSender()
    raise RuntimeError(
        f"AVATAR_ENV is {settings.environment!r} but SMTP is not configured. Customers could not "
        "receive confirmation or reset emails. Set USER_EMAIL and USER_EMAIL_PASSWORD "
        "(a Gmail App Password), or set AVATAR_ENV=development to log emails instead."
    )
