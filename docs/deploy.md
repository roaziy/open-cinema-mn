# Deploying Open Cinema

Open Cinema runs in three places:

| Part                     | Where                                              | How                                                     |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| API (`backend/`)         | A Linux VPS you can SSH into but do not administer | pm2, behind the server's existing reverse proxy         |
| Database                 | Supabase (Postgres)                                | Session pooler connection, nothing installed on the VPS |
| Admin web (`web-admin/`) | Vercel                                             | Project with root directory `web-admin/`           |
| Customer app (`app/`)    | Development builds on your own devices             | `npx expo run:ios` / `run:android`                      |

There is no Docker and no database on the VPS. Credentials (Supabase, wesend, Apple Wallet) are
collected in [`credentials.md`](credentials.md). Do that before going live: with
`NODE_ENV=production` the default `MESSAGES_PROVIDER=dev` does not log login codes (it only
records the recipient), so nobody can complete an OTP login. A production deployment needs
`MESSAGES_PROVIDER=wesend` with a working key. Local storage and no Wallet are fine to start with.

## 1. API on the VPS

Everything lives in your home directory; no root access is needed except where noted.

### 1.1 One-time setup

```bash
# Node 24 through nvm (installs into ~/.nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24 && nvm alias default 24
node -v   # v24.x

npm install -g pm2

git clone https://github.com/<owner>/open-cinema-mn.git ~/open-cinema
cd ~/open-cinema/backend
mkdir -p logs
npm ci
```

Every package is standalone, so the VPS only needs the API: install from `backend/`. `npm ci`
installs the dev dependencies too, which the build needs (esbuild). The app and admin web
dependencies are never installed on the VPS.

### 1.2 Configure

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

The API's env file lives at **`backend/.env`** (it used to be the repository root `.env`). On an
existing server move it once: `mv ~/open-cinema/.env ~/open-cinema/backend/.env`.

Set at least these for production (every variable is described in `backend/.env.example`):

| Variable                                 | Value                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `NODE_ENV`                               | `production` (pm2 also sets it)                                                          |
| `HOST`                                   | leave unset (binds `127.0.0.1` in production); never `0.0.0.0` behind the proxy          |
| `PORT`                                   | `4000` (any free port; keep the proxy in step)                                           |
| `DATABASE_URL`                           | the Supabase **session pooler** URL, port 5432                                           |
| `JWT_SECRET`, `QR_SECRET`, `LINK_SECRET` | three different random strings of 32+ characters (`openssl rand -base64 48`)             |
| `BFF_SECRET`                             | random, 32+ characters, required; the same value goes into the Vercel project            |
| `DATABASE_SSL`                           | `verify` with `DATABASE_CA_FILE` (recommended), or `require`; see 1.2.1                  |
| `ALLOW_MOCK_PAYMENTS`                    | `1`: v1 has only the mock payment provider, which production refuses without this opt-in |
| `APP_NAME`                               | optional product name shown to customers (default `Open Cinema`)                         |
| `API_PUBLIC_URL`                         | `https://cinema-api.roaziy.cloud`                                                        |
| `WEB_PUBLIC_URL`                         | `https://cinema.roaziy.cloud`                                                            |
| `CORS_ORIGINS`                           | `https://cinema.roaziy.cloud`                                                            |
| `TRUST_PROXY`                            | `1` when the API sits behind one reverse proxy (see 1.5)                                 |

#### 1.2.1 Database TLS (recommended: `verify` with Supabase's CA)

The default in production is `DATABASE_SSL=require`: encrypted, but the server's identity is **not**
checked, so an attacker on the path could impersonate the database. The API warns about this at every
start. Switch to `verify`:

1. Supabase, Project Settings, Database, SSL configuration: click "Download certificate" and switch
   on "Enforce SSL on incoming connections".
2. Copy the file to the VPS, for example `~/secrets/supabase-ca.crt` (`chmod 600`).
3. In `.env`: `DATABASE_SSL=verify` and `DATABASE_CA_FILE=/home/<you>/secrets/supabase-ca.crt`.
4. Reload (`pm2 reload open-cinema-api --update-env`); the warning is gone.

