/** Browser validation and optional PDF export of the complete user guide.
 * node scripts/check-user-guide.mjs [--pdf]
 * QA_BASE_URL defaults to the local Vite server. No app state is changed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const qa = path.resolve('qa-artifacts/user-guide');
await fs.mkdir(qa, { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewport({ width: 1600, height: 1000 });
  const response = await page.goto(
    `${base}/user-guide/godseye-user-guide.html`,
    { waitUntil: 'networkidle0' },
  );
  assert.equal(response.status(), 200);
  const chapters = await page.$$eval('#guideNav button', (nodes) =>
    nodes.map((node) => node.dataset.page),
  );
  assert.equal(chapters.length, 13);
  for (const chapter of chapters) {
    await page.click(`#guideNav button[data-page="${chapter}"]`);
    await page.waitForFunction(
      (id) => document.querySelector('.page.active')?.id === `page-${id}`,
      {},
      chapter,
    );
    assert.equal(
      await page.$eval(
        '#guideNav [aria-current="page"]',
        (node) => node.dataset.page,
      ),
      chapter,
    );
    assert.equal(
      await page.$eval('body', (node) =>
        /screenshot placeholder|future screenshot|suggested screenshot/i.test(
          node.innerText,
        ),
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `Overflow in ${chapter}`,
    );
  }
  await page.evaluate(async () => {
    const images = [...document.images];
    images.forEach((image) => {
      image.loading = 'eager';
    });
    await Promise.all(images.map((image) => image.decode()));
  });
  const images = await page.$$eval('figure img', (nodes) =>
    nodes.map((node) => ({
      source: node.getAttribute('src'),
      width: node.naturalWidth,
      height: node.naturalHeight,
      alt: node.alt,
    })),
  );
  assert.equal(images.length, 21);
  const manifest = JSON.parse(
    await fs.readFile('public/user-guide/screenshots/manifest.json', 'utf8'),
  );
  const expectedImages = new Map(
    manifest.screenshots.map((item) => [item.file, item.pixels]),
  );
  assert.ok(
    images.every(
      (image) =>
        image.width ===
          expectedImages.get(path.basename(image.source))?.width &&
        image.height ===
          expectedImages.get(path.basename(image.source))?.height &&
        image.alt.length > 20,
    ),
  );
  assert.equal(
    await page.$$eval('.chapter-link', (nodes) =>
      nodes.every((node) =>
        document.getElementById(`page-${node.hash.slice(1)}`),
      ),
    ),
    true,
  );
  await page.goto(`${base}/user-guide/godseye-user-guide.html#scenes`, {
    waitUntil: 'networkidle0',
  });
  assert.equal(
    await page.$eval('.page.active', (node) => node.id),
    'page-scenes',
  );
  await page.click('[data-page="aurora"]');
  await page.waitForFunction(() => location.hash === '#aurora');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('.page.active').id === 'page-scenes',
  );
  await page.screenshot({ path: path.join(qa, 'guide-scenes-desktop.png') });
  // Only the documentation is checked at narrow widths; the app requires desktop.
  for (const width of [900, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.waitForFunction(
      () =>
        document.getElementById('guideSidebar').getBoundingClientRect().right <=
        0,
    );
    await page.click('#menuToggle');
    assert.equal(
      await page.$eval('#menuToggle', (node) =>
        node.getAttribute('aria-expanded'),
      ),
      'true',
    );
    await page.waitForFunction(
      () =>
        Math.abs(
          document.getElementById('guideSidebar').getBoundingClientRect().left,
        ) < 1,
    );
    await page.click('[data-page="overview"]');
    await page.waitForFunction(
      () => document.querySelector('.page.active').id === 'page-overview',
    );
    assert.equal(
      await page.$eval('#menuToggle', (node) =>
        node.getAttribute('aria-expanded'),
      ),
      'false',
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(qa, `guide-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewport({ width: 1600, height: 1000 });
  await page.emulateMediaType('print');
  await page.evaluate(async () => {
    [...document.images].forEach((image) => {
      image.loading = 'eager';
    });
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  assert.equal(
    await page.$$eval(
      '.page',
      (nodes) =>
        nodes.filter((node) => getComputedStyle(node).display !== 'none')
          .length,
    ),
    13,
  );
  assert.equal(
    await page.$eval('.close-guide', (node) => getComputedStyle(node).display),
    'none',
  );
  if (process.argv.includes('--pdf')) {
    // Efficient PDF embedding preserves the original screenshot files.
    await page.evaluate(async () => {
      for (const image of document.images) {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        image.src = canvas.toDataURL('image/jpeg', 0.9);
        await image.decode();
      }
      document.title = "NorSaga God's Eye - Beginner User Guide";
    });
    const pdf = path.resolve('output/pdf/godseye-user-guide.pdf');
    await fs.mkdir(path.dirname(pdf), { recursive: true });
    await page.pdf({
      path: pdf,
      preferCSSPageSize: true,
      printBackground: true,
      outline: true,
      tagged: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font:9px Arial;width:100%;padding:0 14mm;display:flex;justify-content:space-between;color:#536679"><span>NorSaga God’s Eye · Beginner User Guide · 12 October 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
    await fs.copyFile(
      pdf,
      path.resolve('public/user-guide/godseye-user-guide.pdf'),
    );
    console.log(`Exported ${pdf}`);
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(qa, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        chapters: chapters.length,
        screenshots: images.length,
        screenshotPixels:
          'Workspace and focused control captures, checked against the manifest',
        checks: [
          'All chapters and current-page labels',
          'No screenshot placeholders',
          'All screenshot assets decode',
          'Chapter links and browser Back',
          'Narrow guide navigation and overflow',
          'Print includes all chapters and hides close button',
          'No JavaScript errors',
        ],
        images,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `PASS: ${chapters.length} chapters; ${images.length} screenshots; navigation, images, print and narrow guide layout`,
  );
} finally {
  await browser.close();
}
