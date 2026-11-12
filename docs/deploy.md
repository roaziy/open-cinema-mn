# Deploying Open Cinema

Open Cinema is three standalone packages. Each has its own `package.json`, lockfile and `.env`.

| Part                         | Needs                                                  | Options                                                                  |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| API (`backend/`)             | Node 24, one process, a PostgreSQL database it can reach | Any host that runs Node: a Linux server (section 1), a container, a PaaS |
| Database                     | PostgreSQL                                             | Local, self-hosted or managed; the API only needs a URL                  |
| Admin web (`web-admin/`)     | A host that runs Next.js 16, and a route to the API    | `next build` + `next start` on a server, or a platform such as Vercel (section 2) |
| Customer app (`mobile-app/`) | `EXPO_PUBLIC_API_URL` pointing at the API              | EAS build or a local build (section 3)                                   |

Secrets and optional services (storage, login-code messages, payments, Apple Wallet) are in
[`credentials.md`](credentials.md). Read it before going live: with `NODE_ENV=production` the default
`MESSAGES_PROVIDER=dev` does not log login codes (it only records the recipient), so nobody can
complete an OTP login until you configure a real messages provider.

## 1. API

The API runs anywhere Node 24 runs. This section is one way to do it: a Linux server with pm2 and a
reverse proxy. The points that matter on any host:

- Run exactly **one** instance. The live seat feed (SSE) keeps its state in memory.
- Bind `HOST` to loopback behind a proxy; set `TRUST_PROXY` to the number of proxies in front.
- The proxy must not buffer responses and needs a long read timeout (section 1.5).
- Use `npm ci` (dev dependencies are needed for the build), then `npm run build`,
  `npm run db:migrate:prod` and, once, `npm run admin:create:prod`.

### 1.1 One-time setup

```bash
# Node 24 through nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24 && nvm alias default 24

npm install -g pm2

git clone https://github.com/roaziy/open-cinema-mn.git ~/open-cinema
cd ~/open-cinema/backend
mkdir -p logs
npm ci
```

Only `backend/` is installed on the server; the app and admin web dependencies are not needed.

### 1.2 Configure

```bash
cp .env.example .env
chmod 600 .env
```

The env file lives at **`backend/.env`**. On an existing server that still has a repo-root `.env`,
move it once: `mv ~/open-cinema/.env ~/open-cinema/backend/.env`.

Set at least these for production (every variable is described in `backend/.env.example`):

| Variable                                 | Value                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                               | `production` (the pm2 file also sets it)                                        |
| `HOST`                                   | leave unset (binds `127.0.0.1` in production); never `0.0.0.0` behind a proxy   |
| `PORT`                                   | `4000` (any free port; keep the proxy in step)                                  |
| `DATABASE_URL`                           | your PostgreSQL connection string                                               |
| `DATABASE_SSL`                           | `verify` with `DATABASE_CA_FILE` (recommended), or `require`; see 1.2.1         |
| `JWT_SECRET`, `QR_SECRET`, `LINK_SECRET` | three different random strings of 32+ characters                                |
| `BFF_SECRET`                             | random, 32+ characters; the same value goes into the admin web                  |
| `ALLOW_MOCK_PAYMENTS`                    | `1`; the mock provider is the only one today and production refuses it without this |
| `APP_NAME`                               | optional product name (default `Open Cinema`)                                   |
| `API_PUBLIC_URL`                         | `https://api.example.com`                                                       |
| `WEB_PUBLIC_URL`                         | `https://cinema.example.com`                                                    |
| `CORS_ORIGINS`                           | `https://cinema.example.com`                                                    |
| `TRUST_PROXY`                            | `1` behind one reverse proxy (see 1.5)                                          |

Also set `MESSAGES_PROVIDER` (and optionally `STORAGE_PROVIDER` and Wallet) as described in
[`credentials.md`](credentials.md), which also covers generating secrets. Payments: `mock` is the only
provider today; a real one means implementing the `PaymentProvider` interface in
`backend/src/payments/provider.ts`.

The API reads `backend/.env` (the pm2 file passes `--env-file-if-exists=.env` to node, with
`backend/` as the working directory). Variables already set in the environment win over the file.

#### 1.2.1 Database TLS

The default in production is `DATABASE_SSL=require`: encrypted, but the server's identity is **not**
checked, so an attacker on the path could impersonate the database. The API warns about this at every
start. To check the identity, switch to `verify`:

1. Obtain your database provider's CA certificate (PEM) and store it on the server, for example
   `~/secrets/db-ca.crt` (`chmod 600`).
