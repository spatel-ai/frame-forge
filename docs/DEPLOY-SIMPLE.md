# Simple server deploy: git clone + Docker + Let's Encrypt

For a Linux server (for example an EC2 instance) you already have. The backend runs in Docker with
PostgreSQL; Caddy gets a free Let's Encrypt certificate for the API domain and renews it by itself.
The frontend is on Vercel and forwards `/api/*` to the API domain.

**Not verified:** these steps have not been run on a real server yet. The compose file parses and
the same images were run locally in mock mode (docs/DEPLOY.md).

## 1. DNS (GoDaddy)

GoDaddy → My Products → your domain → DNS → Add record:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `api` | the server's public IP (use an Elastic IP so it never changes) | 600 |

Check from your laptop: `dig +short api.yourdomain.com` prints the server's IP.

## 2. Firewall (EC2 security group)

Inbound: **80** and **443** from anywhere (80 is needed for the certificate). Port 8000 stays
closed: the API is reached through 443, so logins and cookies are always encrypted.

## 3. On the server

**Quickest: one script.** Upload `deploy/server-setup.sh` to the server and run:

```bash
bash server-setup.sh api.yourdomain.com https://github.com/<you>/<repo>.git development
```

It installs Docker, clones the code into `~/frameforge`, generates the database password, and the
first time stops after creating a `backend/.env` template for you to fill in
(`nano ~/frameforge/backend/.env`). Run the same command again and it builds, starts everything and
checks the API. Run it again any time to update. The manual steps below do the same by hand.


```bash
# Docker (skip if `docker compose version` already works)
sudo dnf install -y docker git || sudo apt-get install -y docker.io git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
# compose plugin, if `docker compose version` fails:
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -sSL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# The code
git clone https://github.com/<you>/<repo>.git frameforge
cd frameforge
git checkout development

# Settings
cp deploy/server.env.example deploy/server.env
nano deploy/server.env            # API_DOMAIN=api.yourdomain.com, POSTGRES_PASSWORD=<openssl rand -hex 24>
nano backend/.env                 # see the list below
chmod 600 deploy/server.env backend/.env

# Run
docker compose --env-file deploy/server.env -f docker-compose.server.yml up -d --build

# Check
docker compose --env-file deploy/server.env -f docker-compose.server.yml ps
curl http://127.0.0.1:8000/healthz          # on the server: {"status":"ok"}
curl https://api.yourdomain.com/healthz     # from anywhere, once DNS points here
```

The first build takes several minutes. The certificate is issued on the first HTTPS request after
DNS points to the server; `docker compose ... logs caddy` shows it.

### backend/.env on the server

```
AVATAR_ENV=production
AVATAR_PROVIDER=fal
FAL_KEY=...
AVATAR_MAX_AUDIO_SECONDS=12
AVATAR_PAYMENTS=razorpay
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
USER_EMAIL=...
USER_EMAIL_PASSWORD=...
AVATAR_SUPPORT_EMAIL=...
AVATAR_APP_URL=https://<the Vercel site address>
AVATAR_ALLOWED_ORIGINS=https://<the Vercel site address>
AVATAR_BANNERS=on
AVATAR_S3_BUCKET=<your bucket name>
AWS_REGION=ap-south-1
```

`AVATAR_APP_URL` and `AVATAR_ALLOWED_ORIGINS` are the **website's** address (Vercel), not the API
domain: the browser talks to the website, and the server refuses logins from any other origin.
Production with real AI refuses to start without `AVATAR_S3_BUCKET`.

### S3 access without keys (EC2 role)

Attach an IAM role to the instance that allows `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`
on `arn:aws:s3:::<bucket>/videos/*`. Because the API runs inside Docker, the instance metadata hop
limit must be 2 (EC2 console → instance → Actions → Instance settings → Modify instance metadata
options → "Metadata response hop limit" = 2), otherwise the container cannot read the role.
The bucket also needs: public access blocked, a lifecycle rule deleting `videos/` after 30 days,
and CORS allowing `GET`/`HEAD` from the website's address (for the Download button).

## 4. Frontend on Vercel

```bash
deploy/vercel-setup.sh api.yourdomain.com     # writes the API domain into frontend/vercel.json
cd frontend && npx vercel --prod
```

Or import the GitHub repo in Vercel with root directory `frontend` after committing the changed
`vercel.json`.

## 5. Update later

```bash
cd frameforge && git pull
docker compose --env-file deploy/server.env -f docker-compose.server.yml up -d --build
```

Database migrations run when the backend starts. Logs:
`docker compose --env-file deploy/server.env -f docker-compose.server.yml logs -f backend`.
