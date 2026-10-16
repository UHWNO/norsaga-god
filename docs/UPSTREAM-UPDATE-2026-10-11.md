# NorSaga upstream update — 11 October 2026

Integrated God's Eye View upstream `main` at
`591f299d11f38a612629a274463196d57ae3862e` into `norsaga-maritime-v1`.
The previous upstream baseline was `ce671ce500a393be27e3cbb2a08799fbca9b6e28`;
the NorSaga branch started this update at `414fd0b`.
Upstream identifies this release as 0.2.1. The integration retains both histories
so the next update can compare against this exact upstream revision.

## New capabilities

- **Street Level imagery:** optional Mapillary coverage and photo viewing,
  sequences, capture-date and panorama filters, expandable views, camera follow,
  and provider selections preserved in shared links and stored settings.
  Mapillary requires a configured client token. Photos are dated imagery, not
  live camera feeds. The layer starts off.
- **Norwegian road cameras:** Statens vegvesen sources in CCTV, including
  still images and live HLS where the agency provides it, with NLOD attribution.
- **Voice tools:** upstream's common tool catalog, point-and-ask support,
  stronger place and administrative-boundary resolution, and analyst follow-ups
  that retain their scope, ranking and feed caveats. Cancelled or failed actions
  settle correctly. NorSaga Aurora is registered in the new voice manifest with
  explicit forecast-overlay semantics and no invented countable records.
- **Globe panels and MCP:** the upstream tool interfaces and separate panel
  build are available for configured integrations. New panel titles and notices
  use NorSaga branding. Package and protocol identifiers remain compatible.
  The existing hosted production server does not automatically expose an MCP
  server or relax its framing policy.
- **Maps and geographic context:** alternative Google 3D token acquisition,
  keyless vector-tile geometry for supported OSM layers, more reliable military
  installation names and administrative outlines, and corrected bundled asset
  URLs. Explicitly unavailable sources are reported without blocking startup.
- **Tracking and layout:** fixes for initial aircraft positions and ground
  clearance, heading confidence, camera arrival ownership, iPad/Metal atmosphere
  compatibility, and floating/resizable panels. The right rail incorporates the
  upstream transition fix while retaining NorSaga's workspace anchor.
- **Provider reliability:** bounded terrain caches and track responses,
  better camera-media deadlines, source configuration and attribution, and
  healthy-empty vessel snapshot handling.
- **Request hardening:** upstream's same-site, host, local-provider and embedded
  panel protections. Experimental ChatGPT voice sign-in remains an optional
  local provider-setting capability; no account was signed in during this work.

## NorSaga features preserved

- Logo, palette, loading screen, global initial view, welcome dialog, four
  maritime launch choices and all twelve operating areas, including custom POIs.
- Password gate, inactivity logout, viewport guidance, logout button and guide.
- AISStream and BarentsWatch combination, wrapped viewport prioritisation,
  historical vessel tracks and Global Fishing Watch research cards.
- NOAA Aurora Forecast, independent toggle, source/Kp readout, contrast,
  map-centre inspection and official north/south image-history playback.
- Global Flights Radar Shot 1 repair and the restored Nepal incident shots.
- Maritime panel placement, factual HUD summaries and green style indicator.
- Previously removed fictional HUD/classification/sensor/recording readouts,
  NVG timestamps and fake thermal temperature/frame counters remain removed.
- Provider credential controls remain hidden in the hosted production app.
  The existing production entrypoint and Plesk deployment settings remain.

A byte comparison verified that all 31 selected NorSaga-owned source files,
including the password gate, branding templates, HUD, shaders and Aurora
implementation, retained their pre-update contents. Shared modules were adapted
where the upstream interfaces changed, with regression tests retained.

## Integration details

- Both viewport bounds and upstream area hints reach vessel acquisition.
- The new `/api/vessels` route retains the combined NorSaga providers and reports
  the actual source. `/api/ais-live` remains a compatibility alias, including
  track and GFW research subroutes.
- Aurora's existing share token `3` is permanently reserved in the new upstream
  allocation ledger. Existing NorSaga links retain their meaning; Street Level
  uses upstream's distinct token `0`.
- Aurora participates in the new optional-source availability contract and
  generated voice-layer enums. Fixed upstream token-allocation fixtures keep
  their original baseline while production tests check the NorSaga reservation.
- Browser harnesses enter the existing password form and close NorSaga's own
  welcome dialog. The Aurora fixture now covers its inspection location.
- The in-app guide includes Street Level, Norwegian cameras and Aurora usage.

## Verification

- Node 24.21.0: **6,339 tests passed**, including all 14 allocation tests.
  One native Windows DACL test was skipped on macOS; no tests failed.
- Setup doctor, formatting, import/package boundaries and share-token allocation
  checks passed.
- Main production build and separate globe-panel build passed.
- Node 26.9.0 production-entrypoint smoke check passed: `/healthz`, application
  shell and user guide return 200; hosted credential setup and unknown APIs
  return 404.
- Real-browser application QA passed: startup, all twelve operating-area
  choices, NorSaga controls, access-gate handoff, guide/logout controls,
  layer registration, annotations, visible credits and terminal teardown.
- CCTV panel browser QA passed: all eight resize handles, minimum sizes,
  position/size restoration, collapsed dragging and docking, with no page or
  render-loop errors.
- Aurora fixture QA passed: both hemispheres, workspace readout, centre
  inspection, repeated enable/disable, idle rendering and resource ownership.
- Street Level production-bundle fixture QA passed: 28 checks, with two
  documented Google-3D-only checks skipped. Coverage, filters, image selection,
  sequences, photo rendering, fullscreen, drag/resize, docking, mobile layout,
  shared/restored UI state, and key rejection/missing-key states were exercised.
  One moving-header press required a successful retry.

Browser source/rendering tests use fixtures where stated. They do not establish
live Mapillary, BarentsWatch, GFW or agency-camera availability. The configured
Google/Cesium providers returned authorization failures during Aurora QA; its
runtime checks passed on the fallback map, with photorealistic verification
explicitly false. OpenAI HUD-summary requests also returned authorization
failures, so paid voice/AI service acceptance is unverified.

The dependency audit reports three advisories in the retained dependency set:
`dompurify` (low), `sharp` (high, development dependency) and `source-map-js`
(high). This update does not establish a clean dependency-security audit.

## Delivery

Delivery is a push of `norsaga-maritime-v1` to the existing NorSaga GitHub origin.
Plesk deployment and live-production acceptance remain unverified.
