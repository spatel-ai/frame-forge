# Deploying Frameforge (R-26)

Three containers on one Linux server: PostgreSQL, the API and Caddy (serves the web app and gets
the HTTPS certificate by itself). Files: `docker-compose.prod.yml`, `backend/Dockerfile`,
`frontend/Dockerfile`, `deploy/Caddyfile`.

Videos are not stored (D-065): the fal.ai link is kept and played. Only photos and voices live on
the `media` volume, and the database holds everything else.

## 1. Server requirements

- Linux (Ubuntu 22.04+ or Debian 12+), 2 vCPU, 4 GB RAM, 20 GB disk (the first image build needs
  about 3 GB; ffmpeg joins banners in the API container).
- A domain you control. Ports 80 and 443 open to the internet (Caddy needs both, 80 for the
  certificate challenge). Do not open 5432 or 8000: neither is published.

## 2. DNS

Create an `A` record for the domain (for example `app.example.com`) pointing at the server's public
IP, and wait until `dig +short app.example.com` shows it. Caddy cannot get a certificate before.

## 3. Install Docker

Follow the official guide for your distribution (https://docs.docker.com/engine/install/), which
installs the Compose plugin. Check: `docker --version` and `docker compose version` (v2.24 or newer).

## 4. Copy the repository

```bash
git clone <repository-url> frameforge && cd frameforge
git checkout main        # or the release branch
```

## 5. Configure (never commit these files)

Two files, both git-ignored.

**`deploy/prod.env`** (copy `deploy/prod.env.example`; read by Compose only):

| Name | Secret | Meaning |
| --- | --- | --- |
| `AVATAR_DOMAIN` | no | the domain, no `https://` |
| `POSTGRES_PASSWORD` | yes | database password, letters and digits only: `openssl rand -hex 24` |

**`backend/.env`** (copy `backend/.env.example`; read by the API container). Names only here:

| Name | Secret | Production value |
| --- | --- | --- |
| `AVATAR_ENV` | no | `production` |
| `AVATAR_APP_URL` | no | `https://<domain>` (emailed links point here) |
| `AVATAR_ALLOWED_ORIGINS` | no | `https://<domain>` |
| `AVATAR_PROVIDER` | no | `fal` (paid; needs the owner's approval per run) |
| `FAL_KEY` | yes | fal.ai API key |
| `AVATAR_MAX_AUDIO_SECONDS` | no | `12` for R1 |
| `AVATAR_PAYMENTS` | no | `razorpay` (production refuses `mock`) |
| `RAZORPAY_KEY_ID` | no (public) | test key until go-live, then live key |
| `RAZORPAY_KEY_SECRET` | yes | Razorpay secret |
| `RAZORPAY_WEBHOOK_SECRET` | yes | optional (D-064); empty means polling every minute |
| `AVATAR_PAYMENT_FEE_BPS`, `AVATAR_PAYMENT_FEE_GST_BPS` | no | `200`, `1800` |
| `AVATAR_SUPPORT_EMAIL` | no | shown to customers on failure screens |
| `AVATAR_SMTP_HOST`, `AVATAR_SMTP_PORT`, `AVATAR_SMTP_USERNAME` | no | email sender (task T-550) |
| `AVATAR_SMTP_PASSWORD` | yes | Gmail App Password |
| `AVATAR_MAIL_FROM_NAME` | no | sender display name |

Set by Compose, do not put in `backend/.env`: `DATABASE_URL` (points at the `db` service) and
`AVATAR_DATA_DIR=/data`. Also optional: `AVATAR_VOICE`, `AVATAR_POLL_INTERVAL`,
`AVATAR_VIDEO_TIMEOUT`. The SMTP names are from the parallel task T-550; confirm them against
`backend/.env.example` once merged. Production refuses to start without an email provider.

Protect the files: `chmod 600 deploy/prod.env backend/.env`.

## 6. First deploy

```bash
docker compose --env-file deploy/prod.env -f docker-compose.prod.yml up -d --build
docker compose --env-file deploy/prod.env -f docker-compose.prod.yml ps     # all healthy
curl https://<domain>/healthz                                                # {"status":"ok"}
curl https://<domain>/api/v1/config                                          # provider and payments as set
```

The API container runs `alembic upgrade head` on every start, then one uvicorn worker. Keep it at
one worker: the job poller and payment reconciler run inside that process.

To avoid typing the flags, add to your shell: `export COMPOSE_FILE=docker-compose.prod.yml COMPOSE_ENV_FILES=deploy/prod.env`.

## 7. Update

```bash
git pull
docker compose --env-file deploy/prod.env -f docker-compose.prod.yml up -d --build
```

Back up first (section 9) when the release has a migration. Volumes survive; migrations run on start.

## 8. Logs and status

```bash
docker compose --env-file deploy/prod.env -f docker-compose.prod.yml logs -f backend
docker compose --env-file deploy/prod.env -f docker-compose.prod.yml logs --tail 100 web db
```

## 9. Nightly backup (14 days) and restore

Create `/usr/local/bin/frameforge-backup.sh` (adjust `REPO`), `chmod +x` it:

```bash
#!/bin/sh
set -e
REPO=/home/deploy/frameforge
OUT=/var/backups/frameforge
mkdir -p "$OUT"
cd "$REPO"
docker compose --env-file deploy/prod.env -f docker-compose.prod.yml exec -T db \
  pg_dump -U avatar -d avatar --format=custom > "$OUT/avatar-$(date +%F).dump"
find "$OUT" -name 'avatar-*.dump' -mtime +14 -delete
```

Cron (`sudo crontab -e`), 02:30 every night:

```cron
30 2 * * * /usr/local/bin/frameforge-backup.sh >> /var/log/frameforge-backup.log 2>&1
```

Copy `/var/backups/frameforge` off the server too (a server loss takes the local copies with it).
Photos and voices on the `media` volume are not in the dump; losing them only costs saved voice
reuse, not customers' money or accounts.

**Restore** (tested on the local stack, 2026-11-17: dump 24 KB, restore exit 0, `alembic_version`
= head, API healthy afterwards). Stops the API, replaces the database, starts the API:

```bash
C="docker compose --env-file deploy/prod.env -f docker-compose.prod.yml"
$C stop backend
$C exec -T db psql -U avatar -d postgres -c 'DROP DATABASE avatar' -c 'CREATE DATABASE avatar'
$C exec -T db pg_restore -U avatar -d avatar --no-owner < /var/backups/frameforge/avatar-YYYY-MM-DD.dump
$C start backend
curl https://<domain>/healthz
```

## 10. Try the stack locally in mock mode

```bash
docker compose --env-file deploy/local.env -f docker-compose.prod.yml -f docker-compose.local.yml up --build
```

Serves http://localhost on host port 80 only (nothing on 5432, 8000 or 5173), development mode,
mock provider and payments, no `backend/.env` needed. Stop with `down` (add `-v` to delete the
local volumes). The Compose project is `frameforge-prod`, separate from the local `avatar` database.