2. In `.env`: `DATABASE_SSL=verify` and `DATABASE_CA_FILE=/home/<you>/secrets/db-ca.crt`.
3. Reload (`pm2 reload open-cinema-api --update-env`); the warning is gone.

How the settings combine:

- `off`: plaintext, local development only (the default outside production).
- `require`: encrypted, identity not checked.
- `verify`: encrypted and the certificate is checked against `DATABASE_CA_FILE` (the system store when
  unset, which does not trust a provider's private CA).
- `sslmode=verify-full` / `verify-ca` (and `sslrootcert=`) in `DATABASE_URL` is honoured as `verify`.
  `DATABASE_SSL=verify` together with `sslmode=verify-full` is accepted. A `DATABASE_SSL` weaker than
  the URL's `sslmode` stops the API from starting, with an error naming both.

If your provider offers several connection modes, use one that keeps normal session behaviour
(a session or direct connection rather than a transaction-level pooler).

### 1.3 Build, migrate, start

```bash
# from ~/open-cinema/backend
npm run build        # dist/index.js, dist/migrate.js, dist/admin-create.js
npm run db:migrate:prod
# first deploy only: the first admin (asks for the password without echoing it)
npm run admin:create:prod -- --email you@example.com --name "Your Name"

pm2 start ecosystem.config.cjs
pm2 save
curl -s http://127.0.0.1:4000/v1/health      # {"ok":true,"db":true}
```

`admin:create:prod` never touches other data. For a scripted setup pass the password in
`ADMIN_PASSWORD`. It refuses to overwrite an existing admin; to recover a lost password run it again
with `--reset-password` (this also clears a lockout).

Demo data (`db:seed`) is for development only: it refuses to run with `NODE_ENV=production` and
truncates every table.

The build bundles the API with esbuild into `backend/dist/index.js` (its own code, including
`src/shared`; dependencies load from `node_modules`). `db:migrate:prod` runs the bundled
`dist/migrate.js` with plain node, so production never needs tsx. The migration SQL stays in
`backend/drizzle/`.

The pm2 file pins `instances: 1`. Do not switch it to cluster mode.

### 1.4 Start on boot

`pm2 save` stores the process list; something must still start pm2 after a reboot.

- With sudo: `pm2 startup` prints one command; run it as shown, then `pm2 save` again.
- Without sudo, add to a user crontab (`crontab -e`):

  ```cron
  @reboot . $HOME/.nvm/nvm.sh && pm2 resurrect
  ```

Logs are in `~/open-cinema/backend/logs/` (`api-out.log`, `api-error.log`). Rotate them:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Useful commands: `pm2 status`, `pm2 logs open-cinema-api`, `pm2 monit`.

### 1.5 Reverse proxy

Both examples send `api.example.com` to `127.0.0.1:4000` and are safe for Server-Sent Events: no
response buffering and a long read timeout. Otherwise the live seat feed stalls or arrives in bursts.

Caddy:

```caddyfile
api.example.com {
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
    server_name api.example.com;

    # ssl_certificate / ssl_certificate_key: managed by certbot or equivalent

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
Keep it that way and keep the API port closed in any firewall: with `TRUST_PROXY=1` the API believes
`X-Forwarded-For`, so a client that could reach the port directly could forge its address and bypass
the per-IP OTP and login limits. If `HOST` is set to anything else in production while `TRUST_PROXY`
is above 0, the API logs a warning at startup.

With one proxy in front, set `TRUST_PROXY=1`. If it stays `0` in production the API warns at startup
(`TRUST_PROXY is 0: behind a reverse proxy every client shares its address`): every visitor would
look like the proxy, so the per-IP rate limits would treat everyone as one client. Use `2` if a CDN
sits in front of the proxy as well.

The admin web app does not rely on this: it forwards the end user's address with `x-oc-client-ip`,
which the API accepts only together with a valid `BFF_SECRET`.

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

**Deploy order.** Release the API first, then the admin web, then rebuild the app. The clients
validate responses strictly, so a client that expects a field the API does not send yet shows an
error instead of the screen. New fields ship in the API one release before any client requires them.

- **No half-built tree.** The build writes `backend/dist.next/`, then renames `dist` to `dist.old`
  and `dist.next` to `dist` (if the second rename fails the first is undone), and deletes `dist.old`.
  A restart during a slow build always finds the previous complete tree.
- **No broken `node_modules`.** `npm ci` runs only when `backend/package-lock.json` changed, and only
  while the API is stopped (about a minute of downtime for those releases).
- Migrations run before the new code starts, so they must be additive (see 1.7).

**Downtime.** The API is a single process, so every `pm2 reload` is a stop followed by a start:
expect an outage of usually 1 to 2 seconds, up to the hard exit below when a payment provider call
is in flight. Apps reconnect their seat feed automatically.

**What the drain does.** On SIGINT/SIGTERM the API stops accepting connections, answers any new seat
stream with 503 and `Connection: close`, ends open seat streams, closes idle keep-alive connections,
lets running requests finish, and only then closes the database pool. From the signal on, no refund
starts and neither the sweeper nor a showing cancellation starts a new payment provider call; refunds
not yet started are left owed. The log names each one (`draining: refund of <booking> left to the
sweeper`) and the sweeper pays them in its first pass, 30 s after the restart. Connections still open
after 25 s are destroyed and the process exits with code 1 after 28 s at the latest, inside pm2's
`kill_timeout` of 30 s. A provider call still running at the hard exit is killed; its refund is
stored as `refunding` and re-claimed by the sweeper after its TTL, so it is retried rather than lost.
Whether that retry can double-refund depends on the provider honouring an idempotency key, which
must be confirmed when a real payment provider is added (the mock provider has no such risk).

**pm2 remembers its configuration.** It stores app settings (such as `kill_timeout`) when the
process is first started, and a reload does not always pick up changes. After the ecosystem file
changes in a release, recreate the process once:

```bash
pm2 delete open-cinema-api
pm2 start ecosystem.config.cjs      # from ~/open-cinema/backend
pm2 save
pm2 describe open-cinema-api | grep -iE "kill|restart"
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
the database from a backup rather than editing it by hand. Return to the branch afterwards with
`git checkout main` before the next update.

### 1.8 Backups

Back up the database with whatever your PostgreSQL host provides, or a scheduled `pg_dump` stored
off the server. Uploaded images are not part of a database dump: with `STORAGE_PROVIDER=local` back
up `backend/uploads/`; with a remote storage adapter use that service's own backup.

## 2. Admin web

`web-admin/` is a Next.js app. Run it on any host that runs Next.js:

- On a server: `cd web-admin && npm ci && npm run build && npm run start`, behind your own proxy
  with HTTPS.
- On a platform such as Vercel: import the repository, set the **root directory** to `web-admin`,
  install command `npm ci`, build command `npm run build`, Node.js 24.x.

The package is standalone (its shared code is the copy in `web-admin/lib/shared`), so nothing outside
its directory is needed. Environment variables (see `web-admin/.env.example`):

| Variable            | Value                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `API_INTERNAL_URL`  | `https://api.example.com` (the API as seen from the admin server)                                                                  |
| `BFF_SECRET`        | the same value as `BFF_SECRET` in `backend/.env`                                                                                   |
| `APP_NAME`          | optional product name (default `Open Cinema`)                                                                                      |
| `ADMIN_FONT_DIR`    | optional directory with licensed font files; unset falls back to Onest                                                             |
| `WALLET_BADGE_FILE` | set to `1` only after Apple's "Add to Apple Wallet" artwork is at `web-admin/public/wallet-badge-mn.svg`; until then a text button |

Serve it on the hostname you put in `WEB_PUBLIC_URL` and `CORS_ORIGINS` on the API
(`https://cinema.example.com`). The door scanner (`/staff/scan`) opens the phone camera, which
browsers only allow on HTTPS (or localhost). `npm run build` first copies the QR decoder's wasm into
`public/zxing/` (`prebuild` / `predev`); a bare `next build` or `next dev` skips that step and the
scanner cannot load its decoder.

After the first deploy, sign in with the account created in 1.3 and change the password under the
gear icon next to your name.

If the host limits request body size (some platforms reject bodies over a few MB), note that the
admin app shrinks a picture in the browser (longest side 2400 px, WebP or JPEG) before upload and
refuses a file that is still over 4 MB.

## 3. Customer app

Point the app at the API with `EXPO_PUBLIC_API_URL`, which is baked in at build time (change it and
rebuild to point elsewhere). Build locally, or with EAS (add your own `eas.json`; none is committed):

```bash
cd mobile-app
EXPO_PUBLIC_API_URL=https://api.example.com npx expo run:ios --device
```

To brand your own build, set `APP_NAME` and `APP_BUNDLE_ID` (e.g. `com.example.opencinema`); see
`mobile-app/.env.example`. Publishing to a store follows the usual Expo and store processes.

## 4. CI notes

`.github/workflows/ci.yml` runs typecheck, lint, tests, the production build, a check that the three
`shared` copies are identical, and a secret scan (gitleaks). If the repository belongs to a GitHub
organization, `gitleaks-action` requires a licence key: add it as the repository secret
`GITLEAKS_LICENSE` (free for open-source use at gitleaks.io), or the job fails.
