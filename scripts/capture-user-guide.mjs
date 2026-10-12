/** Capture the shipped UI in an isolated browser for the beginner user guide.
 * Run against a local dev server: node scripts/capture-user-guide.mjs
 * Screenshots use real provider responses; no simulated records are injected.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { unlockNorSaga } from './qa-norsaga-access.mjs';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const out = path.resolve('public/user-guide/screenshots');
await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [
    '--no-sandbox',
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal']
      : ['--use-angle=swiftshader']),
  ],
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const manifest = {
  capturedOn: new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
  source: 'Local current checkout; real provider responses',
  viewport: { width: 1600, height: 1000 },
  screenshots: [],
};
try {
  const page = await browser.newPage();
  await page.setViewport(manifest.viewport);
  await page.goto(`${base}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await unlockNorSaga(page);
  await page.waitForSelector('#norsaga-operations', { timeout: 90000 });
  await page.waitForFunction(
    () =>
      !document.getElementById('loading-screen') ||
      getComputedStyle(document.getElementById('loading-screen')).opacity ===
        '0' ||
      getComputedStyle(document.getElementById('loading-screen')).display ===
        'none',
    { timeout: 30000 },
  );
  await pause(4000);
  async function shot(name, targets = []) {
    await pause(700);
    await page.evaluate((selectors) => {
      const overlay = document.createElement('div');
      overlay.id = 'guide-callouts';
      overlay.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      selectors.forEach((selector, index) => {
        const target = document.querySelector(selector);
        if (!target) throw new Error(`Screenshot target missing: ${selector}`);
        const r = target.getBoundingClientRect();
        if (!r.width || !r.height)
          throw new Error(`Screenshot target hidden: ${selector}`);
        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;border:2px solid #ffd65a;border-radius:8px`;
        const label = document.createElement('b');
        label.textContent = index + 1;
        label.style.cssText =
          'position:absolute;top:0;right:0;transform:translate(35%,-35%);width:28px;height:28px;border-radius:50%;background:#ffd65a;color:#07111f;font:700 17px/28px Arial;text-align:center;box-shadow:0 2px 8px #000';
        box.append(label);
        overlay.append(box);
      });
      // A modal dialog is in the browser's top layer, above body z-indexes.
      (document.querySelector('dialog[open]') || document.body).append(overlay);
    }, targets);
    let clip;
    if (
      !['01-workspace', '04-location', '19-vessel-inspection'].includes(name)
    ) {
      clip = await page.evaluate((selectors) => {
        const rects = selectors.map((selector) =>
          document.querySelector(selector).getBoundingClientRect(),
        );
        const modal = document.querySelector('dialog[open]');
        if (modal) rects.push(modal.getBoundingClientRect());
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        const top = Math.min(...rects.map((r) => r.top));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        const width = Math.min(
          innerWidth,
          Math.max(500, Math.ceil(right - left + 70)),
        );
        const height = Math.min(
          innerHeight,
          Math.max(350, Math.ceil(bottom - top + 100)),
        );
        return {
          x: Math.round(
            Math.max(
              0,
              Math.min(innerWidth - width, (left + right - width) / 2),
            ),
          ),
          y: Math.round(
            Math.max(
              0,
              Math.min(innerHeight - height, (top + bottom - height) / 2),
            ),
          ),
          width,
          height,
        };
      }, targets);
    }
    await page.screenshot({
      path: path.join(out, `${name}.webp`),
      type: 'webp',
      quality: 90,
      ...(clip ? { clip } : {}),
    });
    await page.evaluate(() =>
      document.getElementById('guide-callouts')?.remove(),
    );
    manifest.screenshots = manifest.screenshots.filter(
      (item) => item.file !== `${name}.webp`,
    );
    manifest.screenshots.push({
      file: `${name}.webp`,
      numberedTargets: targets,
      pixels: {
        width: clip?.width || manifest.viewport.width,
        height: clip?.height || manifest.viewport.height,
      },
    });
    console.log(`Captured ${name}`);
  }
  async function panel(id, open = true) {
    const collapsed = await page.$eval(`#${id}`, (e) =>
      e.classList.contains('collapsed'),
    );
    if (collapsed === open) await page.click(`[data-collapse-target="${id}"]`);
    await pause(350);
  }
  const vesselsOnly = process.argv.includes('--vessels-only');
  const dialogsOnly = process.argv.includes('--dialogs-only');
  const scenesOnly = process.argv.includes('--scenes-only');
  const toolsOnly = process.argv.includes('--tools-only');
  if (toolsOnly) {
    const previous = JSON.parse(
      await fs.readFile(path.join(out, 'manifest.json'), 'utf8'),
    );
    manifest.screenshots = previous.screenshots;
    await panel('data-panel');
    await page.$eval('[data-layer-id="cctv"] .data-toggle-btn', (e) =>
      e.click(),
    );
    await page.waitForFunction(
      () =>
        window.__godsEyeView.dataManager.layers.get('cctv').enabled === true,
    );
    await panel('data-panel', false);
    await panel('cctv-panel');
    await page.waitForFunction(
      () => document.getElementById('cctv-camera-select').options.length > 0,
      { timeout: 60000 },
    );
    await page.click('#cctv-nearest-btn');
    await page.waitForFunction(
      () => {
        const image = document.getElementById('cctv-frame');
        return image.complete && image.naturalWidth > 0;
      },
      { timeout: 60000 },
    );
    console.log(
      'Selected camera:',
      await page.$eval('#cctv-meta', (e) => e.innerText),
    );
    await shot('16-cctv-enabled', [
      '#cctv-frame-wrap',
      '#cctv-source-badge',
      '#cctv-camera-select',
      '#cctv-focus-btn',
    ]);
    await panel('cctv-panel', false);
    await panel('data-panel');
    await page.$eval('[data-layer-id="recent-imagery"] .data-toggle-btn', (e) =>
      e.click(),
    );
    await page.waitForFunction(
      () =>
        window.__godsEyeView.dataManager.layers.get('recent-imagery')
          .enabled === true,
    );
    await panel('data-panel', false);
    await page.waitForSelector('#recent-imagery-panel', { visible: true });
    await shot('18-recent-imagery', ['#recent-imagery-panel']);
  }
  if (scenesOnly || (!vesselsOnly && !dialogsOnly && !toolsOnly)) {
    if (scenesOnly) {
      const previous = JSON.parse(
        await fs.readFile(path.join(out, 'manifest.json'), 'utf8'),
      );
      manifest.screenshots = previous.screenshots.filter(
        (item) =>
          ![
            '08-scenes.webp',
            '20-share-scene.webp',
            '21-import-review.webp',
            '22-scene-details.webp',
          ].includes(item.file),
      );
    }
    await page.select('#norsaga-region', 'norwegian-sea');
    await pause(2500);
    await panel('scene-panel');
    page.once('dialog', (dialog) => dialog.accept('My Norwegian Sea view'));
    await page.click('#scene-new-btn');
    await page.click('#scene-capture-btn');
    await page.waitForFunction(() =>
      document
        .getElementById('scene-status')
        .textContent.startsWith('Captured:'),
    );
    await shot('08-scenes', [
      '#scene-new-btn',
      '#scene-capture-btn',
      '#scene-shot-list',
      '#scene-export-btn',
    ]);
    await page.click('[data-director-authoring] button:nth-child(2)');
    await shot('20-share-scene', ['.director-sharing-dialog']);
    await page.keyboard.press('Escape');
    await page.click('[data-director-authoring] button:first-child');
    await shot('22-scene-details', ['.director-sharing-dialog']);
    await page.keyboard.press('Escape');
    const downloads = await fs.mkdtemp('/tmp/norsaga-guide-export-');
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
    });
    await page.click('#scene-export-btn');
    let exported;
    for (let tries = 0; tries < 30; tries++) {
      exported = (await fs.readdir(downloads)).find((file) =>
        file.endsWith('.json'),
      );
      if (exported) break;
      await pause(250);
    }
    if (!exported) throw new Error('Preset export did not produce a file');
    const input = await page.$('#scene-import-file');
    await input.uploadFile(path.join(downloads, exported));
    await page.waitForSelector('[data-director-apply-import]');
    await shot('21-import-review', ['.director-sharing-dialog']);
    await page.keyboard.press('Escape');
    await fs.rm(downloads, { recursive: true });
    await panel('scene-panel', false);
  }
  if (dialogsOnly) {
    const previous = JSON.parse(
      await fs.readFile(path.join(out, 'manifest.json'), 'utf8'),
    );
    manifest.screenshots = previous.screenshots.filter(
      (item) =>
        !['02-starting-views.webp', '07-aurora-history.webp'].includes(
          item.file,
        ),
    );
    await page.click('.norsaga-toolbar-head button');
    await shot('02-starting-views', ['.norsaga-missions', '.norsaga-suppress']);
    await page.click('#norsaga-launcher .norsaga-text-button');
    await page.select('#norsaga-region', 'arctic');
    await page.click('[data-norsaga-layer="aurora"]');
    await pause(12000);
    await page.click('[data-aurora-action="history"]');
    await pause(12000);
    await shot('07-aurora-history', [
      '.norsaga-aurora-dialog [aria-label="Aurora hemisphere"]',
      '.norsaga-aurora-dialog [aria-label="Aurora history duration"]',
      '.norsaga-aurora-dialog [data-aurora-action="play"]',
      '.norsaga-aurora-dialog [aria-label="NOAA image history timeline"]',
      '.norsaga-aurora-frame-time',
    ]);
  }
  if (!vesselsOnly && !dialogsOnly && !scenesOnly && !toolsOnly) {
    await shot('01-workspace', [
      '#norsaga-operations',
      '#data-panel',
      '#scene-panel',
      '#right-context-rail',
      '#command-dock',
      '#top-center-actions',
    ]);
    await page.click('.norsaga-toolbar-head button');
    await shot('02-starting-views', ['.norsaga-missions', '.norsaga-suppress']);
    await page.click('#norsaga-launcher .norsaga-text-button');
    await page.select('#norsaga-region', 'norwegian-sea');
    await pause(2200);
    await page.click('.norsaga-layers summary');
    await shot('03-maritime', [
      '#norsaga-region',
      '.norsaga-layer-list',
      '.norsaga-aurora',
    ]);
    await page.click('.norsaga-layers summary');
    await page.click('#location-bar-toggle');
    await page.click('#search-toggle');
    await page.type('#location-search', 'Oslo, Norway');
    await shot('04-location', [
      '#location-search',
      '#location-pills',
      '#north-up-view',
      '#reset-globe-view',
    ]);
    await page.click('#location-bar-toggle');
    await panel('data-panel');
    await shot('05-data-layers', ['#data-toggles', '#clear-selected-layers']);
    console.log(
      'Layer names:',
      await page.$eval('#data-toggles', (e) => e.innerText),
    );
    await panel('data-panel', false);
    await page.select('#norsaga-region', 'arctic');
    await pause(2300);
    await page.click('[data-norsaga-layer="aurora"]');
    await pause(12000);
    await page.click('[data-aurora-action="inspect"]');
    await shot('06-aurora', [
      '.norsaga-aurora-readout',
      '[data-aurora-action="inspect"]',
      '[data-aurora-action="history"]',
    ]);
    await page.click('[data-aurora-action="history"]');
    await pause(12000);
    await shot('07-aurora-history', [
      '.norsaga-aurora-dialog [aria-label="Aurora hemisphere"]',
      '.norsaga-aurora-dialog [aria-label="Aurora history duration"]',
      '.norsaga-aurora-dialog [data-aurora-action="play"]',
      '.norsaga-aurora-dialog [aria-label="NOAA image history timeline"]',
      '.norsaga-aurora-frame-time',
    ]);
    console.log(
      'Aurora history:',
      await page.$eval('.norsaga-aurora-dialog', (e) => e.innerText),
    );
    await page.click('.norsaga-aurora-dialog .norsaga-dialog-header button');
    await page.click('[data-norsaga-layer="aurora"]');
    await page.select('#norsaga-region', 'norwegian-sea');
    await pause(2200);
    await panel('scene-panel');
    page.once('dialog', (dialog) => dialog.accept('My Norwegian Sea view'));
    await page.click('#scene-new-btn');
    await page.click('#scene-capture-btn');
    await shot('08-scenes', [
      '#scene-new-btn',
      '#scene-capture-btn',
      '#scene-shot-list',
      '#scene-export-btn',
    ]);
    await panel('scene-panel', false);
    await shot('09-sharing', [
      '#share-btn',
      '#north-up-view',
      '#tilt-map-view',
    ]);
    await page.click('#control-panel-toggle');
    await shot('10-map-and-style', [
      '#style-buttons',
      '#map-stack-chips',
      '[data-pin-target="control-panel"]',
    ]);
    await page.click('#control-panel-toggle');
    await panel('pp-toggles');
    await shot('11-display', [
      '#hud-toggle',
      '#detection-toggle',
      '#scope-toggle',
      '#draw-toggle',
    ]);
    await panel('pp-toggles', false);
    await panel('cctv-panel');
    await shot('12-cctv', [
      '#cctv-enable-btn',
      '#cctv-nearest-btn',
      '#cctv-camera-select',
      '#cctv-focus-btn',
    ]);
    await panel('cctv-panel', false);
    await panel('global-context-panel');
    await shot('14-context', [
      '#global-context-flights-btn',
      '#global-context-missions-btn',
      '#context-radio-toggle-btn',
    ]);
    await panel('global-context-panel', false);
    await shot('15-ai-agent', [
      '#gev-voice-button',
      '#gev-voice-status',
      '#gev-voice-tier',
      '#gev-voice-cost-value',
    ]);
    await page.click('#location-bar-toggle');
    await page.click('#search-toggle');
    await page.$eval('#location-search', (e) => {
      e.value = '';
    });
    await page.type('#location-search', '59.9139, 10.7522');
    await page.keyboard.press('Enter');
    await pause(3000);
    await page.click('#location-bar-toggle');
    await panel('cctv-panel');
    await page.$eval('#cctv-enable-btn', (e) => e.click());
    await page.waitForFunction(
      () =>
        window.__godsEyeView.dataManager.layers.get('cctv').enabled === true,
    );
    await page.waitForFunction(
      () => document.getElementById('cctv-camera-select').options.length > 0,
      { timeout: 60000 },
    );
    await page.click('#cctv-nearest-btn');
    await page.waitForFunction(
      () => {
        const image = document.getElementById('cctv-frame');
        return image.complete && image.naturalWidth > 0;
      },
      { timeout: 60000 },
    );
    console.log(
      'CCTV state:',
      await page.$eval('#cctv-meta', (e) => e.innerText),
    );
    await shot('16-cctv-enabled', [
      '#cctv-frame-wrap',
      '#cctv-source-badge',
      '#cctv-camera-select',
      '#cctv-focus-btn',
    ]);
    await panel('cctv-panel', false);
    await panel('street-level-panel');
    await page.click('#sl-status');
    await pause(5000);
    console.log(
      'Street Level state:',
      await page.$eval('#sl-body', (e) => e.innerText),
    );
    await shot('17-street-level-enabled', [
      '#sl-provider-chips',
      '#sl-controls',
    ]);
    await panel('street-level-panel', false);
    await panel('data-panel');
    await page.$eval('[data-layer-id="recent-imagery"] .data-toggle-btn', (e) =>
      e.click(),
    );
    await page.waitForFunction(
      () =>
        window.__godsEyeView.dataManager.layers.get('recent-imagery')
          .enabled === true,
    );
    await panel('data-panel', false);
    await page.waitForSelector('#recent-imagery-panel', { visible: true });
    await shot('18-recent-imagery', ['#recent-imagery-panel']);
  }
  if (vesselsOnly) {
    const previous = JSON.parse(
      await fs.readFile(path.join(out, 'manifest.json'), 'utf8'),
    );
    manifest.screenshots = previous.screenshots.filter(
      (item) => item.file !== '19-vessel-inspection.webp',
    );
  }
  if (!dialogsOnly && !scenesOnly && !toolsOnly) {
    await panel('data-panel');
    await page.click('[data-layer-id="ais-live-vessels"] .data-toggle-btn');
    await panel('data-panel', false);
    await page.waitForFunction(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('ais-live-vessels')
          .module.getAllPositions()
          .some(
            (record) =>
              record.latitude > 50 &&
              record.latitude < 72 &&
              record.longitude > -5 &&
              record.longitude < 25 &&
              !record.label.startsWith('MMSI'),
          ),
      { timeout: 60000 },
    );
    const vessel = await page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('ais-live-vessels')
          .module.getAllPositions()
          .filter(
            (record) =>
              record.latitude > 50 &&
              record.latitude < 72 &&
              record.longitude > -5 &&
              record.longitude < 25 &&
              !record.label.startsWith('MMSI'),
          )
          .sort(
            (a, b) =>
              Math.abs(a.latitude - 60) +
              Math.abs(a.longitude - 6) -
              (Math.abs(b.latitude - 60) + Math.abs(b.longitude - 6)),
          )[0],
    );
    await page.click('#location-bar-toggle');
    await page.click('#search-toggle');
    await page.$eval('#location-search', (e) => {
      e.value = '';
    });
    await page.type(
      '#location-search',
      `${vessel.latitude}, ${vessel.longitude}`,
    );
    await page.keyboard.press('Enter');
    await pause(5000);
    await page.click('#location-bar-toggle');
    // Select an actual received AIS record using the app's normal selection action.
    const selected = await page.evaluate(
      (id) =>
        window.__godsEyeView.dataManager.layers
          .get('ais-live-vessels')
          .module.selectById(id),
      vessel.id,
    );
    if (!selected)
      throw new Error('Live vessel was no longer available for inspection');
    await pause(3000);
    await shot('19-vessel-inspection', ['#hud-ais-vessel']);
  }
  manifest.activeMap = await page.evaluate(() =>
    window.__godsEyeView.mapStackController.getActiveId(),
  );
  // Authentication captures use a separate isolated WebAuthn harness. Preserve
  // them when refreshing the real-data workspace screenshots.
  const previousManifest = JSON.parse(
    await fs.readFile(path.join(out, 'manifest.json'), 'utf8'),
  );
  manifest.screenshots.push(
    ...previousManifest.screenshots.filter(
      (item) => Number.parseInt(item.file, 10) >= 22,
    ),
  );
  manifest.screenshots.sort((a, b) => a.file.localeCompare(b.file));
  await fs.writeFile(
    path.join(out, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
} finally {
  await browser.close();
}
