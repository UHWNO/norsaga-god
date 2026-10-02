# NorSaga Maritime Intelligence — first customization release

Branch: `norsaga-maritime-v1`  
Baseline: `ce671ce500a393be27e3cbb2a08799fbca9b6e28`  
Status: review / staging. No production deployment is performed by these changes.

## Implemented

- NorSaga page title, metadata, Goldman wordmark, Inter interface, blue palette,
  loading screen and typographic favicon. The original software license remains.
- Four launch choices: Global maritime, Baltic Sea, Arctic and Global overview.
- Twelve operating-area camera presets, including the Danish Straits, North Sea,
  Norwegian Sea, Barents Sea, Svalbard, Greenland Sea and Northern Sea Route.
- Maritime shortcuts for the existing AIS, wind and weather-imagery layers.
  Existing full Data Layers, aircraft, satellites, cameras, effects, tracking,
  scenes and original exploration modes remain available.
- About / open-source information with a link to the data-source review.
- Native accessible dialogs, keyboard controls and reduced-motion support.
- New-region navigation uses the existing camera-ownership handoff.
  Shared views retain precedence over the default camera. No new feed requests
  occur until a visitor chooses a mission or enables a layer.
- Missing keys and failed or stalled feed requests are reported without trapping
  the user on the launcher. Enabled means selected, not verified live coverage.

## Deliberate boundaries

This is a presentation and navigation release, not a completed maritime data
product. Ports, persistent tracks, GNSS interference, sea ice, navigational
warnings, incidents, NorSaga news and alerts need separate source integrations.
There are no simulated live feeds or nonfunctional toggles for these features.
Camera presets are approximate framing positions, not route plans, regulatory
boundaries, authoritative chart coverage or navigation instructions.

Authentication, account administration, durable history and a hardened hosted
backend are not implemented in this change. `noindex` is not access control.
Read [the production checklist](NORSAGA_PRODUCTION_CHECKLIST.md) before hosting.

## Review locally

Use a Node version already allowed by the repository's `package.json`.

```sh
git fetch origin
git switch norsaga-maritime-v1
npm ci
npm run doctor
node --test src/norsaga/profile.test.mjs
npm run check:boundaries
npm test
npm run build
npm run dev
```

Use `?welcome=1` to replay the launcher and `?welcome=0` to skip it.
The Views button reopens it without reloading. Existing shared map links take
priority over welcome preferences. Existing GEV storage keys are intentionally
preserved to avoid silently resetting a visitor's saved settings.

## Where to customize

| File | Responsibility |
| --- | --- |
| `src/norsaga/profile.js` | Regions, launch choices, layer shortcuts, bounded mission requests |
| `src/norsaga/camera.js` | Camera adapter and initial global framing |
| `src/norsaga/experience.js` | Operating-area controls, launcher and About |
| `src/norsaga/theme.css` | NorSaga application skin |
| `src/standalone/startupChrome.js` | Lifecycle integration |
| `src/ui/templates/scene-chrome.html` | Visible wordmark |

The package name is retained because the upstream package uses self imports and
exports. Rebranding that internal identifier is unnecessary for the visible UI.
Provider attribution containers and upstream license notices must not be hidden.
The Goldman wordmark is used directly; no unverified remote logo or font binary
is copied into this repository.

## Release sequence

Review the branch, complete automated and actual-device tests, resolve the data
licensing and hosted-backend gates, deploy to a protected staging instance, then
merge an approved release. Keep the current production build available for rollback.
