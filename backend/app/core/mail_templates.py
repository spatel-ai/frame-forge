"""Email templates (T-551, T-552; R-01, R-13): one simple branded layout, inline CSS only, no
external images or fonts. Each builder returns (subject, text, html). Every piece of
customer-provided text goes through `html.escape` in the HTML part. Importable by any module;
it imports nothing from auth or jobs."""

from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from .config import Settings

BRAND = "Frameforge"
PURPLE = "#4A3AFF"
_IST = ZoneInfo("Asia/Kolkata")


def _layout(
    heading: str,
    paragraphs: list[str],
    button: tuple[str, str] | None,
    extra_html: str = "",
    footer: list[str] | None = None,
) -> str:
    """`paragraphs` and `footer` are plain text (escaped here); `extra_html` is trusted markup
    built by this module from escaped values."""
    body = "".join(
        f'<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#1F2430;">{escape(p)}</p>'
        for p in paragraphs
    )
    btn = ""
    if button:
        label, url = button
        btn = (
            '<p style="margin:24px 0;"><a href="' + escape(url, quote=True) + '" '
            f'style="display:inline-block;background:{PURPLE};color:#FFFFFF;text-decoration:none;'
            "font-weight:600;font-size:16px;line-height:20px;padding:14px 24px;"
            f'border-radius:8px;">{escape(label)}</a></p>'
            '<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#5B6070;">'
            f"Button not working? Copy this link into your browser:<br>"
            f'<a href="{escape(url, quote=True)}" style="color:{PURPLE};word-break:break-all;">'
            f"{escape(url)}</a></p>"
        )
    foot = "".join(
        f'<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#5B6070;">{escape(f)}</p>'
        for f in footer or []
    )
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        '<body style="margin:0;padding:0;background:#F4F5F9;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        '<tr><td align="center" style="padding:24px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="max-width:560px;background:#FFFFFF;border-radius:12px;">'
        '<tr><td style="padding:32px 28px;">'
        f'<p style="margin:0 0 24px;font-size:20px;font-weight:700;color:{PURPLE};">'
        f"{escape(BRAND)}</p>"
        f'<h1 style="margin:0 0 16px;font-size:22px;line-height:28px;color:#1F2430;">'
        f"{escape(heading)}</h1>"
        f"{body}{btn}{extra_html}{foot}"
        "</td></tr></table></td></tr></table></body></html>"
    )


def confirm_email(link: str, hours: int) -> tuple[str, str, str]:
    subject = "Confirm your email address"
    paras = [
        f"Welcome to {BRAND}.",
        f"Confirm your email address by opening this link within {hours} hours.",
    ]
    text = (
        f"Welcome to {BRAND}.\n\nConfirm your email address by opening this link "
        f"within {hours} hours:\n{link}\n"
    )
    html = _layout("Confirm your email address", paras, ("Confirm email", link))
    return subject, text, html


def reset_password(link: str, minutes: int) -> tuple[str, str, str]:
    subject = "Reset your password"
    paras = [
        f"Someone asked to reset the password of your {BRAND} account.",
        f"Choose a new password with the button below. The link works once, for {minutes} minutes.",
    ]
    text = (
        f"Someone asked to reset the password of your {BRAND} account.\n\n"
        f"Choose a new password by opening this link. It works once, for {minutes} "
        f"minutes:\n{link}\n\nIf this was not you, you can ignore this email.\n"
    )
    html = _layout(
        "Reset your password",
        paras,
        ("Choose a new password", link),
        footer=["If this was not you, you can ignore this email."],
    )
    return subject, text, html


def test_email(settings: Settings) -> tuple[str, str, str]:
    """The `mailcheck` test message: the confirm-email layout with no token."""
    subject = f"{BRAND} test email"
    paras = [
        f"This is a test email from {BRAND}.",
        "If you can read this, outgoing email works. No action is needed.",
    ]
    text = f"{paras[0]}\n\n{paras[1]}\n"
    html = _layout(f"{BRAND} test email", paras, ("Open Frameforge", settings.app_base_url))
    return subject, text, html


def _made_on(created_at: str | datetime) -> str:
    dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
    local = dt.astimezone(_IST)
    hour = local.hour % 12 or 12
    return f"{local.day} {local:%b %Y}, {hour}:{local:%M} {'am' if local.hour < 12 else 'pm'} IST"


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def video_ready(
    *,
    name: str,
    job_id: str,
    script: str,
    language: str,
    seconds: float | None,
    created_at: str | datetime,
    voice_credits: int,
    video_credits: int,
    app_base_url: str,
    support_email: str = "",
    expires_at: str | datetime | None = None,
) -> tuple[str, str, str]:
    """The "your video is ready" email (R-13). The link goes to our app, never to a provider URL."""
    subject = f"Your video is ready: “{_clip(script, 40)}”"
    link = f"{app_base_url}/videos/{job_id}"
    rows: list[tuple[str, str]] = [
        ("Job ID", job_id),
        ("Made on", _made_on(created_at)),
        ("Language", language),
        ("Length", f"{seconds:.1f} seconds" if seconds is not None else "Not available"),
        ("Script", _clip(script, 200)),
        (
            "Credits charged",
            f"voice {voice_credits}, video {video_credits}, total {voice_credits + video_credits}",
        ),
    ]
    if expires_at is not None:
        rows.append(("Available until", _made_on(expires_at)))
    note = "This video is AI-generated."
    help_line = f"Need help? Write to {support_email}." if support_email else ""

    text_lines = [f"Hi {name}, your talking video is ready.", "", f"Watch and download: {link}", ""]
    text_lines += [f"{k}: {v}" for k, v in rows]
    text_lines += ["", note]
    if help_line:
        text_lines.append(help_line)
    text = "\n".join(text_lines) + "\n"

    table = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:8px 0 24px;border-top:1px solid #E3E5EE;">'
        + "".join(
            '<tr><td valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid #E3E5EE;'
            f'font-size:14px;color:#5B6070;width:130px;">{escape(k)}</td>'
            '<td valign="top" style="padding:10px 0;border-bottom:1px solid #E3E5EE;'
            f'font-size:14px;color:#1F2430;word-break:break-word;">{escape(v)}</td></tr>'
            for k, v in rows
        )
        + "</table>"
    )
    footer = [note] + ([help_line] if help_line else [])
    html = _layout(
        "Your video is ready",
        [f"Hi {name}, your talking video is ready."],
        ("Watch and download", link),
        extra_html=table,
        footer=footer,
    )
    return subject, text, html
