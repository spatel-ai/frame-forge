"""AI providers. `FalProvider` makes paid calls to fal.ai; `MockProvider` makes
none and exists so the whole flow can be exercised without cost."""

import asyncio
import json
import math
import struct
import tempfile
import uuid
import wave
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Protocol

import httpx

from .core.config import Settings


class ProviderError(Exception):
    """A provider call failed. The message is safe to show to the user."""


@dataclass
class Speech:
    data: bytes
    extension: str  # without the dot
    duration_seconds: float


# D-065 (R-24, R-74): how long fal keeps the finished video. Sent with the video submission so
# the link the job stores stays playable this long (30 days, matching D-054). Source: fal docs
# "Media expiration", read 2026-11-17.
VIDEO_LIFETIME_SECONDS = 2_592_000
FAL_LIFECYCLE_HEADER = "X-Fal-Object-Lifecycle-Preference"


@dataclass
class VideoPoll:
    state: str  # "pending" | "done" | "failed"
    data: bytes | None = None  # the video itself (mock): written to our disk
    error: str | None = None
    url: str | None = None  # the provider's link to the video (fal, D-065): never downloaded


async def audio_duration_seconds(data: bytes) -> float:
    """Length of an audio file: read directly for WAV, via ffprobe otherwise."""
    try:
        with wave.open(BytesIO(data), "rb") as wav:
            return wav.getnframes() / wav.getframerate()
    except (wave.Error, EOFError):
        pass
    with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            process = await asyncio.create_subprocess_exec(
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "csv=p=0", tmp.name,
                stdout=asyncio.subprocess.PIPE,
            )  # fmt: skip
        except FileNotFoundError:
            raise ProviderError("The audio is not WAV and ffprobe is not installed.") from None
        out, _ = await process.communicate()
    try:
        return float(out.decode().strip())
    except ValueError:
        raise ProviderError("Could not measure the audio length.") from None


class Provider(Protocol):
    name: str

    async def synthesize_speech(self, text: str, language: str) -> Speech: ...

    async def upload_inputs(self, image: Path, audio: Path) -> tuple[str, str]:
        """Make the two files reachable by the provider. Not billed."""
        ...

    async def submit_video(self, image_ref: str, audio_ref: str) -> str:
        """Start the paid video generation and return the provider's request id.
        Raise ProviderError only when the provider definitely refused the
        request; any other error means the outcome is unknown."""
        ...

    async def poll_video(self, request_id: str) -> VideoPoll: ...


