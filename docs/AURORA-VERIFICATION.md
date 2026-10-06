# Aurora Forecast — issue #2 verification

Implemented locally on `norsaga-maritime-v1`, October 6, 2026. No merge.
Deployment was subsequently requested; release preparation and production-server
checks are described below. No new credentials or framework. Implementation follows
[GitHub issue #2](https://github.com/UHWNO/norsaga-god/issues/2), with the user's
subsequent scope adjustment: Aurora is an optional standalone layer for the first
release. AIS/weather combinations are optional. No mission automatically enables
Aurora; select its toggle in Data Layers or the NorSaga layer list.

## Forecast availability correction — October 6, 2026

The grid's original freshness checks incorrectly expired NOAA's L1 observations
after one hour, even when their forecast was still current. NOAA documents a
normal 30–90 minute solar-wind travel time between observations and forecast.
Both the server and globe now use forecast time for delay and expiry, retaining
the one-hour acquisition limit, bounded forecast lead and timestamp validation.
Refreshing an expired forecast cannot renew its validity. The NOAA image popup
remains an independent feed; its availability does not establish grid availability.

Live NOAA verification accepted 65,160 grid cells with source time 17:22 UTC
and forecast time 18:25 UTC. The globe rendered 9,967 cells above its existing
display threshold across both hemispheres, with a truthful delayed status.
Kp remained independently unavailable because nearby records were estimated;
the next predicted interval was outside the existing three-hour display window.

- Node 24 full suite: 5,126 passed, zero failed, one existing skip, including
  both serialized allocation suites.
- Focused grid, layer, animation and playback regressions: 37 passed on both
  Node 24 and Node 26, including 63/90-minute lead times, bounded cache fallback,
  delayed/expired forecasts and resource cleanup.
- Production build, setup doctor, formatting and import/package boundaries passed.
- Real NOAA browser acceptance passed on Esri fallback: map-center inspection,
  both hemispheres, actual frame playback and six toggle cycles. No unhandled
  browser errors; the globe returned to its idle rendering state.

## Presentation revision — October 6, 2026

The user requested delivery of the tested revision to GitHub on
`norsaga-maritime-v1`. No merge or Plesk deployment is performed by this agent.
The NorSaga workspace now features Aurora directly below the region selector,
with source/forecast UTC times, lead minutes, predicted Kp and geomagnetic
status outside the collapsed Data Layers panel. The NOAA-style green/yellow/red
ramp is brighter, contrast is adjustable without changing NOAA values, and
“Read map center” samples the nearest original 1° cell, distinguishing zero
from missing data. The workspace scrolls on shorter screens.

“NOAA loop” opens a centred official image viewer with north/south controls,
play/pause, previous/next, a scrubber, latest-30-minute and full-24-hour windows.
Frames retain NOAA's embedded forecast time, HPI and probability legend. The
player labels the image's model timestamp separately. These are real historical
NOAA JPEGs; the globe retains the latest JSON grid, and no historical or future
grid sequence is invented. NOAA publishes only the latest machine-readable grid
at the linked JSON endpoint. Playback never changes Cesium time or holds
continuous globe rendering.

New modules: `server/providers/auroraAnimation.js`,
`src/layers/aurora/animationSource.js`, `src/layers/aurora/inspection.js`,
`src/norsaga/auroraExperience.js`, `src/norsaga/auroraPlayback.js`.
The provider validates fixed official manifests and exact timestamped JPEG paths,
shares independently cancellable requests, caps stream sizes, limits concurrent
upstream operations, and bounds its LRU cache. Image acquisition is lazy and
same-origin. Replacement, close, disable and destroy release blob URLs; hidden
pages pause playback. Reduced-motion preference changes pause playback; playback
starts only after an explicit user action.

Revision verification:

- `npm run doctor`, `npm run format:check`, `npm run check:boundaries` and
  `git diff --check`: passed.
- `npm test` on Node 24.21.0: 5,115 passed, zero failed, one existing skip,
  including both serialized allocation suites.
- Production Node 26.9.0 focused Aurora/animation/player/profile tests:
  48 passed, zero failed.
- `npm run build` on Node 26.9.0: passed; existing large-chunk advisory.
- `npm run test:track -- --url http://localhost:4174 --offline-imagery`:
  109 passed, zero failed/skipped on the explicit keyless review server.
- Enhanced real-NOAA `scripts/qa-aurora.mjs` on the explicit keyless review
  server, Metal renderer and Esri fallback: passed. Confirms visible readout,
  a real map-center cell value, changing genuine frame timestamps, pause,
  north/south JPEGs, 24-hour timeline, blob release on close, six toggle cycles
  restoring scene/listener counts, no browser-to-NOAA requests, no unhandled or
  Aurora shader errors, and an idle render governor with no holds.

Revision screenshots are in `qa-shots/aurora/standalone-live/`:
`arctic-aurora-standalone.png`, `aurora-visible-readout.png`,
`noaa-north-latest.png`, `noaa-north-playback.png`, `noaa-south-latest.png`.
The run's `report.json` records timestamps, the inspected original cell and
resource counters. Photorealistic map credentials remain unavailable; this run
establishes Esri fallback acceptance, not Google photoreal acceptance.

## API and data semantics

`GET /api/aurora` is registered through the existing local provider assembly
for development, preview and the standalone server. Methods other than GET,
unknown paths and all query parameters are rejected before upstream acquisition.
For this latest-grid endpoint, only the three fixed official NOAA endpoints in
DATA_SOURCES.md can be fetched. Image history uses its separate bounded provider.

The internal schema has `schemaVersion: 1`, `provider: "NOAA SWPC"`,
`product: "OVATION"`, `metric: "relative-intensity"`, `range: [0,100]`,
`cells: [[longitude,latitude,value],...]`, canonical UTC `sourceTime` and
`forecastTime`, acquisition `fetchedAt` in epoch milliseconds, and explicit
`stale`, `delayed`, `unavailable` and `reason`. Longitude is normalized to
−180…179 degrees. Supplemental `kp` and `geomagnetic` objects each carry their
own acquisition/freshness/availability state and nullable current/active record.
Kp intervals preserve their source kind and validity; upcoming predicted values
are labelled explicitly. G-level notices have explicit source validity bounds.

[NOAA's product documentation](https://www.swpc.noaa.gov/products/aurora-30-minute-forecast)
describes short-term auroral location/intensity and an empirical conversion to
viewing probability. The current JSON is `[Longitude, Latitude, Aurora]` with
integer 0–100 values and one-degree samples in both hemispheres. Values are
preserved; the conservative UI label is **OVATION relative intensity (0–100)**,
not an energy measurement or a calibrated local percentage accounting for
clouds/daylight/viewing conditions. The [NOAA-hosted supporting research](https://repository.library.noaa.gov/view/noaa/15196/noaa_15196_DS1.pdf)
explains the empirical viewing-probability conversion and its limits. Kp is a
planetary 0–9 index, not local auroral probability. Display-shell height is
80 km solely for map visibility, not a prediction of auroral altitude.

The shared OVATION cache refreshes after two minutes and expires at 60 minutes
from both forecast time and acquisition. Supplemental TTL is five minutes with
30-minute fallback. Failed requests have 30-second backoff. Forecasts over five
minutes behind are explicitly stale/delayed. NOAA's normal 30–90 minute lead
between L1 observations and forecast time is not itself a delay or outage.
No values are fabricated during outages.

## Files changed

- Provider: `server/providers/aurora.js`, `server/providers/local.js`.
- Portable source, lifecycle and renderer: `src/layers/aurora/source.js`,
  `src/layers/aurora/index.js`, `src/layers/aurora/rendering.js`.
- Assembly and durable enabled state: `src/standalone/layerSources.js`,
  `src/app/constructCatalog.js`, `src/data/layerState.js`.
- UI and Arctic policy: `src/ui/layerPanel.js`, `src/ui/styles/layers.css`,
  `src/norsaga/profile.js`.
- Credits/docs: `src/data/dataCredits.js`, `DATA_SOURCES.md`, `CHANGELOG.md`,
  `docs/CURRENT-STATE.md`, this report.
- Tests: `src/data/auroraProxy.test.mjs`, `src/layers/aurora/aurora.test.mjs`,
  `src/app/constructCatalog.test.mjs`, `src/data/layerState.test.mjs`,
  `src/norsaga/profile.test.mjs`.
- QA/boundaries/formatting: `scripts/qa-aurora.mjs`,
  `scripts/qa-norsaga-access.mjs`, `scripts/track-regression.mjs`,
  `scripts/check-import-directions.mjs`, `scripts/package-boundaries.json`,
  `scripts/format-scope.json`.

The existing password gate is classified as an application entry point by the
boundary checker. Tracking QA enters that gate after navigation/reload through
its normal form, and redacts provider query credentials in diagnostics.
No access-gate runtime behavior changes. Package boundaries include the new
layer's transitive modules. Installed dependency drift was resolved with
`npm ci`; package.json and package-lock.json are unchanged.

## Initial-release automated results

- `npm run doctor`: passed.
- `npm run format:check`: passed (1,100 scoped source files).
- `npm run check:boundaries`: passed.
- `npm test`: 5,105 passed, zero failed, one existing skip across the main
  suite and both serialized allocation suites, under Node 24.21.0.
- `npm run build`: passed; existing large-chunk advisory.
- Focused Aurora provider/source/layer plus opt-in mission policy: 38 passed.
- `npm run test:track`: 106 passed, three failed console-cleanliness checks
  caused by existing Google 403 / Cesium ion 401 responses.
- `npm run test:track -- --url http://localhost:4174 --offline-imagery`:
  109 passed, zero failed/skipped on an explicitly keyless dev server with
  bundled imagery; all tracking behaviors and console checks pass.
- `git diff --check`: passed.

Aurora tests cover parsing/ranges/timestamps,
malformed and oversized responses, timeouts and independent subscriber aborts,
cache/stale/expiry behavior, Kp and active/cancelled geomagnetic notices,
empty/zero cells, both hemispheres, lifecycle races, hidden tabs, presentation,
renderer ownership and cleanup.

## Initial-release local acceptance and evidence

`node scripts/qa-aurora.mjs --url http://localhost:4180 --allow-map-fallback`
checks the built production app with live NOAA and **Aurora as the only enabled
data layer**, on the
standard keyless Esri globe. It selects the Arctic region, enables the real
Data Layers toggle, confirms both hemispheres, captures the Norwegian Sea view
and source row, checks six disable/re-enable cycles and verifies that the
render governor is idle with no continuous-render holds. Disabled Aurora owns
zero primitives, zero canvas bytes, no pending request and no private timer.
The live standalone run displayed 12,608 cells across both hemispheres
(5,310 northern, 7,298 southern). Post-GC heap ended at 26.15 MiB after the
six toggles, versus a 25.56 MiB disabled baseline.

The browser contacts only `/api/aurora`, never NOAA directly. No Aurora/Cesium
shader or unhandled application errors are accepted. `--fixtures` is explicitly
synthetic data, and `--combined` optionally tests AIS/weather alongside Aurora.
The combination is not required for the agreed standalone first release.

Current standalone evidence (ignored local QA outputs):

- `qa-shots/aurora/standalone-live/report.json`
- `qa-shots/aurora/standalone-live/arctic-aurora-standalone.png`
- `qa-shots/aurora/standalone-live/norwegian-sea-aurora.png`
- `qa-shots/aurora/standalone-live/aurora-row-source-status.png`

The earlier optional combined run remains in `qa-shots/aurora/live/`:
65,160 NOAA samples; 12,455 displayed cells (5,256 northern, 7,199 southern);
2,921 live AIS vessels in the Norwegian Sea capture. Its six toggle cycles
restored scene resources/listeners, with post-GC heap ending at 70.20 MiB versus
69.81 MiB baseline. That run used Esri fallback, not photorealistic imagery.

## Remaining verification limits

Live photorealistic acceptance is **not established**: the existing Google key
returns HTTP 403 and Cesium ion returns HTTP 401. The application's normal
fallback selects Esri imagery. The QA report explicitly records
`photorealVerified: false`; `--allow-map-fallback` permits the remaining runtime
checks without representing them as photoreal proof. The keyless map supports the agreed standalone first release. Re-run the strict
QA command with valid existing map configuration to establish photoreal support.
The default tracking run has three console-cleanliness failures from those map
responses; its 106 functional checks pass. The supported keyless/offline-imagery
tracking run passes all 109 checks. It does not establish photoreal acceptance.
The standalone run also records existing HUD AI-summary HTTP 401 responses;
these are independent of NOAA acquisition and Aurora rendering.

This is environmental context, not navigation, voyage-planning or safety data.
## Deployment preparation

The user authorized deployment to the existing `godseye.norsaga.com` Plesk target.
The release is built using the documented Node 26.9.0 runtime, and all 25 Aurora
provider/source/layer tests pass on that runtime. The local production server
returns a healthy Node 26.9.0 `/healthz`, serves the application, and returns live
NOAA OVATION data through `/api/aurora` (65,160 cells, internal schema version 1).
The built browser app passed the live standalone Aurora gate, including both
hemispheres, six toggle cycles, no direct NOAA browser requests, no Aurora shader
or unhandled application errors, and idle rendering with no holds.
Client-supplied upstream queries return 400; local key-setup and unknown API paths
return 404. None of the six configured server-only credential values appear in
`dist/`; only the existing intentional browser map configuration is embedded.

The user is performing the Plesk deployment. The tested implementation is
prepared on `norsaga-maritime-v1` for Git deployment, with a verified prebuilt
archive also available in ignored `output/`. Preserve the current application
as a rollback copy and retain its server `.env` and Plesk environment settings.
Install runtime dependencies with `npm ci --omit=dev`, build with the existing
browser map configuration if using Git, then restart the Node.js application.
Verify `/healthz`, `/api/aurora` and the optional Aurora Forecast toggle after
restart. No merge or remote Plesk application changes were performed by this task.
