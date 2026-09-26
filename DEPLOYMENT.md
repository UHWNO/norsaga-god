# NorSaga — local and Plesk setup

Runtime: Node.js 26.9.0

## Local production preview

```sh
export PATH="/Users/uhw/.local/share/node/node-v26.9.0-darwin-arm64/bin:$PATH"
npm ci
npm run build
npm start
```

The production server listens on `http://127.0.0.1:4174` by default. The Vite
development server remains available through `npm run dev`.

## Plesk target

- Domain: `godseye.norsaga.com`
- Node.js: 26.9.0
- Application mode: production
- Application root: `/godseye.norsaga.com/app`
- Document root: `/godseye.norsaga.com/app/dist`
- Startup file: `app.cjs`
- Install runtime dependencies: `npm ci --omit=dev`

Deploy an archive containing an `app/` directory with the tracked repository
files plus the prebuilt `dist/`. Exclude credentials, `.git`, local caches and
`node_modules`. Preserve the previous application directory as a rollback copy
until the new `/healthz`, application shell and provider routes are verified.

The production server serves only `dist/` and mounts the existing provider
middleware. Local credential-writing endpoints are deliberately excluded.
`/healthz` reports readiness and the active Node version. Unknown API routes
return JSON 404.

## Staging access and edge controls

The Plesk deployment is a protected staging service, not a public release.
Plesk protects `/` with HTTP Basic authentication using the realm
`NorSaga staging`. The staging username is `norsaga`; its generated password is
stored in the deployer's macOS Keychain under the service
`godseye.norsaga.com staging access`. Retrieve or rotate it through Keychain
Access or Plesk rather than copying it into this repository, shell history or a
deployment archive.

The domain's Plesk **Apache & nginx Settings** add these response controls:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: frame-ancestors 'none'`
- `Strict-Transport-Security: max-age=31536000`

Plesk's maximum request-body setting is 5 MB, with the same
`client_max_body_size 5m` limit retained in the domain nginx directives. The
provider middleware keeps its smaller route-specific body and response caps.
After changing Plesk configuration, verify an unauthenticated request returns
401, an authenticated `/healthz` request returns 200, the headers above are
present, and a body-consuming API route refuses oversized input.

Configure server credentials through Plesk environment variables. Browser map
credentials (`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`) are compiled into the
browser bundle and must be domain-restricted. A successful build does not
complete the access-control, data-license or operational gates documented in
`docs/NORSAGA_PRODUCTION_CHECKLIST.md`.
