/** Exercise real public harbor feeds through an authenticated isolated app. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import connect from 'connect';
import sirv from 'sirv';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { readAuthConfig } from '../server/auth/config.js';
import { createAccessService } from '../server/auth/service.js';
import { createAccessMiddleware } from '../server/auth/middleware.js';
import { cctvProxy } from '../server/providers/cctv.js';
import { OSLOFJORD_CAMERAS } from '../server/providers/cctv/oslofjord.js';
import { BROWSER_HEADERS } from '../build/browser-security.js';

const directory = await mkdtemp(join(tmpdir(), 'norsaga-harbor-browser-'));
const app = connect(),
  server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;
const config = readAuthConfig({
  AUTH_LOCAL_DEV: '1',
  AUTH_BASE_URL: origin,
  AUTH_SECRET: randomBytes(48).toString('base64url'),
  AUTH_ADMIN_EMAIL: 'guide@example.org',
  AUTH_DB_PATH: join(directory, 'auth.sqlite'),
});
let token;
const access = await createAccessService(config, {
  sendMail: async (m) => {
    token = m.token;
  },
});
// Only real, operator-published sources; isolate the browser exercise from unrelated packs.
process.env.CCTV_SOURCES_JSON = JSON.stringify(OSLOFJORD_CAMERAS);
process.env.CCTV_FORCE_AUSTIN = '0';
process.env.CCTV_MAX_SOURCES = '1000';
app.use((req, res, next) => {
  for (const [k, v] of Object.entries(BROWSER_HEADERS)) res.setHeader(k, v);
  next();
});
app.use(createAccessMiddleware(access));
cctvProxy().configurePreviewServer({ middlewares: app, httpServer: server });
app.use(sirv(resolve('dist'), { single: false, dotfiles: false }));
const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=metal'],
});
let page;
try {
  const headers = { origin, 'content-type': 'application/json' };
  assert.equal((await fetch(origin + '/api/cctv/sources')).status, 401);
  assert.equal(
    (await fetch(origin + '/api/cctv/frame/oslo-port-kavringen')).status,
    401,
  );
  await fetch(origin + '/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: config.adminEmail }),
  });
  await access.waitForMail();
  const login = await fetch(origin + '/api/access/redeem', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .find((c) => c.includes('session_token'))
    .split(';')[0];
  const results = [];
  for (let i = 0; i < OSLOFJORD_CAMERAS.length; i += 3) {
    const batch = await Promise.all(
      OSLOFJORD_CAMERAS.slice(i, i + 3).map(async (camera) => {
        const r = await fetch(origin + '/api/cctv/frame/' + camera.id, {
          headers: { cookie },
        });
        assert.equal(r.status, 200, camera.id);
        assert.equal(
          r.headers.get('x-cctv-source'),
          'upstream-image',
          camera.id,
        );
        const image = Buffer.from(await r.arrayBuffer()),
          dimensions = await sharp(image).metadata();
        assert.ok(dimensions.width > 1000);
        assert.ok(r.headers.get('x-cctv-image-updated'));
        return {
          id: camera.id,
          width: dimensions.width,
          height: dimensions.height,
          imageUpdated: r.headers.get('x-cctv-image-updated'),
        };
      }),
    );
    results.push(...batch);
  }
  page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const [name, ...value] = cookie.split('=');
  await page.setCookie({
    name,
    value: value.join('='),
    url: origin,
    httpOnly: true,
  });
  await page.goto(origin + '/?welcome=0', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#norsaga-operations', { timeout: 90000 });
  await page.evaluate(async () => {
    await window.__godsEyeView.dataManager.setEnabled('cctv', true, {
      origin: 'user',
    });
  });
  await page.waitForFunction(
    () => document.getElementById('cctv-camera-select').options.length === 14,
    { timeout: 60000 },
  );
  await mkdir('qa-artifacts/harbor-cctv', { recursive: true });
  for (const id of [
    'oslo-port-kavringen',
    'drammen-port-holmen-south',
    'oscarsborg-marina-1',
  ]) {
    await page.select('#cctv-camera-select', id);
    await page.waitForFunction(
      (id) => {
        const image = document.getElementById('cctv-frame');
        return (
          image.dataset.cameraId === id &&
          image.complete &&
          image.naturalWidth > 1000 &&
          document.getElementById('cctv-image-time').textContent.includes('UTC')
        );
      },
      { timeout: 30000 },
      id,
    );
    const state = await page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers.get('cctv').module.getUIState()
          .activeCamera,
    );
    assert.equal(state.id, id);
    assert.equal(state.headingEstimated, true);
    assert.match(state.locationNote, /Approximate/);
    const info = await page.$eval('#cctv-feed-details', (el) => ({
      hidden: el.hidden,
      text: el.textContent,
      link: el.querySelector('a').href,
    }));
    assert.equal(info.hidden, false);
    assert.ok(info.link.startsWith('https://'));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await page.screenshot({ path: `qa-artifacts/harbor-cctv/${id}.png` });
    if (id === 'oslo-port-kavringen')
      await (
        await page.$('#cctv-panel')
      ).screenshot({
        path: 'qa-artifacts/harbor-cctv/oslo-panel.webp',
        type: 'webp',
        quality: 90,
      });
  }
  const result = {
    passed: true,
    realImages: results.length,
    authenticated: true,
    anonymousRequestsDenied: true,
    browserSelections: 3,
    frames: results,
    externalEmailsSent: 0,
  };
  await writeFile(
    'qa-artifacts/harbor-cctv/result.json',
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: 'qa-artifacts/harbor-cctv/failure.png' });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await access.close();
  await rm(directory, { recursive: true, force: true });
}
