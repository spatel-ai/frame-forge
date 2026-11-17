"""T-550 (R-01, R-13): the Gmail SMTP sender, its selection at start-up, failure handling, the
secret never leaking, and the `mailcheck` command. smtplib is patched: no mail is sent."""

import logging
from dataclasses import replace
from email import message_from_bytes, policy
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.auth import mailcheck
from app.auth.email import LogEmailSender, SmtpEmailSender, build_email_sender
from app.core.config import Settings
from app.main import create_app

SECRET = "app-pass-w0rd-SECRET"


def smtp_settings(**kw) -> Settings:
    base = dict(
        smtp_host="smtp.gmail.com",
        smtp_port=587,
        smtp_username="owner@gmail.com",
        smtp_password=SECRET,
        mail_from_name="Frameforge",
    )
    return replace(Settings(), **{**base, **kw})


def fake_smtp():
    """A patched smtplib.SMTP whose context manager yields the same mock."""
    cls = MagicMock()
    inst = cls.return_value
    inst.__enter__.return_value = inst
    return cls, inst


def test_sender_uses_starttls_login_and_configured_values():
    """R-01: STARTTLS then login with the configured host, port, timeout, user and password."""
    cls, inst = fake_smtp()
    with patch("smtplib.SMTP", cls):
        SmtpEmailSender(smtp_settings()).send("to@example.com", "Hi", "plain", "<p>html</p>")
    cls.assert_called_once_with("smtp.gmail.com", 587, timeout=15)
    names = [c[0] for c in inst.method_calls if c[0] in ("starttls", "login", "send_message")]
    assert names == ["starttls", "login", "send_message"]
    inst.login.assert_called_once_with("owner@gmail.com", SECRET)
    msg = inst.send_message.call_args.args[0]
    assert msg["To"] == "to@example.com" and msg["Subject"] == "Hi"
    assert "owner@gmail.com" in msg["From"] and "Frameforge" in msg["From"]
    parsed = message_from_bytes(msg.as_bytes(), policy=policy.default)
    assert "plain" in parsed.get_body(("plain",)).get_content()
    assert "<p>html</p>" in parsed.get_body(("html",)).get_content()


def test_log_sender_still_logs_the_text(caplog):
    with caplog.at_level(logging.INFO, logger="app.auth.email"):
        LogEmailSender().send("a@b.com", "Subj", "the text", "<p>x</p>")
    assert "the text" in caplog.text


def test_selection_rules():
    assert isinstance(build_email_sender(smtp_settings()), SmtpEmailSender)
    # SMTP wins in any environment.
    assert isinstance(
        build_email_sender(
            smtp_settings(
                environment="production",
                payments="razorpay",
                razorpay_key_id="rzp_live_x",
                razorpay_key_secret="s",
            )
        ),
        SmtpEmailSender,
    )
    dev = replace(Settings(), smtp_username="", smtp_password="")
    assert isinstance(build_email_sender(dev), LogEmailSender)
    with pytest.raises(RuntimeError, match="SMTP is not configured"):
        build_email_sender(
            replace(
                dev,
                environment="production",
                payments="razorpay",
                razorpay_key_id="rzp_live_x",
                razorpay_key_secret="s",
            )
        )
    # A username without a password is not configured.
    assert isinstance(build_email_sender(replace(dev, smtp_username="x@gmail.com")), LogEmailSender)


def test_production_starts_with_smtp_and_refuses_without(tmp_path, database_url):
    base = replace(
        Settings(),
        provider="mock",
        payments="razorpay",
        razorpay_key_id="rzp_live_x",
        razorpay_key_secret="s",
        environment="production",
        data_dir=tmp_path,
        database_url=database_url,
    )
    with patch("smtplib.SMTP", fake_smtp()[0]):
        app = create_app(
            replace(base, smtp_username="o@gmail.com", smtp_password=SECRET), start_poller=False
        )
        with TestClient(app):
            pass
    app = create_app(replace(base, smtp_username="", smtp_password=""), start_poller=False)
    with pytest.raises(RuntimeError, match="SMTP is not configured"):
        with TestClient(app):
            pass


def test_send_failure_is_swallowed_and_logged_without_secrets(tmp_path, database_url, caplog):
    """R-01: sign-up succeeds when the mail server fails; the log has no password or body."""
    cls, inst = fake_smtp()
    inst.login.side_effect = OSError(f"auth failed for {SECRET}")  # even a leaky error text
    settings = smtp_settings(provider="mock", data_dir=tmp_path, database_url=database_url)
    app = create_app(settings, start_poller=False)
    with patch("smtplib.SMTP", cls), caplog.at_level(logging.DEBUG):
        with TestClient(app, base_url="https://testserver") as c:
            r = c.post(
                "/api/v1/auth/signup",
                json={"name": "Ada", "email": "ada@example.com", "password": "correct horse 9"},
            )
    assert r.status_code == 201
    assert "Could not send a confirmation email" in caplog.text
    assert SECRET not in caplog.text and "correct horse 9" not in caplog.text
    assert "Confirm your email address by opening" not in caplog.text


def test_password_not_in_settings_repr():
    assert SECRET not in repr(smtp_settings())


# ---- mailcheck -------------------------------------------------------------------------------


def run_check(settings: Settings, capsys, *args: str):
    with patch.object(mailcheck, "Settings", return_value=settings):
        code = mailcheck.main(list(args) or ["me@example.com"])
    return code, capsys.readouterr().out.strip()


def test_mailcheck_sent(capsys):
    cls, inst = fake_smtp()
    with patch("smtplib.SMTP", cls):
        code, out = run_check(smtp_settings(), capsys)
    assert code == 0
    assert out == "Sent to me@example.com via smtp.gmail.com:587 as owner@gmail.com"
    msg = inst.send_message.call_args.args[0]
    assert msg["Subject"] == "Frameforge test email"
    assert SECRET not in out


def test_mailcheck_failed(capsys):
    cls, inst = fake_smtp()
    inst.login.side_effect = OSError(f"535 bad credentials {SECRET}")
    with patch("smtplib.SMTP", cls):
        code, out = run_check(smtp_settings(), capsys)
    assert code == 1
    assert out.startswith("FAILED: OSError: 535 bad credentials")
    assert SECRET not in out


def test_mailcheck_not_configured(capsys):
    cls, _ = fake_smtp()
    with patch("smtplib.SMTP", cls):
        code, out = run_check(smtp_settings(smtp_username="", smtp_password=""), capsys)
    assert code == 2
    assert out == "SMTP is not configured (USER_EMAIL / USER_EMAIL_PASSWORD missing)"
    cls.assert_not_called()


def test_env_names_and_whitespace(monkeypatch):
    """USER_EMAIL / USER_EMAIL_PASSWORD; spaces in an app password are removed."""
    monkeypatch.setenv("USER_EMAIL", "  owner@gmail.com ")
    monkeypatch.setenv("USER_EMAIL_PASSWORD", " abcd efgh ijkl mnop ")
    s = Settings()
    assert s.smtp_username == "owner@gmail.com"
    assert s.smtp_password == "abcdefghijklmnop"
    assert s.smtp_configured and "abcdefgh" not in repr(s)
