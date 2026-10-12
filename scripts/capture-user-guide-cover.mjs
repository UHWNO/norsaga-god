/** Capture real AIS and weather on the shipped app for the guide cover. */
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { unlockNorSaga } from './qa-norsaga-access.mjs';
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=metal'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
  await page.goto(`${base}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await unlockNorSaga(page);
  await page.waitForSelector('#norsaga-operations', { timeout: 90000 });
  await page.select('#norsaga-region', 'north-sea');
  for (const id of ['ais-live-vessels', 'wind', 'weather-satellite']) {
    await page.evaluate(async (id) => {
      await window.__godsEyeView.dataManager.setEnabled(id, true, { origin: 'user' });
    }, id);
    console.log(`Enabled ${id}`);
  }
  await page.evaluate(() => { window.__godsEyeView.dataManager.layers.get('weather-satellite').module.setParams({product:'clouds'}); });
  await page.waitForFunction(() => window.__godsEyeView.dataManager.layers.get('ais-live-vessels').module.getAllPositions().length > 0, { timeout: 90000 }); 
  await page.waitForFunction(() => {const d=window.__godsEyeView.dataManager.layers.get('weather-satellite').module.getDiagnostics();return d.product==='clouds' && d.loadedTiles>0 && !d.loading;}, {timeout:90000});
  await new Promise(resolve => setTimeout(resolve, 5000));
  await page.evaluate(() => { document.querySelector('.norsaga-layers').open = true; });
  const evidence = await page.evaluate(() => {
    const app = window.__godsEyeView;
    return {
      activeMap: app.mapStackController.getActiveId(),
      vessels: app.dataManager.layers.get('ais-live-vessels').module.getAllPositions().length,
      layers: ['ais-live-vessels','wind','weather-satellite'].map(id => ({ id, enabled: app.dataManager.layers.get(id).enabled, stats: app.dataManager.layers.get(id).module.getStats?.(), diagnostics: app.dataManager.layers.get(id).module.getDiagnostics?.() })),
    };
  });
  await page.screenshot({ path: 'public/user-guide/screenshots/00-ais-weather-cover.webp', type: 'webp', quality: 95 });
  await fs.writeFile('qa-artifacts/user-guide/cover-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ captured: true, vessels: evidence.vessels, enabledLayers: evidence.layers.filter(x => x.enabled).map(x=>x.id) }));
} finally { await browser.close(); }