class FalProvider:
    name = "fal"

    def __init__(self, settings: Settings):
        import fal_client  # reads the FAL_KEY environment variable

        self._fal = fal_client
        self._settings = settings

    async def _download(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.content

    def _explain(self, action: str, exc: Exception) -> str:
        """Turn a fal error into a message that says what to do about it."""
        from fal_client.client import FalClientHTTPError, FalClientTimeoutError

        text = str(exc)
        if isinstance(exc, FalClientHTTPError) and (
            "balance" in text.lower() or "locked" in text.lower()
        ):
            return (
                f"{action} was refused by fal.ai because the account balance is exhausted. "
                "Nothing was charged. Top up at fal.ai/dashboard/billing and try again."
            )
        if isinstance(exc, (FalClientTimeoutError, TimeoutError)):
            return (
                f"{action} did not finish within {self._settings.voice_timeout_seconds:.0f} "
                "seconds, so the request was cancelled. fal.ai may be busy; try again shortly."
            )
        return f"{action} failed: {text}"

    async def synthesize_speech(self, text: str, language: str) -> Speech:
        settings = self._settings
        if language in settings.gemini_voices:
            model = settings.gemini_model
            language_code, voice = settings.gemini_voices[language]
            arguments = {
                "prompt": text,
                "voice": voice,
                "language_code": language_code,
                "output_format": "wav",
            }
        elif settings.voice == "kokoro":
            model, voice = settings.kokoro_voices[language]
            arguments = {"prompt": text, "voice": voice}
        else:
            model = settings.minimax_model
            arguments = {"text": text, "language_boost": language, "output_format": "url"}
        try:
            # On timeout the fal client cancels the request on fal's side too.
            result = await self._fal.subscribe_async(
                model, arguments=arguments, client_timeout=settings.voice_timeout_seconds
            )
            url = result["audio"]["url"]
            data = await self._download(url)
            duration = await audio_duration_seconds(data)
        except Exception as exc:
            raise ProviderError(self._explain("Voice generation", exc)) from exc
        extension = url.rsplit("?", 1)[0].rsplit(".", 1)[-1].lower()
        if extension not in {"mp3", "wav", "flac"}:
            extension = "mp3" if model == settings.minimax_model else "wav"
        return Speech(data=data, extension=extension, duration_seconds=duration)

    async def upload_inputs(self, image: Path, audio: Path) -> tuple[str, str]:
        try:
            image_url, audio_url = await asyncio.gather(
                self._fal.upload_file_async(image), self._fal.upload_file_async(audio)
            )
        except Exception as exc:
            raise ProviderError(f"Uploading inputs failed: {exc}") from exc
        return image_url, audio_url

    async def submit_video(self, image_ref: str, audio_ref: str) -> str:
        from fal_client.client import FalClientHTTPError

        try:
            handle = await self._fal.submit_async(
                self._settings.video_model,
                arguments={"image_url": image_ref, "audio_url": audio_ref},
                # D-065: keep the output 30 days. fal_client 1.0.3 `AsyncClient.submit` merges
                # `headers` into the queue POST.
                headers={
                    FAL_LIFECYCLE_HEADER: json.dumps(
                        {"expiration_duration_seconds": VIDEO_LIFETIME_SECONDS}
                    )
                },
            )
        except FalClientHTTPError as exc:
            if 400 <= exc.status_code < 500:
                # fal definitely refused the request, so nothing was started.
                raise ProviderError(self._explain("Video generation", exc)) from exc
            raise
        return handle.request_id

    async def poll_video(self, request_id: str) -> VideoPoll:
        """Network errors and provider 5xx responses propagate so the caller
        retries on the next poll instead of abandoning a paid generation.
        A finished video comes back as fal's link and is not downloaded (D-065, R-24)."""
        from fal_client.client import Completed, FalClientHTTPError

        status = await self._fal.status_async(self._settings.video_model, request_id)
        if not isinstance(status, Completed):
            return VideoPoll("pending")
        if status.error:
            return VideoPoll("failed", error=f"Video generation failed: {status.error}")
        try:
            result = await self._fal.result_async(self._settings.video_model, request_id)
        except FalClientHTTPError as exc:
            if exc.status_code >= 500:
                raise
            # The request is finished, so a 4xx here is the model's verdict
            # (for example a rejected input), not a transient polling problem.
            return VideoPoll("failed", error=f"Video generation failed: {exc}")
        url = (result.get("video") or {}).get("url")
        if not url:
            return VideoPoll("failed", error="Provider returned no video.")
        return VideoPoll("done", url=url)


class MockProvider:
    """Free stand-in: a tone for speech, and a still-image video made with ffmpeg."""

    name = "mock"
    chars_per_second = 15.0
    polls_before_done = 2

    def __init__(self, settings: Settings):
        self._settings = settings
        self._videos: dict[str, dict] = {}
        self.submit_count = 0

    async def synthesize_speech(self, text: str, language: str) -> Speech:
        duration = max(1.0, len(text) / self.chars_per_second)
        rate = 16000
        buffer = BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes(
                b"".join(
                    struct.pack("<h", int(6000 * math.sin(2 * math.pi * 220 * i / rate)))
                    for i in range(int(duration * rate))
                )
            )
        return Speech(data=buffer.getvalue(), extension="wav", duration_seconds=duration)

    async def upload_inputs(self, image: Path, audio: Path) -> tuple[str, str]:
        return str(image), str(audio)

    async def submit_video(self, image_ref: str, audio_ref: str) -> str:
        self.submit_count += 1
        request_id = f"mock-{uuid.uuid4().hex}"
        self._videos[request_id] = {"image": image_ref, "audio": audio_ref, "polls": 0}
        return request_id

    async def poll_video(self, request_id: str) -> VideoPoll:
        entry = self._videos.get(request_id)
        if entry is None:
            # The mock keeps requests in memory, so they do not survive a restart.
            return VideoPoll("failed", error="Mock request was lost when the server restarted.")
        entry["polls"] += 1
        if entry["polls"] < self.polls_before_done:
            return VideoPoll("pending")
        return VideoPoll("done", data=await self._render(entry["image"], entry["audio"]))

    async def _render(self, image: str, audio: str) -> bytes:
        out = Path(image).parent / "mock-render.mp4"
        try:
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", image, "-i", audio,
                "-vf", "scale=480:-2", "-c:v", "libx264", "-tune", "stillimage",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out),
            )  # fmt: skip
            await process.wait()
            if process.returncode == 0:
                return out.read_bytes()
        except FileNotFoundError:
            pass  # ffmpeg is not installed
        finally:
            out.unlink(missing_ok=True)
        return b"mock video: install ffmpeg to get a playable file"


def build_provider(settings: Settings) -> Provider:
    if settings.provider == "fal":
        return FalProvider(settings)
    if settings.provider == "mock":
        return MockProvider(settings)
    raise ValueError(f"Unknown AVATAR_PROVIDER {settings.provider!r}; use 'mock' or 'fal'.")
