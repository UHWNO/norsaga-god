# Personal authentication update — 12 October 2026

Implemented a server-enforced replacement for the shared browser password using
Better Auth 1.7.7, SQLite, Mailjet and WebAuthn passkeys. The server guards provider
APIs, application HTML, user-guide/PDF files and panel documents before routing.
Public registration and browser password fallback are removed. Missing
configuration fails closed.

Approved ordinary users can request a hashed, single-use email link that expires
in ten minutes or use an optional passkey. Links are delivered in URL fragments,
require an explicit confirmation click and have Mailjet tracking disabled.
Sessions use signed Secure/HttpOnly/SameSite cookies on HTTPS, thirty-minute
server inactivity expiry, eight-hour absolute expiry and immediate membership
revocation. Cross-origin writes and oversized authentication bodies are refused;
login limits persist per IP and email address.

The only bootstrapped owner is `ulfhwy@gmail.com`. Sender configuration is
`no-reply@norsaga.com`, display name `NorSaga God´s Eye Access`. No previous email
recipients or contacts have been approved automatically. Owner administration
requires a passkey login with signed biometric/PIN user verification and fifteen-
minute freshness. Email-only owner login cannot change existing passkeys. A
SQLite trigger prevents concurrent removal of the final owner passkey. Explicit
server-only recovery is documented and audited.

The simple My Access page supports adding, approving and blocking exact email
addresses, managing passkeys, and viewing recent security events. The beginner
manual now covers these flows with four additional screenshots: 25 total, with
37 PDF pages. Authentication screenshots use an isolated database, example
accounts and a virtual authenticator; no live email was sent during those tests.
All access screens, messages and updated guide labels use US English. The login
and account pages include the exact logo supplied by the owner.

## Verification

- Full Node 24 test battery passed: 6,349 tests passed and one existing optional
  test skipped, including the serialized allocation gates. Final focused
  authentication and browser checks also passed.
- Ten authentication/security tests passed, covering anonymous API/document
  denial, closed signup, uniform email responses, hashed single-use/expired
  links, concurrent redemption, signed cookies, CSRF, body limits, logout,
  inactivity and absolute expiry, membership/link revocation, persistent limits,
  Mailjet payloads, owner uniqueness and atomic last-key protection.
- Real Chrome/CDP WebAuthn flow passed: enrollment, administration, example-user
  approval, second device, last-key refusal, logout, email-only enrollment denial
  and rejection of a correctly signed assertion lacking user verification.
- Actual production entry point smoke-tested locally: eight document/API/login/
  health routes, including denial before vessel and paid-provider middleware.
- Production build, formatting and package/import boundary checks passed.
- Updated guide: 13 chapters, 25 images, navigation, print and narrow layouts
  passed. PDF text checked and changed pages rendered and visually reviewed.
- Dependency updates resolved the three previously reported advisories. Current
  npm audit reports zero known vulnerabilities, including production dependencies.

## Production deployment

Authentication is active on `https://godseye.norsaga.com`. The Plesk document root
is `/godseye.norsaga.com/app/web-root`, so Passenger enforces access before
serving application and guide files. The persistent authentication database is
outside the Git checkout at `/godseye.norsaga.com/auth-data/auth.sqlite`.
A persistent secret, the owner address and Mailjet sender credentials are
configured through Plesk environment variables.

Live checks on 12 October confirmed that health responds with authentication
required, anonymous application and guide requests redirect to sign-in, and the
vessel API refuses anonymous access with HTTP 401. The owner exists and is active.
Actual Mailjet acceptance and inbox delivery still need verification. The owner
must enroll and verify a passkey on their own device before administering users.
Email-only user access relies on mailbox security; mailbox MFA is recommended.
No full penetration test or security certification is claimed.

See [setup, activation checks and recovery](AUTHENTICATION.md).
