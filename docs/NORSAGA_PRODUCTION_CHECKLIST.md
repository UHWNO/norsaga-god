# NorSaga production gates

Status: not completed by the interface customization. Do not equate a successful
static build with a secured, operational hosted intelligence service.

## Access and secrets

- [x] Protect the current Plesk staging deployment with server-enforced authentication.
- [ ] Add required account management, logout and session expiry.
- [x] Restrict hosted provider configuration to Plesk administrators; the
  production bundle does not expose the local key-setup surface.
- [x] Keep server secrets outside Git, browser bundles and application logs.
- [ ] Restrict browser-visible map credentials by allowed origin and provider permissions.
- [x] Check repository history and generated assets for accidentally committed credentials.
- [x] Retain the upstream local-only setup restrictions; do not expose a development
  server or credential-writing endpoint by weakening its loopback checks.

## Hosting

- [x] Confirm the existing deployment architecture and preserve its working configuration.
- [x] Provide an appropriate production server for API/provider routes, not just `dist/`.
- [ ] Configure HTTPS, proxy trust, WebSocket handling, request limits, caching,
  health checks, supervised processes and graceful restart.
- [ ] Review rate limits, provider costs, quotas, reconnect behavior and stale-data states.
- [x] Do not use `vite preview` as a production server. Vite's documentation states
  that it is a local preview tool: https://vite.dev/guide/static-deploy.html
- [x] Preserve the last known working deployment and a documented rollback procedure.

## Data governance

- [ ] Resolve every item in [the source review](NORSAGA_DATA_COMPLIANCE.md).
- [ ] Remove restricted datasets from actual commercial artifacts, not just menus.
- [ ] Expose provider, observation/publication time, freshness, coverage and provenance.
- [ ] Label forecasts, inferred positions, observations and unverified intelligence distinctly.
- [ ] State that the product is situational intelligence, not a navigation system.

## Verification

- [ ] Confirm the deployed revision matches the intended Git commit after each automated deployment.
- [x] Run the complete existing test suite, package-boundary checks and production build.
- [ ] Test actual AIS and weather feeds with approved staging credentials.
- [ ] Test missing keys, offline mode, provider timeout, stale feed and reconnect behavior.
- [ ] Test all four launch choices and all twelve operating-area presets.
- [ ] Test a shared camera link and pending tracked-vessel link before and after navigation.
- [ ] Test original aircraft, satellite, CCTV, scene, voice and visual-effect functions.
- [ ] Test keyboard-only use, focus restoration, zoomed text and reduced motion.
- [ ] Test on actual supported iPhone/iPad Safari, Android Chrome, macOS Safari/Chrome
  and Windows Edge/Chrome; publish minimum browser/OS requirements from results.
- [ ] Test WebGL/GPU constraints, rotation, narrow portrait screens and landscape mode.
- [ ] Verify required provider attribution stays visible in normal and recording modes.

The new component tests do not certify the entire application or any specific
iOS, iPadOS, Android or Windows version. Full browser/device validation remains
necessary before making compatibility claims.

## Verified staging evidence — 25 September 2026

- Plesk protects `/` and provider routes with the `NorSaga staging` Basic Auth
  realm. The generated credential is held in macOS Keychain, not in Git.
- HTTPS redirects correctly and the active Let's Encrypt certificate covers
  `godseye.norsaga.com`.
- nginx returns the five security headers documented in `DEPLOYMENT.md`; Plesk
  stores a 5 MB request limit and a body-consuming route returns 413 for a 6 MB
  probe.
- Passenger runs the production server on Node 26.9.0 and authenticated
  `/healthz` returns `{"status":"ok","node":"26.9.0"}`.
- The current credential-value audit found no server-only value in `dist/` and
  no configured credential value anywhere in Git history. The two intentional
  browser credentials remain in the bundle and still require provider-side
  origin/permission verification.
- The full automated suite, formatting, package boundaries and production build
  passed for the staging release. Browser/device and provider-contract gates
  below remain release blockers where unchecked.

Server authentication is only a staging perimeter. It does not supply product
accounts, logout, session expiry or role-based access. The source review also
remains unresolved: the TeleGeography and Bhote Koshi non-commercial assets are
still present in generated artifacts, so this build is not cleared for public
commercial distribution.
