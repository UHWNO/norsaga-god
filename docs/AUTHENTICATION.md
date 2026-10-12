# NorSaga personal access

The shared browser password has been removed. Better Auth 1.7.7 manages
single-use email links, signed HttpOnly session cookies and WebAuthn passkeys.
The Connect middleware runs before providers and static documents on the
production, development and preview servers. Configuration errors fail closed.
There is no password fallback, public registration or browser-storage token.

## Deployment configuration

Generate a signing secret on the target using `npm run auth:setup`. It writes
only a new `AUTH_SECRET` to the ignored `.env` and never prints the value or
overwrites an existing secret. Keep it across releases; changing it signs users
out. Configure these server environment variables:

| Variable              | Value                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_BASE_URL`       | `https://godseye.norsaga.com`                                                                                                                    |
| `AUTH_ADMIN_EMAIL`    | `ulfhwy@gmail.com` (the one owner bootstrapped on first installation)                                                                            |
| `AUTH_DB_PATH`        | Absolute persistent path outside the application releases and document root, e.g. `/var/www/vhosts/norsaga.com/private/godseye-auth/auth.sqlite` |
| `AUTH_MAIL_FROM`      | `no-reply@norsaga.com`; must be verified in the Mailjet account                                                                                  |
| `AUTH_MAIL_FROM_NAME` | `NorSaga God´s Eye Access`                                                                                                                       |
| `MAILJET_API_KEY`     | Valid Mailjet API key, kept on the server                                                                                                        |
| `MAILJET_SECRET_KEY`  | Corresponding secret, kept on the server                                                                                                         |
| `AUTH_TRUST_PROXY`    | `1` only if nginx replaces `X-Real-IP` with the actual client address and only the local proxy can connect to Node                               |

Require SPF and DKIM for the chosen sender domain and configure DMARC. Mailjet
acceptance is not proof of inbox delivery. The previously available local
Mailjet credentials returned HTTP 401 on a read-only sender check on 2026-10-12;
they have not been copied into this application. Obtain valid credentials and
confirm the sender before activation. No live login email has been sent by this
implementation.

The owner is the only initial user. Other recipients and contacts have **not**
been approved automatically. Do not change `AUTH_ADMIN_EMAIL` after initial
installation to create extra owners; use the configured account.

In Plesk, ensure **every** request reaches Passenger/Node. Disable direct nginx
and Apache static-file serving for this application's documents, JSON, media,
PDFs and panel files. A document-root shortcut can bypass Node authentication.
Set Plesk's Document Root to `/godseye.norsaga.com/app/web-root`, an empty
subdirectory of Application Root, instead of `/godseye.norsaga.com/app/dist`.
Node continues to serve the built `dist` directory itself, after authentication.
Do not copy application files into `web-root` or retain server aliases that
serve `dist` directly. Run **NPM Install**, then the `auth:setup` package script
before restarting the new release. Plesk's Node.js **Run script** field prefixes `npm run`; enter only the package
script name, such as `auth:setup` or `auth:check`. The read-only `auth:check`
script reports owner/database readiness and email acceptance without exposing
credentials. Plesk's npm runner may not inherit Passenger's custom variables.
Keep `.env` and the SQLite database outside anything the web server serves.
Node binds only to loopback; protect the server and deployment credentials with
MFA, patched software and restricted operator access. Retain HTTPS/HSTS and
back up the authentication database with SQLite's backup tooling. File copies
of a live WAL database must include its WAL or use a consistent backup.

## Owner's first login and simple administration

1. Open the app, enter the owner's approved email and request a login link.
2. Open the email within ten minutes and click **Confirm Sign-In**. Email
   scanners and previews cannot consume it merely by opening the URL.
3. On **My Access**, click **Create Passkey**. Save it using Touch ID, Windows
   Hello, your phone or a FIDO2 security key.
4. Click **Verify with Passkey**. The user list opens only after a server-verified
   passkey login with biometric/PIN user verification. Add a second passkey as
   a reserve. Administrative authorization is fresh for fifteen minutes.
5. Enter a person's name and exact email under **Approved Users**. They can
   now request their own email login. This does not automatically send an
   invitation. **Block Access** immediately revokes their server sessions and
   pending login links. The owner cannot be disabled or promoted via this UI.

Ordinary users can use a new email link on each login or register optional
passkeys for faster, phishing-resistant login. Email-only login depends on the
security of their mailbox. Require MFA on mail accounts. This is not equivalent
to requiring phishing-resistant MFA for every ordinary user.

An email-only owner session cannot administer users or add/delete owner
passkeys after the first passkey exists. It cannot delete the last owner
passkey. If all owner passkeys are lost, an authorized server operator must
perform explicit offline recovery:

```sh
node scripts/auth-recover.mjs --reset-owner-passkeys ulfhwy@gmail.com
```

This revokes the owner's sessions, clears their passkeys and invalidates
pending verification records. It records the recovery in the security log.
Then repeat email verification and passkey enrollment. There is no public
email-only recovery bypass for owner passkeys.

## Security behavior and release checks

- Email links: ten minutes, atomically consumed once, hashed database token,
  fragment-based delivery, explicit user confirmation, no Mailjet link/open
  tracking, no tokens in logs or browser storage.
- Approved and unknown addresses receive the same public response. Only
  approved active accounts receive mail. Persistent limits apply per client IP
  and recipient address, including across server restarts.
- Sessions: Secure/HttpOnly/SameSite cookies on HTTPS, thirty-minute server
  inactivity expiry and eight-hour absolute expiry; provider polling does not
  renew activity. Logout deletes the server session. Revocation is checked
  against the database on every protected request, without a cookie cache.
- Administration and passkey management: server-owned roles, no public signup,
  exact-origin CSRF checks, request body caps, recent passkey enforcement for
  the owner, escaped UI text, limited security log retained for ninety days.
- Server-side authentication covers `/api/*`, application HTML, the guide,
  PDF and panel documents. Only login assets and a minimal health response are
  public. Public frontend JavaScript has no shared authentication password.

Before announcing activation, verify on the **deployed** domain:

1. Without cookies, `/` and `/user-guide/godseye-user-guide.pdf` redirect to
   login; `/api/vessels` and paid-provider APIs return 401. Check an origin IP
   request with the production Host header too. Static-server shortcuts must
   not return protected documents.
2. A known email receives a link; an unknown email receives no mail and has
   the same HTTP response. The link succeeds once and fails after expiry/reuse.
3. Cookies are Secure/HttpOnly/SameSite and session responses use no-store.
4. Email-only login cannot access owner administration. A passkey login can.
   Test two passkeys, logout, inactivity expiry and revocation of a test user.
5. Cross-origin writes fail, anonymous feeds fail and oversized bodies fail.
6. Restart the application and confirm users/passkeys persist. Confirm backups
   and documented operator recovery before relying on this in production.

Local browser testing uses explicit `AUTH_LOCAL_DEV=1` and a loopback-only
`AUTH_BASE_URL`, with a separate database. This permits HTTP cookies solely for
local WebAuthn testing; it never disables authentication. Test harnesses inject
a fake sender into an isolated service. They do not create a production bypass
or send live email. Browser QA can consume a real session through the temporary
`QA_SESSION_COOKIE` environment variable; do not record it in logs/artifacts.

References: [Better Auth](https://better-auth.com/docs),
[OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html),
[Mailjet Send API](https://dev.mailjet.com/docs/email-api/send-api-v31/send-basic-email).
