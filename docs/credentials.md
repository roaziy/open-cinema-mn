# Credentials guide

In development Open Cinema runs with no credentials at all (`MESSAGES_PROVIDER=dev`, `STORAGE_PROVIDER=local`,
`PAYMENT_PROVIDER=mock`, Wallet disabled). This guide covers what to create when you go live.
Every value goes into the server's `.env` (repository root on the VPS, `chmod 600 .env`), never into
git. Variable names below are exactly those in `.env.example`.

After editing `.env`, restart: `pm2 reload open-cinema-api --update-env`.

## 1. Supabase (database and image storage)

**What it is.** A hosted Postgres database, plus a public storage bucket for posters and images. The
API uses it as a plain database (no Supabase Auth, Realtime or RLS).

**Where it goes.**

| Variable | Value |
|---|---|
| `DATABASE_URL` | session pooler connection string, port **5432** |
| `DATABASE_SSL` | `verify` (recommended); the default `require` skips the identity check |
| `DATABASE_CA_FILE` | path to Supabase's CA certificate (for `verify`) |
| `STORAGE_PROVIDER` | `supabase` |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key (server only) |
| `SUPABASE_BUCKET` | bucket name, e.g. `open-cinema` |

**Obtain.**
1. Create a project at supabase.com. Save the database password.
2. Project, Connect, **Session pooler**: copy the URI
   `postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres`. Use the session pooler
   (IPv4, port 5432), not the transaction pooler (6543) and not the direct host. URL-encode special
   characters in the password.
3. Project Settings, Database, SSL configuration: switch on "Enforce SSL on incoming connections" and
   download the certificate. Save it on the VPS (for example `~/secrets/supabase-ca.crt`, mode 600),
   set `DATABASE_CA_FILE` to its path and `DATABASE_SSL=verify`. The default `require` also encrypts but
   does not check the server's identity (the API warns at start); `sslmode=verify-full` in the URL
   is honoured too. A `DATABASE_SSL` weaker than the URL's `sslmode` refuses to start.
4. Storage, New bucket, name it, switch **Public bucket** on.
5. Project Settings, API: copy the project URL and the `service_role` key.

**Verify.**
```bash
psql "$DATABASE_URL" -c 'select 1'
npm -w @open-cinema/backend run db:migrate:prod
curl -s http://127.0.0.1:4000/v1/health        # {"ok":true,"db":true}
```
Upload a poster through the admin app and open the returned URL in a browser; it must load without
signing in.

**Rotate / revoke.** Database password: Project Settings, Database, reset password, update
`DATABASE_URL`, reload. Service role key: Project Settings, API, regenerate, update
`SUPABASE_SERVICE_ROLE_KEY`, reload. The service role key bypasses all access rules: never put it in
the app, the admin web project or git.

## 2. wesend.mn (SMS codes and email)

**What it is.** The messaging provider for login codes (SMS) and email.

**Where it goes.**

| Variable | Value |
|---|---|
| `MESSAGES_PROVIDER` | `wesend` (required in production; see the note below) |
| `WESEND_API_KEY` | the API key |
| `WESEND_FROM_NAME` | sender name shown on email, e.g. `Open Cinema` |
| `WESEND_REPLY_TO` | optional reply-to address |

**Obtain.** Create an account at wesend.mn and an API key in its dashboard. Keys starting with
`ws_test_` are sandbox keys and deliver only to contacts you have verified in the dashboard; keys
for real traffic are live keys. Use a sandbox key first, then switch. SMS needs account credit;
Cyrillic text is 65 characters per segment, so code messages are kept short.

**Verify.** Set the sandbox key and `MESSAGES_PROVIDER=wesend`, reload, then request a login code in
the app for a verified phone number or email. It must arrive, and `pm2 logs open-cinema-api` must show no
provider error. Typical failures: `402` no credit, `422` unsupported number, `429` rate limited.
With the provider set to `dev` in development, codes appear in the API log instead. In production
(`NODE_ENV=production`) the `dev` provider deliberately hides the message content and logs only the
recipient, so no one can receive a code and OTP login cannot complete. Production needs wesend.

**Rotate / revoke.** Create a new key in the dashboard, put it in `WESEND_API_KEY`, reload, then
delete the old key.

## 3. Apple Wallet passes

**What it is.** Signed `.pkpass` tickets for "Add to Apple Wallet". Without these variables the
Wallet endpoint answers `503 {"error":"wallet_not_configured"}` and everything else works.

**Where it goes.**

| Variable | Value |
|---|---|
| `WALLET_PASS_TYPE_ID` | Pass Type ID, e.g. `pass.cloud.roaziy.opencinema` |
| `WALLET_TEAM_ID` | Apple developer Team ID (10 characters) |
| `WALLET_ORG_NAME` | name shown on the pass |
| `WALLET_SIGNER_CERT_PATH` | absolute path to the signer certificate PEM |
| `WALLET_SIGNER_KEY_PATH` | absolute path to the signer private key PEM |
| `WALLET_SIGNER_KEY_PASSPHRASE` | key passphrase, if you set one |
| `WALLET_WWDR_PATH` | absolute path to the Apple WWDR G4 certificate PEM |

**Obtain.** Needs a paid Apple Developer account.
1. developer.apple.com, Certificates, Identifiers & Profiles, Identifiers: add a **Pass Type ID**
   (`pass.<your reverse domain>.opencinema`). The Team ID is under Membership.
