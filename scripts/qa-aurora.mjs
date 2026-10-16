/**
 * NOAA Aurora local acceptance against a running dev server (default :4173).
 * Real NOAA with Aurora enabled alone by default. --combined opts into AIS/weather. --fixtures explicitly isolates renderer
 * and lifecycle checks with normalized test data; it is not live-source proof.
 * Captures Arctic Aurora screenshots, source status,
 * console/network diagnostics, repeated-toggle resource counts and heap usage.
 * Run: node scripts/qa-aurora.mjs [--combined] [--fixtures] [--headful] [--url URL]
 * --allow-map-fallback runs remaining checks when map credentials fail,
 * recording photorealVerified=false; it never establishes photoreal acceptance.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { unlockNorSaga } from './qa-norsaga-access.mjs';

const args = process.argv.slice(2);
const fixtures = args.includes('--fixtures');
const combined = args.includes('--combined');
const allowMapFallback = args.includes('--allow-map-fallback');
const base = args.includes('--url')
  ? args[args.indexOf('--url') + 1]
  : 'http://localhost:4173';
const out = path.resolve(
  'qa-shots/aurora',
  `${combined ? '' : 'standalone-'}${fixtures ? 'fixtures' : 'live'}`,
);
mkdirSync(out, { recursive: true });
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert.ok(existsSync(executablePath), 'Chrome must be installed');
const browser = await puppeteer.launch({
  executablePath,
  headless: !args.includes('--headful'),
  protocolTimeout: 120_000,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal']
      : ['--use-angle=swiftshader']),
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1600,1000',
  ],
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = {
  mode: fixtures ? 'fixtures' : 'live',
  presentation: combined ? 'combined' : 'standalone',
  renderer: process.platform === 'darwin' ? 'Metal' : 'SwiftShader',
  console: [],
  pageErrors: [],
  network: [],
  steps: [],
  passed: false,
  runtimePassed: false,
  photorealVerified: false,
  allowMapFallback,
  limitations: [],
};
const sanitize = (text) =>
  String(text).replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
    try {
      const value = new URL(url);
      return value.origin + value.pathname;
    } catch {
      return '[url]';
    }
  });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const cdp = await page.createCDPSession();
  await cdp.send('HeapProfiler.enable');
  page.on('console', (message) => {
    if (['error', 'warn'].includes(message.type()))
      report.console.push({
        type: message.type(),
        text: sanitize(message.text()),
      });
  });
  page.on('pageerror', (error) =>
    report.pageErrors.push(sanitize(error.message)),
  );
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith('/api/aurora') ||
      url.hostname.includes('swpc.noaa.gov')
    )
      report.network.push({ host: url.host, path: url.pathname });
  });
  if (fixtures) {
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      if (new URL(request.url()).pathname !== '/api/aurora')
        return request.continue();
      const now = Date.now(),
        cells = [];
      for (let lon = -180; lon < 180; lon++)
        for (const lat of [
          64, 65, 66, 67, 68, 69, 70, 71, -64, -65, -66, -67, -68, -69, -70,
          -71,
        ])
          cells.push([lon, lat, 50 + Math.round(25 * Math.sin(lon / 20))]);
      await request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 1,
          provider: 'NOAA SWPC',
          product: 'OVATION',
          metric: 'relative-intensity',
          range: [0, 100],
          sourceTime: new Date(now - 5 * 60_000).toISOString(),
          forecastTime: new Date(now + 30 * 60_000).toISOString(),
          fetchedAt: now,
          stale: false,
          delayed: false,
          unavailable: false,
          reason: null,
          cells,
          kp: {
            current: null,
            fetchedAt: now,
            stale: false,
            unavailable: true,
          },
          geomagnetic: {
            active: null,
            fetchedAt: now,
            stale: false,
            unavailable: false,
          },
        }),
      });
    });
  }
  await page.goto(`${base}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await unlockNorSaga(page);
  await page.waitForFunction(() => !!window.__godsEyeView?.dataManager, {
    timeout: 90_000,
  });
  await page
    .waitForFunction(
      () =>
        !document.getElementById('loading-screen') ||
        getComputedStyle(document.getElementById('loading-screen')).display ===
          'none' ||
        document.getElementById('loading-screen').classList.contains('hidden'),
      { timeout: 30_000 },
    )
    .catch(() => {});
  await sleep(3000);
  const capture = async (label, screenshot = false) => {
    const state = await page.evaluate(() => {
      const g = window.__godsEyeView,
        v = g.viewer,
        s = v.scene;
      const dm = g.dataManager;
      const aurora = dm.layers.get('aurora').module;
      return {
        map: g.mapStackController.getActiveId(),
        tileset: !!g.mapStackController.getImageryHostTileset?.(),
        tilesSettled: g.tileset?.tilesLoaded ?? null,
        aurora: aurora.getDiagnostics(),
        enabledLayers: [...dm.layers]
          .filter(([, entry]) => entry.enabled)
          .map(([id]) => id),
        row: aurora.getRowControls().info,
        ais: dm.layers.get('ais-live-vessels').module.getStats(),
        weather: dm.layers.get('weather-satellite').module.getStats(),
        resources: {
          primitives: s.primitives.length,
          ground: s.groundPrimitives.length,
          entities: v.entities.values.length,
          dataSources: v.dataSources.length,
          preRender: s.preRender.numberOfListeners,
          postRender: s.postRender.numberOfListeners,
          clock: v.clock.onTick.numberOfListeners,
        },
        governor: g.getRenderGovernorDiagnostics(),
      };
    });
    await cdp.send('HeapProfiler.collectGarbage');
    state.heap = (await page.metrics()).JSHeapUsedSize;
    report.steps.push({ label, ...state });
    console.log(`Aurora QA: ${label}`);
    if (screenshot)
      await page.screenshot({ path: path.join(out, `${label}.png`) });
    return state;
  };
  await page.evaluate(async () => {
    const dm = window.__godsEyeView.dataManager;
    for (const [id, entry] of dm.layers)
      if (entry.enabled) await dm.setEnabled(id, false, { origin: 'user' });
  });
  const initial = await capture('initial');
  assert.equal(initial.aurora.enabled, false);
  if (combined) {
    await page.evaluate(() =>
      document.getElementById('norsaga-launcher').showModal(),
    );
    await page.click('[data-norsaga-mission="arctic"]');
    await page
      .waitForFunction(
        () => !document.getElementById('norsaga-launcher').open,
        { timeout: 20_000 },
      )
      .catch(() => {});
  } else {
    await page.select('#norsaga-region', 'arctic');
  }
  await page.evaluate(() => {
    const dialog = document.getElementById('norsaga-launcher');
    if (dialog.open) dialog.close();
    document.querySelector('[data-layer-id="aurora"] .data-toggle-btn').click();
  });
  await page.waitForFunction(
    () => window.__godsEyeView.dataManager.isEnabled('aurora'),
    { timeout: 60_000 },
  );
  await sleep(15_000);
  await page.evaluate(() => window.__godsEyeView.requestRender('aurora-qa'));
  const arctic = await capture(
    combined ? 'arctic-ais-weather-aurora' : 'arctic-aurora-standalone',
    true,
  );
  assert.ok(arctic.aurora.count > 0, 'A real populated grid must be rendered');
  assert.ok(
    arctic.aurora.north > 0 && arctic.aurora.south > 0,
    'Both hemispheres must be retained',
  );
  assert.equal(arctic.aurora.primitiveCount, 1);
  assert.match(arctic.row, /NOAA SWPC · OVATION/);
  report.photorealVerified =
    arctic.map.includes('photoreal') || arctic.map.includes('google');
  if (!report.photorealVerified)
    report.limitations.push(
      'Configured Google/Cesium photorealistic providers unavailable; verified on the active fallback map.',
    );
  if (combined)
    assert.ok(
      ['ais-live-vessels', 'weather-satellite', 'aurora'].every((id) =>
        arctic.enabledLayers.includes(id),
      ),
    );
  else
    assert.deepEqual(
      arctic.enabledLayers,
      ['aurora'],
      'Aurora works with all other data layers off',
    );
  await page.evaluate(() => {
    const g = window.__godsEyeView;
    g.styleManager.orbitController.stop();
    const destination = g.viewer.scene.ellipsoid.cartographicToCartesian({
      longitude: (18 * Math.PI) / 180,
      latitude: (70 * Math.PI) / 180,
      height: 2_800_000,
    });
    g.viewer.camera.setView({
      destination,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    g.requestRender('aurora-qa-camera');
  });
  await sleep(10_000);
  await capture(
    combined ? 'norwegian-sea-combination' : 'norwegian-sea-aurora',
    true,
  );
  assert.equal(
    await page.$eval(
      '.norsaga-aurora-readout',
      (el) => !el.hidden && !!el.offsetHeight,
    ),
    true,
    'Forecast readout stays visible outside Data Layers',
  );
  await page.locator('[data-aurora-action="inspect"]').click();
  const reading = await page.$eval(
    '.norsaga-aurora-reading',
    (el) => el.textContent,
  );
  assert.match(reading, /\d+ \/ 100.*nearest 1° cell/);
  report.locationReading = reading;
  await capture('aurora-visible-readout', true);
  if (!fixtures) {
    await page.locator('[data-aurora-action="history"]').click();
    await page.waitForFunction(
      () => {
        const image = document.querySelector('.norsaga-aurora-dialog img');
        return (
          image && !image.hidden && image.complete && image.naturalWidth > 0
        );
      },
      { timeout: 60_000 },
    );
    console.log('Aurora QA: NOAA north loaded');
    const latestTime = await page.$eval(
      '.norsaga-aurora-frame-time',
      (el) => el.textContent,
    );
    await page.screenshot({ path: path.join(out, 'noaa-north-latest.png') });
    await page.locator('[data-aurora-action="play"]').click();
    await page.waitForFunction(
      (previous) =>
        document.querySelector('.norsaga-aurora-frame-time').textContent !==
        previous,
      { timeout: 30_000 },
      latestTime,
    );
    await sleep(2500);
    await page.locator('[data-aurora-action="play"]').click();
    console.log('Aurora QA: NOAA playback paused');
    const paused = await page.$eval(
      '.norsaga-aurora-frame-time',
      (el) => el.textContent,
    );
    await sleep(1200);
    assert.equal(
      await page.$eval('.norsaga-aurora-frame-time', (el) => el.textContent),
      paused,
    );
    await page.screenshot({ path: path.join(out, 'noaa-north-playback.png') });
    await page.select('[aria-label="Aurora history duration"]', '1440');
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector('[aria-label="NOAA image history timeline"]')
            .max,
        ) > 200,
      { timeout: 30_000 },
    );
    await page.select('[aria-label="Aurora hemisphere"]', 'south');
    await page.waitForFunction(
      () => {
        const image = document.querySelector('.norsaga-aurora-dialog img');
        return (
          !image.hidden &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.alt.includes('south')
        );
      },
      { timeout: 60_000 },
    );
    await page.screenshot({ path: path.join(out, 'noaa-south-latest.png') });
    console.log('Aurora QA: NOAA south loaded');
    report.playback = {
      verified: true,
      latestTime,
      paused,
      northAndSouth: true,
      full24Hours: true,
    };
    await page
      .locator('.norsaga-aurora-dialog .norsaga-dialog-header button')
      .click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector('.norsaga-aurora-dialog img')
          .hasAttribute('src'),
      { timeout: 2000 },
    );
  }
  await page.click('[data-collapse-target="data-panel"]');
  await page.evaluate(() =>
    document
      .querySelector('[data-layer-id="aurora"]')
      .scrollIntoView({ block: 'center' }),
  );
  await sleep(500);
  await capture('aurora-row-source-status', true);
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('aurora', false, {
      origin: 'user',
    }),
  );
  await sleep(1000);
  const baseline = await capture('disabled-baseline');
  for (let i = 0; i < 6; i++) {
    await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled('aurora', true, { origin: 'user' });
      await dm.refreshLayer('aurora');
      await dm.setEnabled('aurora', false, { origin: 'user' });
    });
    await sleep(100);
    const state = await capture(`toggle-${i + 1}`);
    assert.equal(state.aurora.primitiveCount, 0);
    assert.equal(state.aurora.canvasBytes, 0);
    assert.equal(state.aurora.requestPending, false);
    assert.deepEqual(
      state.resources,
      baseline.resources,
      'Disabling must restore scene resources/listeners',
    );
  }
  await page.evaluate(async () => {
    const g = window.__godsEyeView;
    g.styleManager.orbitController.stop();
    for (const [id, entry] of g.dataManager.layers)
      if (entry.enabled)
        await g.dataManager.setEnabled(id, false, { origin: 'user' });
    await g.dataManager.setEnabled('aurora', true, { origin: 'user' });
    await g.dataManager.refreshLayer('aurora');
  });
  await sleep(1500);
  const idle = await capture('aurora-only-idle');
  assert.equal(idle.aurora.primitiveCount, 1);
  assert.equal(
    idle.governor.mode,
    'idle',
    'Static Aurora must let the render governor become idle',
  );
  assert.deepEqual(
    idle.governor.holds,
    [],
    'Aurora must not hold continuous rendering',
  );
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('aurora', false, {
      origin: 'user',
    }),
  );
  assert.ok(
    !report.network.some((entry) => entry.host.includes('swpc.noaa.gov')),
    'Browser must not contact NOAA directly',
  );
  assert.deepEqual(report.pageErrors, [], 'No unhandled application errors');
  assert.ok(
    !report.console.some((entry) =>
      /AuroraForecast|aurora.*(?:error|shader)|shader.*aurora|DeveloperError/i.test(
        entry.text,
      ),
    ),
    'No aurora or Cesium shader errors',
  );
  report.runtimePassed = true;
  report.passed = report.photorealVerified || allowMapFallback;
  if (!report.passed)
    throw new Error(
      'Runtime checks passed, but live photorealistic verification requires working map credentials',
    );
} catch (error) {
  report.failure = sanitize(error.stack || error.message);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      mode: report.mode,
      report: path.join(out, 'report.json'),
      failure: report.failure,
    },
    null,
    2,
  ),
);