How the settings combine:

- `off`: plaintext, local development only (the default outside production).
- `require`: encrypted, identity not checked.
- `verify`: encrypted and the certificate is checked against `DATABASE_CA_FILE` (the system store when
  unset, which does not trust Supabase's own CA).
- A `sslmode=verify-full` / `verify-ca` (and `sslrootcert=`) in `DATABASE_URL` is honoured as `verify`.
  `DATABASE_SSL=verify` together with `sslmode=verify-full` is accepted (same strength; both check the host name).
  A `DATABASE_SSL` weaker than the URL's `sslmode` stops the API from starting, with an error naming both.

The API reads `backend/.env` (pm2 passes `--env-file-if-exists=.env` to node, with `backend/` as the
working directory).
Variables already set in the environment win over the file.

### 1.3 Build, migrate, start

```bash
# from ~/open-cinema/backend
npm run build        # dist/index.js, dist/migrate.js, dist/admin-create.js
npm run db:migrate:prod
# first deploy only: the first admin account (asks for the password without echoing it)
npm run admin:create:prod -- --email you@example.com --name "Your Name"

pm2 start ecosystem.config.cjs
pm2 save
curl -s http://127.0.0.1:4000/v1/health      # {"ok":true,"db":true}
```

`admin:create:prod` never touches other data. For a scripted setup pass the password in
`ADMIN_PASSWORD` instead of typing it. It refuses to overwrite an existing admin; to recover a lost
password run it again with `--reset-password` (this also clears a lockout). The admin changes the
password later from the gear icon next to their name in the admin app.

Demo data (fictional cinemas and films) is for development only: `db:seed` refuses to run with
`NODE_ENV=production` and truncates every table, so never use it on a live database.

The build bundles the API with esbuild into `backend/dist/index.js` (its own code, including `src/shared`, is
bundled; dependencies are loaded from `node_modules`). `db:migrate:prod` runs the bundled `dist/migrate.js` with plain
node, so production never needs tsx. The migration SQL stays in `backend/drizzle/`.

Run exactly **one** instance. The live seat feed (SSE) keeps its state in memory, so the pm2 file
pins `instances: 1`. Do not switch it to cluster mode.

### 1.4 Start on boot

`pm2 save` stores the process list; something must still start pm2 after a reboot.

- If you may use sudo: `pm2 startup` prints one command, run it as shown, then `pm2 save` again.
- If you may not, use a user crontab (`crontab -e`) and add:

  ```cron
  @reboot . $HOME/.nvm/nvm.sh && pm2 resurrect
  ```

  `pm2 resurrect` restores the list saved by `pm2 save`. Check it once after a real reboot.

Logs live in `~/open-cinema/backend/logs/` (`api-out.log`, `api-error.log`). Rotate them:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Useful commands: `pm2 status`, `pm2 logs open-cinema-api`, `pm2 monit`.

### 1.5 Reverse proxy

Ask the server's administrator to add one of the blocks below (or add it yourself if you manage the
proxy). Both send `cinema-api.roaziy.cloud` to `127.0.0.1:4000` and are safe for Server-Sent Events:
no response buffering and a long read timeout. The live seat feed would otherwise stall or arrive
in bursts.

Caddy:

