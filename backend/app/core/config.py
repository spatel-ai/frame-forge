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

    max_audio_seconds: float = 30.0
    # Live MiniMax English runs measured about 14 characters a second, so 400
    # characters stays under 30 seconds instead of paying for unusable audio.
    max_script_chars: int = 400
    max_image_mb: int = 10
    min_image_side_px: int = 256
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
    video_price_per_second_usd: float = 0.0562

    def __post_init__(self) -> None:
        if self.voice not in ("minimax", "kokoro"):
            raise ValueError(f"Unknown AVATAR_VOICE {self.voice!r}; use 'minimax' or 'kokoro'.")

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"
