# Deploying to one EC2 server

A test deployment on a single AWS EC2 instance: the same Docker images as development, in production mode,
behind Caddy for HTTPS. Everything lives in [`deploy/`](../deploy/). This is for trying the app in other
regions, not yet the production setup (that is slice 18 in ARCHITECTURE.md §11: Hong Kong, off-site backups,
key rotation, monitoring).

**Treat the data on a test server as disposable** unless you keep backups and keys as described below.

## What runs

```
internet ──443──▶ caddy (HTTPS, certificates) ──▶ web (nginx: the app, security headers) ──/api──▶ server ──▶ db
```

- Only Caddy publishes ports (80 and 443). The database, API and nginx are reachable only inside Docker.
- `/internal/` (the 報數 job trigger) is blocked at Caddy; the job runs on the server's own timer anyway.
- The server runs with `NODE_ENV=production`: the CAPTCHA and authenticator shortcuts are refused, the API
  explorer is off, and it won't start with placeholder keys.
- `TRUST_PROXY_HOPS=2` lets the per-IP sign-in limits see each visitor's real address through Caddy and
  nginx.

## 1. Launch the instance

In the EC2 console, **Launch instance**:

- **Image:** Ubuntu Server 24.04 LTS (64-bit x86).
- **Type:** `t3.small` (2 GB memory) or larger. Building the images needs the memory; `t3.micro` runs out.
- **Key pair:** create or choose one, for SSH.
- **Storage:** 20 GB gp3.
- **Security group:** allow
  - SSH (22) from **My IP** only;
  - HTTP (80) and HTTPS (443) from anywhere (Caddy needs 80 to get the certificate, then redirects it to
    HTTPS). Optionally UDP 443 too, for HTTP/3.

Then **Elastic IPs → Allocate**, and associate it with the instance, so its address survives restarts.

## 2. A name for the server

HTTPS needs a domain name pointing at the Elastic IP. Either:

- **Your own domain:** add an `A` record, e.g. `diary-test.example.com` → the Elastic IP; or
- **No domain:** use `sslip.io`, which turns an address into a name. For `203.0.113.7`, use
  `203-0-113-7.sslip.io`. If Let's Encrypt refuses a certificate for it (it limits how many it issues per
  domain), use your own domain instead.

## 3. Install Docker

```sh
ssh -i <key.pem> ubuntu@<elastic-ip>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
exit    # sign in again so the docker group applies
```

## 4. Get the code and make the settings

```sh
git clone <repository URL> diary-app      # for a private repository, use a deploy key or access token
cd diary-app
git checkout <branch>
sh deploy/make-env.sh <domain>            # writes deploy/.env with freshly generated keys
```

**Copy `deploy/.env` somewhere safe off the server now** (e.g. a password manager):
`cat deploy/.env` and paste it. The two keyrings in it are the only way to read the diaries and profiles. Lose
them and the data is gone, backups included. `make-env.sh` refuses to overwrite an existing file for that
reason.

Optional settings go in the same file (see [`.env.example`](../.env.example) for each one):
`TRANSLATE_API_URL`, `TRANSLATE_API_KEY`, `TRANSLATE_MODEL` for translation, and `SMTP_URL`, `MAIL_FROM` for
admin alert emails.

## 5. Start it

```sh
docker compose -f deploy/compose.yaml up -d --build --wait
```

The first build takes a few minutes. The server applies the database migrations as it starts. Then open
`https://<domain>`: Caddy gets the certificate on the first visit, which can take a few seconds.

## 6. The first administrator

A production database starts empty, with no sample users. Create the first SYS_ADMIN on the server; it asks
for a password, then shows a QR code for your authenticator app and asks for a code from it:

```sh
docker compose -f deploy/compose.yaml exec server node server/dist/cli.js create-sysadmin <username>
```

Sign in at `https://<domain>` as that admin. Users register themselves; the admin creates course leaders and
further admins under 用戶. To install the app on a phone, open the address in Chrome (Android: menu → Install
app) or Safari (iPhone: Share → Add to Home Screen).

## Everyday tasks

All commands run in `~/diary-app` on the server. `dc` below stands for `docker compose -f deploy/compose.yaml`
(you can set it up with `alias dc='docker compose -f deploy/compose.yaml'`).

| Task | Command |
| --- | --- |
| Status | `dc ps` |
| Logs (follow) | `dc logs -f server` (also `web`, `caddy`, `db`) |
| Update to the latest code | `git pull`, `sh deploy/backup.sh`, then `dc up -d --build --wait` |
| Free disk from old images | `docker image prune -f` |
| Change a setting in `deploy/.env` | edit it, then `dc up -d server` |
| Recover an account | `dc exec server node server/dist/cli.js set-password <name>` (or `reset-totp <name>`) |
| Stop / start everything | `dc stop` / `dc up -d --wait` |

## Backups

```sh
sh deploy/backup.sh     # writes deploy/backups/diary-<time>.sql.gz, keeps the newest 14
```

To back up every night at 03:00 (server time), add this with `crontab -e`:

```
0 3 * * * cd /home/ubuntu/diary-app && sh deploy/backup.sh >/dev/null 2>&1
```

Backups on the server vanish with the server, so copy them off from your own computer:

```sh
scp -i <key.pem> 'ubuntu@<elastic-ip>:diary-app/deploy/backups/*.sql.gz' .
```

A backup holds encrypted diaries and is useless without the keyrings in `deploy/.env`. Keep the two apart,
so that neither one alone exposes anything.

**Restore** a backup (this replaces the current data):

```sh
gunzip -c deploy/backups/<file>.sql.gz | dc exec -T db psql -q -U diary -d diary -v ON_ERROR_STOP=1
dc restart server
```

A restore onto a new server needs the original `deploy/.env` (same keyrings) in place before starting.

## Removing the test server

In the EC2 console, terminate the instance, then **release the Elastic IP** (AWS charges for an address
that isn't attached to a running instance). If you used your own domain, remove its `A` record.
