# Secrets and optional services

In development Open Cinema needs no credentials: `MESSAGES_PROVIDER=dev`, `STORAGE_PROVIDER=local`,
`PAYMENT_PROVIDER=mock`, Wallet off. This guide covers what to set when you go live. Only the app
secrets and a database are required; every external service is optional and you choose your own.

Values go into `backend/.env` on the API host (`chmod 600`) and, for the admin web, into that host's
environment settings. Never commit them. Variable names are exactly those in `backend/.env.example`
and `web-admin/.env.example`. Restart the API after editing (with the pm2 example in
[`deploy.md`](deploy.md): `pm2 reload open-cinema-api --update-env`).

## 1. Required: app secrets

Random strings the API uses to sign things. Use a different value for each:

```bash
openssl rand -base64 48
```

| Variable | Used for |
|---|---|
| `JWT_SECRET` | access tokens |
| `QR_SECRET` | ticket QR codes and their short manual-entry check codes |
| `LINK_SECRET` | public ticket links and pass URLs |
| `BFF_SECRET` | trust between the admin web server and the API; the admin web gets the same value |

With `NODE_ENV=production` the API refuses to start if any of the four is shorter than 32 characters.

**Rotate.** Changing `JWT_SECRET` signs everybody out. Changing `QR_SECRET` invalidates saved QR codes
(the app fetches fresh ones) and changes the manual-entry codes, so do it when no show is about to
start. Changing `LINK_SECRET` breaks already shared ticket and pass links. Changing `BFF_SECRET` means
updating the API and the admin web together, then restarting both. If you suspect a leak, rotate all
four.

## 2. Required: database

Any PostgreSQL the API can reach: local, self-hosted or managed. Set `DATABASE_URL`. TLS is set with
`DATABASE_SSL` (`off`, `require`, `verify`) and, for `verify`, `DATABASE_CA_FILE`, the PEM file of your
provider's CA certificate. The three modes are explained in [`deploy.md`](deploy.md) 1.2.1; a managed
provider documents where to download its CA certificate. Special characters in the password must be
URL-encoded in `DATABASE_URL`.

```bash
cd backend
psql "$DATABASE_URL" -c 'select 1'
npm run db:migrate:prod
curl -s http://127.0.0.1:4000/v1/health        # {"ok":true,"db":true}
```

**Rotate.** Change the database password in your provider, update `DATABASE_URL`, restart.

## 3. First admin

A script creates the first administrator and never touches other data. After the migrations:

```bash
cd backend
npm run admin:create:prod -- --email you@example.com --name "Your Name"
```

It asks for the password without echoing it (for a scripted setup set `ADMIN_PASSWORD`) and refuses to
overwrite an existing admin. Sign in to the admin web with it and change the password under the gear
icon next to your name (this signs out other devices). Lost password: run the command again with
`--reset-password`. The demo seed (`db:seed`) is development only and refuses to run in production.

## 4. Optional: file storage

Posters and images. `STORAGE_PROVIDER` is:

- `local` (default): files are written under `backend/uploads/` and served by the API. Back that
  folder up; it is not part of a database dump.
- `supabase`: an optional adapter that uses a public bucket of a hosted object store.

| Variable | Value |
|---|---|
| `STORAGE_PROVIDER` | `local` or `supabase` |
| `SUPABASE_URL` | project URL (only for `supabase`) |
| `SUPABASE_SERVICE_ROLE_KEY` | service key, server only (only for `supabase`) |
| `SUPABASE_BUCKET` | public bucket name (only for `supabase`) |

**Verify.** Upload a poster in the admin app and open the returned URL in a browser; it must load
without signing in. The service key bypasses all access rules: never put it in the app, the admin web
or git. Rotate it in the provider, update the variable, restart.

## 5. Optional: login-code messages (SMS and email)

`MESSAGES_PROVIDER` is:

- `dev` (default): codes are written to the API log. With `NODE_ENV=production` it deliberately logs
  only the recipient, so nobody can receive a code and OTP login cannot complete.
- `wesend`: an optional adapter for a messaging service.

| Variable | Value |
|---|---|
| `MESSAGES_PROVIDER` | `dev` or `wesend` |
| `WESEND_API_KEY` | API key (required for `wesend`) |
| `WESEND_FROM_NAME` | sender name shown on email |
| `WESEND_REPLY_TO` | optional reply-to address |

A real deployment therefore needs a real messages provider. To use a different service, add a sender
next to `backend/src/messages/wesend.ts` that implements the `Messages` interface in
`backend/src/messages/index.ts` and select it there.

**Verify.** Set the provider, restart, request a login code in the app for a test phone or email; it
must arrive and the API log must show no provider error. **Rotate.** Create a new key, update the
variable, restart, delete the old key.

## 6. Payments

