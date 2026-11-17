"""`uv run python -m app.auth.mailcheck <to-address>`: send ONE test email (T-550, R-01, R-13).

Builds the sender from Settings exactly like the app does. Does not touch the database.
Prints only a one-line outcome: never the password, never the SMTP transcript.
Exit codes: 0 sent, 1 failed, 2 SMTP not configured."""

import sys

from ..core.config import Settings
from ..core.mail_templates import test_email
from .email import SmtpEmailSender, build_email_sender


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("Usage: python -m app.auth.mailcheck <to-address>")
        return 2
    to = args[0]
    secret = ""
    try:
        settings = Settings()
        secret = settings.smtp_password
        if not settings.smtp_configured:
            print("SMTP is not configured (USER_EMAIL / USER_EMAIL_PASSWORD missing)")
            return 2
        sender = build_email_sender(settings)
        assert isinstance(sender, SmtpEmailSender)
        subject, text, html = test_email(settings)
        sender.send(to, subject, text, html)
    except Exception as exc:
        # The message of an SMTP error may name the server's reply, never the password.
        message = str(exc).replace(secret, "***") if secret else str(exc)
        print(f"FAILED: {type(exc).__name__}: {message}")
        return 1
    print(f"Sent to {to} via {settings.smtp_host}:{settings.smtp_port} as {settings.smtp_username}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
