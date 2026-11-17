"""T-551 (R-01, R-13): the three templates render subject, text and escaped HTML."""

from app.core import mail_templates as t


def video(**kw):
    args = dict(
        name="Ada <b>",
        job_id="job123",
        script="Hello <script>alert(1)</script> there, this is a fairly long script for testing",
        language="English",
        seconds=2.133,
        created_at="2026-11-17T10:12:00+00:00",
        voice_credits=10,
        video_credits=43,
        app_base_url="https://app.example.com",
        support_email="help@example.com",
    )
    return t.video_ready(**{**args, **kw})


def test_confirm_and_reset_render():
    for subject, text, html in (
        t.confirm_email("https://x.test/verify-email?token=a&b=1", 24),
        t.reset_password("https://x.test/reset-password?token=abc", 30),
    ):
        assert subject and "https://x.test" in text
        assert "#4A3AFF" in html and "max-width:560px" in html
        assert "<img" not in html and "@import" not in html
    assert "token=a&amp;b=1" in t.confirm_email("https://x.test/verify-email?token=a&b=1", 24)[2]
    assert t.confirm_email("l", 24)[0] == "Confirm your email address"
    assert t.reset_password("l", 30)[0] == "Reset your password"


def test_video_ready_escapes_customer_text():
    subject, text, html = video()
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "Ada &lt;b&gt;" in html and "Ada <b>" in text
    assert subject.startswith("Your video is ready: “Hello <script>alert(1)</script> there, t")
    assert subject.endswith("…”")


def test_video_ready_content():
    _, text, html = video()
    assert "https://app.example.com/videos/job123" in text and "Watch and download" in html
    assert "17 Nov 2026, 3:42 pm IST" in text
    assert "Length: 2.1 seconds" in text
    assert "voice 10, video 43, total 53" in text
    assert "AI-generated" in text and "help@example.com" in text
    assert "Available until" not in text
    assert "Available until" in video(expires_at="2026-12-17T10:12:00+00:00")[1]
    assert "help@example.com" not in video(support_email="")[1]
    long = video(script="x" * 300)[1]
    assert "x" * 200 + "…" in long and "x" * 201 not in long.replace("…", "")