2. Create a certificate for that Pass Type ID. Apple asks for a CSR; create one with Keychain Access
   (Certificate Assistant, Request a Certificate from a Certificate Authority) or with openssl:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout pass.key -out pass.csr -subj "/CN=Open Cinema Pass"
   ```
   Upload the CSR and download `pass.cer`. If you used Keychain Access, export the certificate with
   its key from Keychain as `pass.p12` and skip to the p12 commands.
3. Convert to PEM files.
   - From a `.p12` (Keychain export):
     ```bash
     openssl pkcs12 -in pass.p12 -clcerts -nokeys -out signerCert.pem
     openssl pkcs12 -in pass.p12 -nocerts -out signerKey.pem        # asks for a passphrase
     ```
     (OpenSSL 3 and old p12 files: add `-legacy` if you get a MAC or algorithm error.)
   - From the openssl CSR flow:
     ```bash
     openssl x509 -inform DER -in pass.cer -out signerCert.pem
     cp pass.key signerKey.pem        # or: openssl rsa -aes256 -in pass.key -out signerKey.pem
     ```
4. Download **Apple WWDR G4** from apple.com/certificateauthority (Worldwide Developer Relations,
   G4) and convert:
   ```bash
   openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
   ```
5. Copy the three PEMs to the server, outside the repository, e.g. `~/secrets/wallet/`:
   ```bash
   mkdir -p ~/secrets/wallet && chmod 700 ~/secrets/wallet
   chmod 600 ~/secrets/wallet/*.pem
   ```
   Point the `WALLET_*_PATH` variables there. `*.pem` and `*.p12` are in `.gitignore`; still never
   commit or share them, and delete the `.p12` and `.key` files from your downloads after copying.

**Verify.** Reload the API, buy a mock booking, open its ticket and request the pass; the response
must be `Content-Type: application/vnd.apple.pkpass`, and opening it on an iPhone must offer
"Add". `wallet_not_configured` means a variable or path is missing; a pass that downloads but will
not open usually means the WWDR certificate, Team ID or Pass Type ID does not match.

**Rotate / revoke.** Pass certificates expire after about a year. Create a new certificate for the
same Pass Type ID, convert it as above, replace the files, reload. To revoke, revoke the certificate
in the Apple developer portal.

## 4. Application secrets

**What they are.** Random strings the API uses to sign tokens.

| Variable | Used for |
|---|---|
| `JWT_SECRET` | access tokens |
| `QR_SECRET` | ticket QR codes |
| `LINK_SECRET` | public ticket links and pass URLs |
| `BFF_SECRET` | trust between the admin web server and the API (also set on Vercel) |

Use a different value for each:
```bash
openssl rand -base64 48
```
In production the API refuses to start unless `JWT_SECRET`, `QR_SECRET`, `LINK_SECRET` and
`BFF_SECRET` are at least 32 characters; `openssl rand -base64 48` gives 64.

**Verify.** `pm2 logs open-cinema-api` shows a validation error if a secret is missing or too short. After setting them, sign in
to the admin web app and scan a test ticket.

**Rotate / revoke.** Changing `JWT_SECRET` signs everybody out. Changing `QR_SECRET` invalidates
printed or saved QR codes (the app fetches fresh ones; do it when no show is about to start). It also
derives the short check codes used for manual entry, so those change too.
Changing `LINK_SECRET` breaks already shared ticket and pass links. Changing `BFF_SECRET` means
updating the VPS and the Vercel project together, then redeploying both.

## 5. First admin

**What it is.** The first administrator, created by a script that never touches other data.

**Obtain.** On the VPS, after the migrations:
```bash
npm -w @open-cinema/backend run admin:create:prod -- --email you@example.com --name "Your Name"
```
It asks for the password twice without echoing it. For a scripted setup set `ADMIN_PASSWORD`
instead. It refuses to overwrite an existing admin. The demo seed (`db:seed`) is for development
only and refuses to run in production.

**Verify.** Sign in to the admin web app with that email and password.

**Rotate / revoke.** Change the password in the admin app (gear icon next to your name); this signs
out every other device. A lost password: run the command again with `--reset-password`.

## Go-live checklist

- [ ] `NODE_ENV=production`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `CORS_ORIGINS` use the real https domains
- [ ] `DATABASE_URL` is the Supabase session pooler (port 5432); `DATABASE_SSL=verify` with the CA file; migrations applied
- [ ] `JWT_SECRET`, `QR_SECRET`, `LINK_SECRET`, `BFF_SECRET` are four different random values
- [ ] Same `BFF_SECRET` and `API_INTERNAL_URL` set in the Vercel project
- [ ] `TRUST_PROXY=1` behind the reverse proxy and `HOST` unset (binds `127.0.0.1`); port 4000 is not reachable from outside; no startup warning in the log
- [ ] `MESSAGES_PROVIDER=wesend` with a live key; a real code was received
- [ ] `STORAGE_PROVIDER=supabase`; a poster upload loads from its public URL
- [ ] Wallet certificates in `~/secrets/wallet` with mode 600 (or Wallet intentionally off)
- [ ] First admin created with `admin:create:prod`, signed in, password changed
- [ ] `.env` is mode 600 and not in git; `git log -p -- .env` is empty
- [ ] `pm2 save` done, boot start verified (`pm2 startup` or the `@reboot` crontab)
- [ ] `https://cinema-api.roaziy.cloud/v1/health` answers; live seat updates work through the proxy
- [ ] Supabase backups enabled

## Teardown

To retire a deployment, revoke or rotate each credential: delete the wesend API key, revoke the
Apple Pass Type ID certificate, reset the Supabase database password and regenerate the service role
key (or delete the project), regenerate all four application secrets, and remove the server `.env`
and the wallet PEM files.
