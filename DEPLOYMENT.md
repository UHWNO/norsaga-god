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

Configure server credentials through Plesk environment variables. Browser map
credentials (`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`) are compiled into the
browser bundle and must be domain-restricted. A successful build does not
complete the access-control, data-license or operational gates documented in
`docs/NORSAGA_PRODUCTION_CHECKLIST.md`.