```caddyfile
cinema-api.roaziy.cloud {
    reverse_proxy 127.0.0.1:4000 {
        # flush each SSE event immediately
        flush_interval -1
        transport http {
            read_timeout 1h
        }
    }
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    http2 on;   # nginx before 1.25.1: write `listen 443 ssl http2;` instead
    server_name cinema-api.roaziy.cloud;

    # ssl_certificate / ssl_certificate_key: managed by the server's certbot or equivalent

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # SSE: never buffer, never time out while the stream is quiet
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

The API binds `127.0.0.1` by default in production (`HOST` unset), so the proxy is the only way in.
Keep it that way and keep port 4000 closed in any firewall: with `TRUST_PROXY=1` the API believes
`X-Forwarded-For`, so a client that could reach port 4000 directly could forge its address and
bypass the per-IP OTP and login limits. If `HOST` is set to anything else in production while
`TRUST_PROXY` is above 0, the API logs a warning at startup.

With one proxy in front, set `TRUST_PROXY=1` in `.env`. If it stays `0` in production the API logs
a warning at startup (`TRUST_PROXY is 0: behind a reverse proxy every client shares its address`):
every visitor would look like the proxy, so the per-IP rate limits would treat the whole world as one
client. Use `2` if a CDN sits in front of the proxy as well.

The admin web app does not rely on this: it forwards the end user's address with
`x-oc-client-ip`, which the API accepts only together with a valid `BFF_SECRET`.

### 1.6 Update

```bash
cd ~/open-cinema
before=$(git rev-parse HEAD)
git pull --ff-only
cd backend
# npm ci deletes node_modules first, so only run it when the lockfile changed, with the API stopped
if ! git diff --quiet "$before" HEAD -- package-lock.json; then
  pm2 stop open-cinema-api
  npm ci
fi
npm run build
npm run db:migrate:prod
pm2 startOrReload ecosystem.config.cjs
curl -s http://127.0.0.1:4000/v1/health
```

**Deploy order.** Always release the API first, then the admin web (Vercel), then rebuild the
device app. The clients validate responses strictly, so a client that expects a field the API does
not send yet shows an error instead of the screen. New fields therefore ship in the API one release
before any client requires them.

What this guarantees:

- **No half-built tree.** The build writes `backend/dist.next/`, then renames `dist` to `dist.old`
  and `dist.next` to `dist` (two renames back to back; if the second fails the first is undone),
  and deletes `dist.old`. A pm2 restart during the slow part of a build always finds the previous
  complete tree.
- **No broken `node_modules`.** `npm ci` runs only when `backend/package-lock.json` changed, and only while
  the API is stopped (about a minute of downtime for those releases). `startOrReload` starts it again
  afterwards (and also works when nothing was stopped).
- Migrations run before the new code starts, so they must be additive (see rollback).

**Downtime.** The API runs as a single process (the seat feed lives in memory), so every
`pm2 reload` is really a stop followed by a start: expect a short outage, usually 1 to 2 seconds
(drain plus boot), and up to the hard exit below when a payment provider call is in flight. Apps
reconnect their seat feed automatically.

**What the drain does.** On SIGINT/SIGTERM the API stops accepting connections, answers any new seat
stream with 503 and `Connection: close`, ends the open seat streams, closes keep-alive connections as
soon as they go idle, lets running requests finish, and only then closes the database pool. From the
signal on, no refund starts and neither the sweeper nor a showing cancellation starts a new payment
provider call: the sweeper stops after the item it is on, and a showing cancellation that is still
refunding keeps its cancelled bookings and still emails the customers, but leaves the refunds it has
not started owed. A request already being served (one that started before the signal, or arrives on
a keep-alive connection that is still open) may still make its own provider call, such as a booking
poll checking its invoice within the 20 s provider timeout; a refund that check turns up is left owed
the same way. The log names each deferred refund
(`draining: refund of <booking> left to the sweeper`) and the sweeper pays them in its first pass,
30 s after the restart. Connections still open after 25 s (the 20 s provider timeout plus 5 s) are
destroyed and the process exits with code 1 after 28 s at the latest, inside pm2's `kill_timeout` of
30 s. The limit, honestly: a provider call that is still running at the hard exit is killed. A
refund in that state is stored as `refunding` and re-claimed by the sweeper after its TTL, so it is
retried rather than lost; whether that retry can double-refund depends on the provider honoring an
idempotency key, which must be confirmed when real payment credentials are wired in (the mock
provider has no such risk).

**pm2 remembers its configuration.** pm2 stores the app settings
(such as `kill_timeout`) in its process list when the process is first started, and a reload does not always pick up changes, so after the
ecosystem file changes in a release, recreate the process once:

```bash
pm2 delete open-cinema-api
pm2 start ecosystem.config.cjs      # from ~/open-cinema/backend
pm2 save
pm2 describe open-cinema-api | grep -iE "kill|restart"   # check the values you expect
```

### 1.7 Roll back

```bash
cd ~/open-cinema
git log --oneline -5              # pick the last good commit
git checkout <good-sha>
cd backend
pm2 stop open-cinema-api
npm ci
npm run build
pm2 startOrReload ecosystem.config.cjs
```

Migrations are not reverted automatically. Keep them backward compatible with the previous release
(add columns, do not drop them in the same release). If a migration itself is the problem, restore
from a Supabase backup (see below) rather than editing the database by hand. Return to the branch
afterwards with `git checkout main` before the next update.

### 1.8 Backups

Backups come from Supabase (its own daily backups, or a scheduled `pg_dump` in a GitHub Action
using the database URL as a repository secret), never from the VPS.

## 2. Admin web on Vercel

The admin web app (`web-admin/`, Next.js) is deployed from the same repository as a Vercel project.

1. Vercel, Add New, Project, import the GitHub repository.
2. **Root Directory**: `web-admin`. The package is standalone (its shared code is the copy in
   `web-admin/lib/shared`), so nothing outside the root directory is needed.
3. **Install Command**: `npm ci`.
   **Build Command**: `npm run build`. Framework preset: Next.js. Node.js version: 24.x.
4. Environment variables (Production and Preview):

   | Variable            | Value                                                                                                                                                                                        |
   | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `API_INTERNAL_URL`  | `https://cinema-api.roaziy.cloud`                                                                                                                                                            |
   | `BFF_SECRET`        | the same value as on the VPS                                                                                                                                                                 |
   | `APP_NAME`          | optional product name (default `Open Cinema`)                                                                                                                                                |
   | `ADMIN_FONT_DIR`    | leave unset on Vercel (licensed fonts are never committed; the app falls back to Onest)                                                                                                      |
   | `WALLET_BADGE_FILE` | set to `1` only after you put Apple's "Add to Apple Wallet" artwork at `web-admin/public/wallet-badge-mn.svg` (Apple's licence applies; until then the guest page shows a plain text button) |

   Check `web-admin/.env.example` for any variable added since this was written.
   The door scanner (`/staff/scan`) opens the phone camera, which browsers only allow on HTTPS (or
   localhost), so the staff phones must use the https domain. `npm run build` first copies the QR
   decoder's wasm into `public/zxing/` (`prebuild` / `predev`); a bare `next build` or `next dev`
   skips that step and the scanner then cannot load its decoder.
