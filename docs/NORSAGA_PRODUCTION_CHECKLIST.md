# NorSaga production gates

Status: not completed by the interface customization. Do not equate a successful
static build with a secured, operational hosted intelligence service.

## Access and secrets

- [ ] Protect staging and production with server-enforced authentication.
- [ ] Add required account management, logout and session expiry.
- [ ] Restrict provider configuration to authorized administrators.
- [ ] Keep server secrets outside Git, browser bundles and application logs.
- [ ] Restrict browser-visible map credentials by allowed origin and provider permissions.
- [ ] Check repository history and generated assets for accidentally committed credentials.
- [ ] Retain the upstream local-only setup restrictions; do not expose a development
  server or credential-writing endpoint by weakening its loopback checks.

## Hosting

- [ ] Confirm the existing deployment architecture and preserve its working configuration.
- [ ] Provide an appropriate production server for API/provider routes, not just `dist/`.
- [ ] Configure HTTPS, proxy trust, WebSocket handling, request limits, caching,
  health checks, supervised processes and graceful restart.
- [ ] Review rate limits, provider costs, quotas, reconnect behavior and stale-data states.
- [ ] Do not use `vite preview` as a production server. Vite's documentation states
  that it is a local preview tool: https://vite.dev/guide/static-deploy.html
- [ ] Preserve the last known working deployment and a documented rollback procedure.

## Data governance

- [ ] Resolve every item in [the source review](NORSAGA_DATA_COMPLIANCE.md).
- [ ] Remove restricted datasets from actual commercial artifacts, not just menus.
- [ ] Expose provider, observation/publication time, freshness, coverage and provenance.
- [ ] Label forecasts, inferred positions, observations and unverified intelligence distinctly.
- [ ] State that the product is situational intelligence, not a navigation system.

## Verification

- [ ] Run the complete existing test suite, package-boundary checks and production build.
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
