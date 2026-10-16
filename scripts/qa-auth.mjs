/** Real browser/WebAuthn integration with an isolated DB and an injected sender.
 * No credentials are printed, no provider data fabricated, no email sent.
 */
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
import { BROWSER_HEADERS } from '../build/browser-security.js';

const directory = await mkdtemp(join(tmpdir(), 'norsaga-auth-browser-'));
const app = connect();
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;
const messages = [];
const config = readAuthConfig({
  AUTH_BASE_URL: origin,
  AUTH_LOCAL_DEV: '1',
  AUTH_SECRET: randomBytes(48).toString('base64url'),
  AUTH_ADMIN_EMAIL: 'administrator@example.org',
  AUTH_DB_PATH: join(directory, 'auth.sqlite'),
});
const access = await createAccessService(config, {
  sendMail: async (message) => messages.push(message),
});
app.use((_req, res, next) => {
  for (const [key, value] of Object.entries(BROWSER_HEADERS))
    res.setHeader(key, value);
  next();
});
app.use(createAccessMiddleware(access));
app.use(sirv(resolve('dist'), { single: false, dotfiles: false }));
const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const qa = resolve('qa-artifacts/auth');
await mkdir(qa, { recursive: true });
const screenshots = resolve('public/user-guide/screenshots');
await mkdir(screenshots, { recursive: true });
let page;
try {
  page = await browser.newPage();
  async function shot(name, selector) {
    const element = await page.$(selector);
    const buffer = await element.screenshot({
      path: join(screenshots, name + '.webp'),
      type: 'webp',
      quality: 90,
    });
    const { width, height } = await sharp(buffer).metadata();
    const file = 'public/user-guide/screenshots/manifest.json';
    const manifest = JSON.parse(
      await (await import('node:fs/promises')).readFile(file, 'utf8'),
    );
    const record = manifest.screenshots.find((x) => x.file === name + '.webp');
    if (record) record.pixels = { width, height };
    await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
    const guideFile = 'public/user-guide/godseye-user-guide.html';
    let guide = await (
      await import('node:fs/promises')
    ).readFile(guideFile, 'utf8');
    guide = guide.replace(/<img[\s\S]*?>/g, (tag) =>
      tag.includes(name + '.webp')
        ? tag
            .replace(/width="\d+"/, 'width="' + width + '"')
            .replace(/height="\d+"/, 'height="' + height + '"')
        : tag,
    );
    await writeFile(guideFile, guide);
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  let { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const r = await page.goto(`${origin}/login.html`, {
    waitUntil: 'networkidle0',
  });
  assert.equal(r.status(), 200);
  await shot('22-personal-login', '.access-card');
  await page.type('#email', config.adminEmail);
  await page.click('#login-form button');
  await page.waitForFunction(() =>
    document.getElementById('status').textContent.includes('If your address'),
  );
  await access.waitForMail();
  assert.equal(messages.length, 1);
  await page.goto(`${origin}/login.html#token=${messages[0].token}`, {
    waitUntil: 'networkidle0',
  });
  await page.waitForFunction(
    () =>
      location.hash === '' &&
      !document.getElementById('confirm-section').hidden,
  );
  assert.equal(
    new URL(page.url()).hash,
    '',
    'token is removed from browser URL',
  );
  await shot('23-confirm-login', '.access-card');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('#confirm-login'),
  ]);
  assert.match(page.url(), /account.html$/);
  await page.waitForFunction(
    () => document.getElementById('identity')?.textContent.includes('@'),
    { polling: 100, timeout: 10000 },
  );
  assert.equal(await page.$eval('#admin-section', (node) => node.hidden), true);
  await shot('24-passkey-setup', 'section.access-card');
  await page.click('#add-passkey');
  await page.waitForFunction(
    () =>
      document.getElementById('status').textContent.includes('Passkey created'),
    { timeout: 15000, polling: 100 },
  );
  assert.equal(access.passkeyCount(access.users()[0].id), 1);
  await page.click('#verify-passkey');
  await page.waitForFunction(
    () => !document.getElementById('admin-section').hidden,
    { timeout: 15000, polling: 100 },
  );
  assert.equal(
    access.db
      .prepare(
        'SELECT passkeyVerified FROM session ORDER BY createdAt DESC LIMIT 1',
      )
      .get().passkeyVerified,
    1,
  );
  // Approve a clearly labelled example account through the real admin UI.
  await page.type('#user-name', 'Example User');
  await page.type('#user-email', 'example@example.org');
  await page.click('#user-form button');
  await page.waitForFunction(() =>
    document
      .getElementById('users')
      .textContent.includes('example@example.org'),
  );
  await page.waitForFunction(() =>
    document.getElementById('access-log').textContent.includes('Passkey'),
  );
  const log = await page.evaluate(async () =>
    (await fetch('/api/access/admin/access-log')).json(),
  );
  assert.ok(log.entries.some((row) => row.method === 'email_link'));
  assert.ok(log.entries.some((row) => row.method === 'passkey'));
  assert.ok(
    log.entries.every((row) => !('sessionId' in row) && !('token' in row)),
  );
  await page.click('#refresh-access-log');
  await page.waitForFunction(
    () =>
      document.getElementById('status').textContent === 'Access log refreshed.',
  );
  await shot('25-user-administration', '#admin-section');
  const adminStatus = await page.evaluate(async () =>
    (await fetch('/api/access/status')).json(),
  );
  assert.equal(adminStatus.adminVerified, true);
  // A reserve passkey belongs on another device, not the same authenticator.
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  }));
  await page.click('#add-passkey');
  await page.waitForFunction(
    () => document.querySelectorAll('#passkey-list li').length === 2,
    { timeout: 15000, polling: 100 },
  );
  // Last-key protection is also server enforced, not only a disabled button.
  await page.click('#passkey-list li button');
  await page.waitForFunction(
    () => document.querySelectorAll('#passkey-list li').length === 1,
  );
  const keyId = access.db.prepare('SELECT id FROM passkey').get().id;
  const lastDelete = await page.evaluate(
    async (id) =>
      (
        await fetch('/api/auth/passkey/delete-passkey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
      ).status,
    keyId,
  );
  assert.equal(lastDelete, 403);

  const cookiesBeforeLogout = await page.cookies();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('#sign-out'),
  ]);
  const cookie = cookiesBeforeLogout
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  assert.equal(
    (await fetch(`${origin}/api/access/status`, { headers: { cookie } }))
      .status,
    401,
  );
  // Email-only return cannot add another owner passkey or reach admin routes.
  await page.type('#email', config.adminEmail);
  await page.click('#login-form button');
  await page.waitForFunction(() =>
    document.getElementById('status').textContent.includes('If your address'),
  );
  await access.waitForMail();
  await page.goto(`${origin}/login.html#token=${messages.at(-1).token}`);
  await page.waitForFunction(
    () =>
      location.hash === '' &&
      !document.getElementById('confirm-section').hidden,
    { polling: 100 },
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('#confirm-login'),
  ]);
  await page.waitForFunction(() =>
    document.getElementById('identity').textContent.includes('@'),
  );
  await page.waitForFunction(
    () => document.getElementById('add-passkey').disabled,
    { timeout: 3000, polling: 100 },
  );
  const blocked = await page.evaluate(async () => ({
    admin: (await fetch('/api/access/admin/users')).status,
    accessLog: (await fetch('/api/access/admin/access-log')).status,
    enrollment: (await fetch('/api/auth/passkey/generate-register-options'))
      .status,
  }));
  assert.deepEqual(blocked, { admin: 403, accessLog: 403, enrollment: 403 });

  // Request an assertion without UV and override only the browser-facing
  // requirement. The server must still reject the signed, non-UV assertion.
  await cdp.send('WebAuthn.setUserVerified', {
    authenticatorId,
    isUserVerified: false,
  });
  const rejectedUV = await page.evaluate(async () => {
    const options = await (
      await fetch('/api/auth/passkey/generate-authenticate-options')
    ).json();
    const decode = (s) =>
      Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
        c.charCodeAt(0),
      );
    const encode = (buffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    const credential = await navigator.credentials.get({
      publicKey: {
        ...options,
        userVerification: 'discouraged',
        challenge: decode(options.challenge),
        allowCredentials: (options.allowCredentials || []).map((c) => ({
          ...c,
          id: decode(c.id),
        })),
      },
    });
    return (
      await fetch('/api/auth/passkey/verify-authentication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: {
            id: credential.id,
            rawId: encode(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: encode(credential.response.clientDataJSON),
              authenticatorData: encode(credential.response.authenticatorData),
              signature: encode(credential.response.signature),
              userHandle: credential.response.userHandle
                ? encode(credential.response.userHandle)
                : null,
            },
            clientExtensionResults: credential.getClientExtensionResults(),
          },
        }),
      })
    ).status;
  });
  assert.ok(
    [400, 401].includes(rejectedUV),
    `non-UV authentication returned ${rejectedUV}`,
  );
  await cdp.send('WebAuthn.setUserVerified', {
    authenticatorId,
    isUserVerified: true,
  });
  await page.click('#verify-passkey');
  await page.waitForFunction(
    () => !document.getElementById('admin-section').hidden,
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  const result = {
    passed: true,
    cases: [
      'email confirmation',
      'actual WebAuthn registration',
      'passkey administration',
      'approval UI',
      'second passkey',
      'last passkey protection',
      'server logout',
      'email-only enrollment denied',
      'signed non-UV assertion rejected',
      'access history includes email and real passkey sign-ins',
      'access history denied to unverified admins',
      'access log refresh UI',
    ],
    screenshots: 4,
    externalEmailsSent: 0,
  };
  await writeFile(join(qa, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: join(qa, 'failure.png') });
  if (page)
    console.error(await page.$eval('#status', (node) => node.textContent));
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await access.close();
  await rm(directory, { recursive: true, force: true });
}
