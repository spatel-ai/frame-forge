# Deploying Frameforge R1 on AWS + Vercel

Backend (PostgreSQL, API, Caddy for HTTPS) on one EC2 instance, videos and backups in S3, web app on
Vercel. The instance uses an IAM role: no AWS access keys exist anywhere. There is no SSH: you open
a shell through Session Manager. Files: `deploy/aws/frameforge.yaml`, `docker-compose.aws.yml`,
`deploy/Caddyfile.aws`, `deploy/make-backend-package.sh`, `frontend/vercel.mjs`. The generic server guide is `docs/DEPLOY.md`; this file replaces its steps
1 to 7 for AWS.

## Status: NOT VERIFIED on a real account

Nothing was deployed. Evidence that exists: `cfn-lint` passes on the template; `docker compose config`
parses the two Compose files together; the package script was run and its listing checked. Not
verified, and each needs a real run: the stack launching, the bootstrap script running on Amazon Linux
2023, the pinned Compose (v2.29.7) and Buildx (v0.17.1) download URLs, Caddy getting a certificate,
the API reading the instance role, the Vercel rewrite (see "Vercel upload limit" below), and the
backup and restore on the instance.

**Application gap found (not changed here):** the backend code has no S3 support (no `boto3`, no
reference to `AVATAR_S3_BUCKET` or `AWS_REGION`; D-065 keeps only the fal.ai link). The stack creates
the bucket and passes the variables, but the API will not write to S3 until that feature is built.
Nothing else in this layout depends on it.

## Vercel upload limit (checked 2026-11-17)

Photo uploads (up to 10 MB) pass through Vercel's rewrite to the API. What the Vercel documentation
says: https://vercel.com/docs/limits ("Proxied request timeout": a rewrite to an external destination
may take at most 120 seconds, otherwise `ROUTER_EXTERNAL_TARGET_ERROR`) and
https://vercel.com/docs/rewrites (no body limit mentioned for external rewrites). The 4.5 MB body
limit people know applies to Vercel Functions, and no page I found applies it to external rewrites. So:
**no documented limit below 10 MB was found, but none above it is stated either.** Not verified:
requires documentation review, execution, or live integration testing. Test it in step 7 with a real
10 MB photo.

If the test fails (HTTP 413 or similar), the alternative is: the browser uploads straight to the API
domain. That needs CORS on the API for the web app's origin, `credentials: 'include'`, and a session
cookie with `SameSite=None; Secure` (today it is `Lax`), and weakens the same-origin protections the
origin check relies on. It is NOT built; it needs a decision first.

## 1. Create the stack

1. Sign in to the AWS console, choose the region (default Asia Pacific (Mumbai), `ap-south-1`). The
   region needs its default VPC (all accounts have one unless it was deleted).
2. CloudFormation > Create stack > With new resources > Upload a template file >
   `deploy/aws/frameforge.yaml`.