`mock` is the only provider today (`PAYMENT_PROVIDER=mock`): anyone can mark an order paid. Production
refuses to start with it unless `ALLOW_MOCK_PAYMENTS=1`, which is only right for a demo. A real
provider means implementing the `PaymentProvider` interface in `backend/src/payments/provider.ts`
(`createInvoice`, `checkPayment`, an idempotent `refund`) and selecting it in `createPayments`.

## 7. Optional: Apple Wallet passes

Signed `.pkpass` tickets for "Add to Apple Wallet". Wallet is disabled when `WALLET_PASS_TYPE_ID` is
unset: the endpoint answers `503 {"error":"wallet_not_configured"}` and everything else works. It
needs a paid Apple Developer account; Apple's own documentation (Wallet, "Building a pass") is the
reference for the steps below.

| Variable | Value |
|---|---|
| `WALLET_PASS_TYPE_ID` | Pass Type ID, e.g. `pass.com.example.opencinema` |
| `WALLET_TEAM_ID` | Apple developer Team ID (10 characters) |
| `WALLET_ORG_NAME` | name shown on the pass |
| `WALLET_SIGNER_CERT_PATH` | absolute path to the signer certificate PEM |
| `WALLET_SIGNER_KEY_PATH` | absolute path to the signer private key PEM |
| `WALLET_SIGNER_KEY_PASSPHRASE` | key passphrase, if you set one |
| `WALLET_WWDR_PATH` | absolute path to the Apple WWDR G4 certificate PEM |

**Obtain.**
1. In the Apple developer portal (Certificates, Identifiers & Profiles) add a **Pass Type ID**, e.g.
   `pass.<your reverse domain>.opencinema`. The Team ID is under Membership.
2. Create a certificate for it. Apple asks for a CSR; make one with Keychain Access or openssl:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout pass.key -out pass.csr -subj "/CN=Open Cinema Pass"
   ```
   Upload it and download `pass.cer`. If you used Keychain Access, export the certificate with its key
   as `pass.p12` instead.
3. Convert to PEM.
   - From a `.p12` (add `-legacy` on OpenSSL 3 if you get a MAC or algorithm error):
     ```bash
     openssl pkcs12 -in pass.p12 -clcerts -nokeys -out signerCert.pem
     openssl pkcs12 -in pass.p12 -nocerts -out signerKey.pem        # asks for a passphrase
     ```
   - From the openssl CSR flow:
     ```bash
     openssl x509 -inform DER -in pass.cer -out signerCert.pem
     cp pass.key signerKey.pem        # or: openssl rsa -aes256 -in pass.key -out signerKey.pem
     ```
4. Download **Apple WWDR G4** from Apple's certificate authority page and convert:
   ```bash
   openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
   ```
5. Store the PEMs outside the repository (for example `~/secrets/wallet/`, directory `700`, files
   `600`) and point the `WALLET_*_PATH` variables there. `*.pem` and `*.p12` are in `.gitignore`;
   still never commit them, and delete the `.p12` and `.key` downloads.

**Verify.** Restart, buy a mock booking, open its ticket and request the pass: the response must be
`Content-Type: application/vnd.apple.pkpass` and an iPhone must offer "Add". `wallet_not_configured`
means a variable or path is missing; a pass that downloads but will not open usually means the WWDR
certificate, Team ID or Pass Type ID does not match.

**Badge artwork.** The official "Add to Apple Wallet" badge is Apple's artwork and must be obtained
under Apple's terms; it is never drawn here. Until you place it at
`web-admin/public/wallet-badge-mn.svg` and set `WALLET_BADGE_FILE=1` in the admin web, the page shows a
plain text button.

**Rotate.** Pass certificates expire after about a year. Create a new certificate for the same Pass
Type ID, convert it, replace the files, restart. To revoke, revoke the certificate in the Apple
developer portal.

## Go-live checklist

- [ ] `NODE_ENV=production`; `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `CORS_ORIGINS` are the real https URLs
- [ ] Four different random app secrets; the admin web has the same `BFF_SECRET` and an `API_INTERNAL_URL` that reaches the API
- [ ] Database reachable, `DATABASE_SSL=verify` with the CA file (or a conscious `require`), migrations applied
- [ ] `TRUST_PROXY` matches the proxies in front, `HOST` unset, the API port closed to the outside, no startup warning
- [ ] A real messages provider is configured and a real login code was received
- [ ] Storage: `local` with `backend/uploads/` backed up, or an adapter; an uploaded poster loads
- [ ] Payments: mock accepted knowingly (`ALLOW_MOCK_PAYMENTS=1`) or a real provider implemented
- [ ] Wallet certificates stored with restrictive permissions, or Wallet intentionally off
- [ ] First admin created and the password changed
- [ ] `backend/.env` is mode 600 and not in git
- [ ] The API restarts on boot; backups of the database (and uploads) exist
- [ ] `https://api.example.com/v1/health` (your API URL) answers and live seat updates work through the proxy
