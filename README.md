# Frameforge

Upload a photo, type a script (English, Hindi or Punjabi), listen to the generated voice,
approve it, and get a talking-avatar video of up to 30 seconds.

- `backend/` — **Frameforge API**: FastAPI, PostgreSQL job tracking (in Docker), files on local disk under `backend/data/`
- `frontend/` — **Frameforge Web**: React (Vite) single page
- Models (fal.ai): voice `fal-ai/minimax/speech-02-hd` (default) or Kokoro (set `AVATAR_VOICE=kokoro`); Punjabi always uses `fal-ai/gemini-3.1-flash-tts` with the male voice Charon, video `fal-ai/kling-video/ai-avatar/v2/standard`

## Run in mock mode (free, no network calls)

Start and migrate the database first (see [Start the database](#start-the-database)):

```bash
docker compose up -d db
cd backend && uv run alembic upgrade head
```

```bash
cd backend && uv run uvicorn app.main:create_app --factory --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Mock mode plays a tone as the voice and, if `ffmpeg`
is installed, shows the still photo as the video.

## Run against fal.ai (paid)

Copy `backend/.env.example` to `backend/.env`, set `AVATAR_PROVIDER=fal` and your
`FAL_KEY`. Start and migrate the database as for mock mode, then start the backend
with the env file:

```bash
cd backend && uv run uvicorn app.main:create_app --factory --port 8000 --env-file .env
```

Each approved video is billed by fal.ai at about $0.0562 per second of audio;
each voice generation at about $0.10 per 1,000 characters with MiniMax, or $0.02 with Kokoro (prices checked 2026-11-16).

## Start the database

PostgreSQL runs in Docker for local development and holds the jobs. The backend checks it at
start-up and refuses to start if it is unreachable or not migrated; it never migrates by itself.
Run both commands before starting the backend, and the second again after pulling new
migrations. The tests need only the first.

```bash
docker compose up -d db
cd backend && uv run alembic upgrade head
```

The connection URL is `DATABASE_URL` (the default matches `docker-compose.yml`; see `backend/.env.example`).

## Tests

```bash
cd backend && uv run pytest
```

The database must be running (`docker compose up -d db`). Each test creates its own schema,
migrates it, and drops it afterwards, so tests never touch your development data.
Tests use the mock provider only; they never call fal.ai.

## How paid requests are protected

- No video is submitted until the audio is approved, and a job can be approved once.
- Audio longer than 30 seconds fails the job before any video spend.
- Scripts are capped at 400 characters so the voice stays under 30 seconds.
- If fal.ai refuses a request (for example an exhausted balance), nothing is
  charged and audio already paid for is kept, so you can approve again after topping up.
- A voice request that has not finished in 90 seconds is cancelled.
- If a submission's outcome is unknown (timeout, restart mid-call) the job is
  failed, never retried automatically.
- Videos already submitted survive a backend restart: the poller picks them up
  again by their fal request id and downloads the result to local disk.

## Known limits

- No login; the backend listens on localhost only. Internal testers only.
- No history, regenerate, cancel, or cleanup of old files (deferred).
- The fal.ai integration has not yet been run live.
