"""Runtime settings, read once from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    # "mock" makes no network calls and costs nothing; "fal" makes paid calls.
    provider: str = field(default_factory=lambda: os.getenv("AVATAR_PROVIDER", "mock"))
    data_dir: Path = field(
        default_factory=lambda: Path(os.getenv("AVATAR_DATA_DIR", "data")).resolve()
    )
    poll_interval_seconds: float = field(
        default_factory=lambda: float(os.getenv("AVATAR_POLL_INTERVAL", "5"))
    )
    # A video job with no result after this long is marked failed.
    video_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("AVATAR_VIDEO_TIMEOUT", "1800"))
    )

    # Synchronous SQLAlchemy URL for PostgreSQL (psycopg 3 driver). The default
    # matches docker-compose.yml's local development database.
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL", "postgresql+psycopg://avatar:avatar_dev@127.0.0.1:5432/avatar"
        )
    )

    # "development" sends no real email (messages go to the log); "production" needs a provider.
    environment: str = field(default_factory=lambda: os.getenv("AVATAR_ENV", "development"))
    # Base of the links in emails, such as the confirm-email link.
    app_base_url: str = field(
        default_factory=lambda: os.getenv("AVATAR_APP_URL", "http://localhost:5173").rstrip("/")
    )
    # Origins allowed to make state-changing requests (D-035); comma-separated in the env.
    allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv(
                "AVATAR_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if o.strip()
        )
    )
    # A login lasts this long, with no renewal (D-003).
    session_days: int = 30

    # D-044 (owner, 2026-11-17): 60 s for now. fal.ai states no limit for this model; Kling's own
    # API docs say 2-300 s (docs/FAL-VIDEO-FACTS.md). Raise only after an owner-approved live test.
    # R1 (T-554, owner 2026-11-17): real test runs and the first deployment use 12 s, set with
    # AVATAR_MAX_AUDIO_SECONDS=12, so a longer voice is refused before any video is paid for.
    max_audio_seconds: float = field(
        default_factory=lambda: float(os.getenv("AVATAR_MAX_AUDIO_SECONDS", "60"))
    )
    # Live MiniMax English runs measured about 14 characters a second, so 800
    # characters stays under 60 seconds instead of paying for unusable audio.
    max_script_chars: int = 800
    # R-44: the longest start or end banner clip the company may add (D-058), in seconds.
    max_template_seconds: float = 5.0
    max_image_mb: int = 10
    # D-056: Kling's documented photo rules (at least 300 px; shape between 1:2.5 and 2.5:1),
    # checked at upload so no voice is paid for a photo the video model would refuse.
    min_image_side_px: int = 300
    max_image_aspect_ratio: float = 2.5
    languages: tuple[str, ...] = ("English", "Hindi", "Punjabi")

    # Voice model: "minimax" (run live successfully on 2026-11-16) or "kokoro"
    # (five times cheaper, but has not yet produced audio in a live run).
    voice: str = field(default_factory=lambda: os.getenv("AVATAR_VOICE", "minimax"))
    # A voice request that has not finished by then is cancelled.
    voice_timeout_seconds: float = 90.0
    minimax_model: str = "fal-ai/minimax/speech-02-hd"
    # Kokoro has one endpoint per language -> (endpoint, voice).
    kokoro_voices: dict[str, tuple[str, str]] = field(
        default_factory=lambda: {
            "English": ("fal-ai/kokoro/american-english", "af_heart"),
            "Hindi": ("fal-ai/kokoro/hindi", "hf_alpha"),
        }
    )
    # Languages listed here always use Gemini TTS, whatever `voice` is set to:
    # language -> (language_code, voice). Charon is a male voice.
    gemini_model: str = "fal-ai/gemini-3.1-flash-tts"
    gemini_voices: dict[str, tuple[str, str]] = field(
        default_factory=lambda: {"Punjabi": ("Punjabi (India)", "Charon")}
    )
    video_model: str = "fal-ai/kling-video/ai-avatar/v2/standard"
    # fal.ai's charge to the company (internal; never sent to the browser).
    video_price_per_second_usd: float = 0.0562
    # What the customer pays, in whole credits (D-014). Owner, 2026-11-17: D-006, D-038.
    credits_per_second: int = 20
    voice_price_credits: int = 10

    # Payments (M4, D-042). "mock" makes no network call and moves no money; "razorpay" calls
    # Razorpay and needs the owner's approval for that run (D-021, Gate C).
    payments: str = field(default_factory=lambda: os.getenv("AVATAR_PAYMENTS", "mock"))
    # The key id is public (sent to the browser); the two secrets never leave the server and are
    # kept out of repr() so they cannot reach a log or a traceback.
    razorpay_key_id: str = field(default_factory=lambda: os.getenv("RAZORPAY_KEY_ID", "").strip())
    razorpay_key_secret: str = field(
        default_factory=lambda: os.getenv("RAZORPAY_KEY_SECRET", "").strip(), repr=False
    )
    razorpay_webhook_secret: str = field(
        default_factory=lambda: os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip(), repr=False
    )
    # Purchase limits in whole credits (owner, Q-06; D-047; minimum raised to 1,000 by the owner
    # on 2026-11-17, D-059). ₹1 = 1 credit (D-007).
    min_purchase_credits: int = 1_000
    max_purchase_credits: int = 10_000
    # The customer pays Razorpay's charge so the owner receives exactly the credits' price
    # (owner, 2026-11-17, D-060 as amended by D-062). Razorpay's rate, in basis points of the
    # WHOLE amount charged (Standard plan: 200 = 2%), and the GST it adds on that fee (1800 =
    # 18%). The total is grossed up so that total - Razorpay's fee - GST >= the price.
    payment_fee_bps: int = field(
        default_factory=lambda: int(os.getenv("AVATAR_PAYMENT_FEE_BPS", "200"))
    )
    payment_fee_gst_bps: int = field(
        default_factory=lambda: int(os.getenv("AVATAR_PAYMENT_FEE_GST_BPS", "1800"))
    )
    # Consent on Create (D-045). The wording is the owner's (Q-11, 2026-11-17); a legal review
    # may replace it, and then the version changes so each job records what was agreed to.
    consent_version: str = "2026-11-17"
    consent_text: str = "I am the person in this photo, or I have their permission to use it."
    # Video approvals per customer per day outside production (D-046). Production has no limit.
    daily_video_limit: int = 50
    # D-066 (owner, 2026-11-17): every video gets the same opening banner, a top-right emblem
    # while the avatar speaks, and a closing banner, from backend/assets/banners/.
    # AVATAR_BANNERS=off delivers the AI video as it is.
    banners_enabled: bool = field(
        default_factory=lambda: os.getenv("AVATAR_BANNERS", "on").strip().lower() != "off"
    )
    # Keep every voice for reuse, not only failed jobs' voices (D-043). Off by default.
    save_all_voices: bool = False
    # Shown on failure screens when set (D-055); the owner adds it before launch.
    support_email: str = field(
        default_factory=lambda: os.getenv("AVATAR_SUPPORT_EMAIL", "").strip()
    )
    # Outgoing email through the owner's Gmail (T-550, R-01, R-13). Gmail needs 2-Step
    # Verification and an App Password. Empty username or password: no SMTP (development logs).
    smtp_host: str = field(default_factory=lambda: os.getenv("AVATAR_SMTP_HOST", "smtp.gmail.com"))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("AVATAR_SMTP_PORT", "587")))
    smtp_username: str = field(default_factory=lambda: os.getenv("USER_EMAIL", "").strip())
    # repr=False: the password never shows in a log line or traceback that prints Settings.
    smtp_password: str = field(
        # Google shows app passwords in groups of four; the spaces are not part of it.
        default_factory=lambda: "".join(os.getenv("USER_EMAIL_PASSWORD", "").split()),
        repr=False,
    )
    mail_from_name: str = field(
        default_factory=lambda: os.getenv("AVATAR_MAIL_FROM_NAME", "Frameforge").strip()
    )

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_username and self.smtp_password)

    def __post_init__(self) -> None:
        if self.voice not in ("minimax", "kokoro"):
            raise ValueError(f"Unknown AVATAR_VOICE {self.voice!r}; use 'minimax' or 'kokoro'.")
        if self.payments not in ("mock", "razorpay"):
            raise ValueError(
                f"Unknown AVATAR_PAYMENTS {self.payments!r}; use 'mock' or 'razorpay'."
            )
        for name in ("payment_fee_bps", "payment_fee_gst_bps"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{name} must be a whole number of basis points, 0 or more.")
        if self.payment_fee_bps * (10_000 + self.payment_fee_gst_bps) >= 100_000_000:
            raise ValueError("The payment fee with its GST must be below 100% of the amount.")
        if not 1 <= self.max_audio_seconds <= 60:
            raise ValueError("AVATAR_MAX_AUDIO_SECONDS must be between 1 and 60 (D-056).")
        # D-042: fail closed. The mock gateway signs with a public secret and moves no money,
        # so production never runs it.
        if self.environment == "production" and self.payments == "mock":
            raise ValueError("AVATAR_PAYMENTS=mock is not allowed in production.")
        if self.payments == "razorpay":
            missing = [
                name
                for name, value in (
                    ("RAZORPAY_KEY_ID", self.razorpay_key_id),
                    ("RAZORPAY_KEY_SECRET", self.razorpay_key_secret),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"AVATAR_PAYMENTS=razorpay needs {', '.join(missing)}.")
            # D-042: fail closed. Outside production only a test key may run, so no real money
            # moves before launch. The prefix is confirmed in the test-mode run (T-407).
            if self.environment != "production" and not self.razorpay_key_id.startswith(
                "rzp_test_"
            ):
                raise ValueError(
                    "Refusing a Razorpay key that is not a test key (rzp_test_...) outside "
                    "production. Use test keys until launch."
                )

    @property
    def effective_daily_video_limit(self) -> int | None:
        """The daily video limit in force: none in production (D-046)."""
        return None if self.environment == "production" else self.daily_video_limit

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"
