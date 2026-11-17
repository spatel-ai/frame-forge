# Deploying

Backend: one Linux server with Docker (PostgreSQL + the API + Caddy for free Let's Encrypt HTTPS).
Frontend: Vercel. Three files do it: `server.sh`, `docker-compose.server.yml`, `Caddyfile`.

## Backend (the server)

1. **DNS:** an `A` record for the API domain (for example `api.example.com`) pointing to the
   server's public IP.
2. **Firewall:** open ports 80 and 443. Port 8000 stays closed; the API is reached over HTTPS.
3. **Run the script** on the server (upload `server.sh`, or use the copy in the repository):

   ```bash
   bash server.sh api.example.com https://github.com/<you>/<repo>.git development
   ```

   The first run installs Docker, clones the code into `~/frameforge`, writes `server.env` (the API
   domain and a database password generated on the server) and stops after creating a
   `backend/.env` template. Fill it in (`nano ~/frameforge/backend/.env`) and run the same command
   again: it builds, starts everything and checks the API.

4. **Check:** `curl https://api.example.com/healthz` prints `{"status":"ok"}`.

**Update later:** `cd ~/frameforge && git pull && bash server.sh api.example.com <repo-url> development`.
Database migrations run when the API starts. `backend/.env` and the database password are never
overwritten.

**Logs:** `cd ~/frameforge && sudo docker compose --env-file server.env -f docker-compose.server.yml logs -f backend`
(use `caddy` instead of `backend` for the certificate).

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
AVATAR_APP_URL=https://<the website address>
AVATAR_ALLOWED_ORIGINS=https://<the website address>
AVATAR_BANNERS=on
AVATAR_S3_BUCKET=<bucket name>
AWS_REGION=ap-south-1
```

`AVATAR_APP_URL` and `AVATAR_ALLOWED_ORIGINS` are the **website's** address (the Vercel site or
your own domain on it), exactly as in the browser's address bar, with no slash at the end; several
addresses are separated by commas. They are not the API domain. A request from any other website
gets 403 `origin_refused`.

### S3 without keys (EC2)

Attach an IAM role to the instance allowing `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on
`arn:aws:s3:::<bucket>/videos/*`, and set the instance's metadata hop limit to 2 (EC2 console >
instance > Actions > Instance settings > Modify instance metadata options), because the API runs
inside Docker. The bucket needs public access blocked, a lifecycle rule deleting `videos/` after
30 days, and CORS allowing `GET` and `HEAD` from the website's address (for the Download button).

## Frontend (Vercel)

Import the repository with **Root Directory = `frontend`**. No environment variable is needed:
`frontend/vercel.json` forwards `/api/*` to the backend, `https://api.sptel.in`. To use another
backend, change the `destination` in that file, commit and push.

The address must be written out in `vercel.json`. Vercel reads its configuration without running
code, so a `vercel.mjs` that builds the address from an environment variable gave an empty
destination: API calls failed with 502 `DNS_HOSTNAME_NOT_FOUND`, and later Vercel refused the
deployment outright (`rewrites[0] missing required property destination`).

The backend must list the site's exact address in `AVATAR_ALLOWED_ORIGINS` (and use it as
`AVATAR_APP_URL`), or every form post returns 403 `origin_refused`.

## Local frontend against the deployed backend

Put the same line in `frontend/.env` and restart `npm run dev`:

```
API_TARGET=https://api.example.com
```

The dev server forwards `/api` there. Leave it empty to use a backend on your own machine. This
talks to the real backend: accounts, videos and payments are real.

**Not verified:** Vercel's size limit for forwarded requests is not documented; test a photo of
about 10 MB on the deployed site.