3. Fill the two parameters you must set: `ApiDomain` (for example `api.example.com`) and
   `FrontendOrigin` (the web app's public address, for example `https://app.example.com`; used for the
   bucket's CORS rule). Leave `InstanceType` (t3.small), `VolumeSizeGb` (30) and `LatestAmi` as they are.
4. On the last page tick "I acknowledge that AWS CloudFormation might create IAM resources" and create.
   It takes a few minutes. Open the stack's Outputs tab: you need `ElasticIp`, `BucketName`,
   `SessionManagerCommand` and `PackageUploadPath`.

The instance then installs Docker by itself (about 3 to 5 minutes after the stack shows complete;
progress: `/var/log/frameforge-bootstrap.log`).

## 2. DNS

At your domain provider add an `A` record: name from `ApiDomain`, value the `ElasticIp` (the output
`DnsRecordToCreate` shows it). Check with `dig +short api.example.com`. Caddy cannot get the HTTPS
certificate until this resolves.

## 3. Build and upload the package

From the repository root on your computer:

```bash
deploy/make-backend-package.sh
aws s3 cp dist/frameforge-backend.tar.gz s3://<BucketName>/deploy/frameforge-backend.tar.gz --region <region>
```

The script refuses any package containing an env file and prints the same command. No AWS CLI? In
the console open the S3 bucket, create a folder `deploy`, and upload `dist/frameforge-backend.tar.gz`
into it.

## 4. Create the secrets file on the server

Open a shell: EC2 > Instances > select `frameforge-backend` > Connect > Session Manager (or run the
`SessionManagerCommand` output). Then:

```bash
sudo -i
nano /opt/frameforge/backend/.env      # paste the lines below with your values, save
chmod 600 /opt/frameforge/backend/.env
```

Variable names (values are yours; never commit or paste them in chat):

| Name | Value |
| --- | --- |
| `AVATAR_ENV` | `production` |
| `AVATAR_PROVIDER` | `fal` |
| `FAL_KEY` | fal.ai key (secret) |
| `AVATAR_MAX_AUDIO_SECONDS` | `12` |
| `AVATAR_PAYMENTS` | `razorpay` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay keys (secret is secret) |
| `RAZORPAY_WEBHOOK_SECRET` | optional |
| `USER_EMAIL`, `USER_EMAIL_PASSWORD` | Gmail address and its App Password |
| `AVATAR_SUPPORT_EMAIL` | shown to customers |
| `AVATAR_APP_URL` | the web app's public address, `https://app.example.com` |
| `AVATAR_ALLOWED_ORIGINS` | the same address |
| `AVATAR_BANNERS` | `on` |

Set by the stack, do not put them here: `AVATAR_S3_BUCKET`, `AWS_REGION`, `DATABASE_URL`,
`AVATAR_DATA_DIR`. No AWS keys are needed.

**Why the app address, not the API domain:** with the Vercel rewrite the browser talks to the web
app's own address, so the `Origin` header on every POST is the web app's address, not
`api.example.com`. `app/core/origin.py` refuses any POST whose `Origin` is not in
`AVATAR_ALLOWED_ORIGINS`, so a wrong value gives 403 `origin_refused` on login. Emailed links use
`AVATAR_APP_URL`. If you also use the Vercel preview or `*.vercel.app` address, list each one,
comma-separated, no trailing slash.

## 5. Deploy the backend

```bash
sudo frameforge-deploy
curl https://<ApiDomain>/healthz        # {"status":"ok"}
```

The script downloads the package with the instance role, unpacks it into `/opt/frameforge`, stops with
a clear message if `backend/.env` is missing, creates the database password on the first run (stored
only in `/opt/frameforge/deploy/secrets.env`, root-only), and starts the stack with a build. The first
build takes several minutes. Logs: `sudo frameforge-compose logs -f backend`.

## 6. Deploy the web app to Vercel

From the repository root, then:

In Vercel: import the repository with **Root Directory = `frontend`**, then add one environment
variable (Project > Settings > Environment Variables, for Production and Preview):

```
API_TARGET=https://<ApiDomain>
```

and deploy (or `cd frontend && npx vercel --prod`). `frontend/vercel.mjs` reads the variable at
build time and forwards `/api/*` to it; the build stops with a clear message if it is missing.
To change the backend later, change the variable and redeploy: no file is edited. For local
development put the same line in `frontend/.env` (see `frontend/.env.example`).

Add the
custom domain `app.example.com` in Vercel, then make sure `FrontendOrigin` (stack) and
`AVATAR_APP_URL` / `AVATAR_ALLOWED_ORIGINS` (`backend/.env`) match it. After editing `backend/.env` run
`sudo frameforge-compose up -d backend`.

## 7. Smoke test

1. `https://<ApiDomain>/healthz` and `https://<ApiDomain>/api/v1/config` (provider `fal`, payments
   `razorpay`).
2. Open the web app, sign up, confirm the email arrives, log in (a 403 `origin_refused` means step 4's
   addresses are wrong; no session after login means the rewrite is not forwarding `Set-Cookie`:
   Not verified on Vercel).
3. Upload a photo of about 10 MB (the Vercel limit question above).
4. Paid steps (a real fal.ai video, a Razorpay payment) need the owner's explicit approval.

## 8. Operate

**Update:** `deploy/make-backend-package.sh`, upload as in step 3, then on the server
`sudo frameforge-deploy` (migrations run when the API starts; back up first when a release has one:
`sudo frameforge-backup`). `backend/.env` and the database password are never overwritten.

**Memory (2 GB):** the stack has a 2 GB swap file (swappiness 10) and limits db 512 MB, API 1100 MB,
Caddy 128 MB. Watch with `free -m` and `sudo docker stats --no-stream`. If swap is in constant use or a
container is killed (`sudo docker inspect <name> --format '{{.State.OOMKilled}}'`), move to t3.medium:
stack update, change `InstanceType` only (the instance stops and starts for a minute or two; data and
the Elastic IP stay). Before executing any stack update, read the change set: the instance must say
Replacement "False". The `LatestAmi` parameter is looked up again on every update; if a newer Amazon
Linux image would replace the instance, do not execute that change set (replacement loses the
database; restore from backup if it ever happens).

**Backups:** every night at 02:30 `pg_dump` runs and the file is kept 14 days in
`/var/backups/frameforge` and copied to `s3://<bucket>/backups/` (deleted after 30 days). Run one now:
`sudo frameforge-backup`. Log: `/var/log/frameforge-backup.log`. Photos and voices on the media
volume are not in the dump (as in DEPLOY.md). Videos are not stored (D-065).

**Restore:** copy a dump to the server (`aws s3 cp s3://<bucket>/backups/avatar-YYYY-MM-DD.dump /tmp/`
or take it from `/var/backups/frameforge`), then:

```bash
sudo -i
frameforge-compose stop backend
frameforge-compose exec -T db psql -U avatar -d postgres -c 'DROP DATABASE avatar' -c 'CREATE DATABASE avatar'
frameforge-compose exec -T db pg_restore -U avatar -d avatar --no-owner < /tmp/avatar-YYYY-MM-DD.dump
frameforge-compose start backend
curl https://<ApiDomain>/healthz
```

(The same commands were tested on the local stack on 2026-11-17 per DEPLOY.md; the AWS backup and
restore scripts themselves are not verified.)

**Monthly cost (estimate, ap-south-1 list prices, to be checked in the AWS pricing calculator; not
verified):** t3.small about USD 17 to 19, 30 GB gp3 about USD 2.5, the Elastic IP USD 0.005 per
hour (about USD 3.7, charged for all public IPv4 addresses), S3 under USD 1 at this scale, data
transfer out the first 100 GB per month free. Roughly USD 24 to 27 per month. Vercel Hobby is free
but not meant for commercial use; a paid app likely needs Pro (check Vercel's terms).

**Delete everything:** CloudFormation > the stack > Delete. The instance, Elastic IP, role and
security group go; the S3 bucket is retained on purpose (videos, backups). Empty and delete it in
the S3 console when you are sure, and remove the DNS record and the Vercel project.