5. Domain: add `cinema.roaziy.cloud` under Project, Settings, Domains and create the DNS record
   Vercel shows. The same hostname goes into `WEB_PUBLIC_URL` and `CORS_ORIGINS` on the VPS.

After the first deploy, open `https://cinema.roaziy.cloud` and sign in with the account you created
in 1.3. Change the password under the gear icon next to your name.

Poster uploads travel through a Vercel Function, which rejects request bodies over 4.5 MB. The
admin app therefore shrinks a picture in the browser (longest side 2400 px, re-encoded as WebP or
JPEG) before sending it, and refuses a file that is still over 4 MB.

## 3. Customer app

The app is not published to a store in v1. Build it onto your device:

```bash
cd app
EXPO_PUBLIC_API_URL=https://cinema-api.roaziy.cloud npx expo run:ios --device
```

`EXPO_PUBLIC_API_URL` is baked in at build time; change it and rebuild to point somewhere else.

## 4. CI notes

`.github/workflows/ci.yml` runs typecheck, lint, tests, the production build, a check that the three `shared` copies are identical, and a secret scan
(gitleaks). While the repository belongs to a personal account the scan needs nothing. If it moves
to a GitHub organization, `gitleaks-action` requires a licence key: add it as the repository secret
`GITLEAKS_LICENSE` (free for open-source use at gitleaks.io), or the job fails.
