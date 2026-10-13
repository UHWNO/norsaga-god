import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readAuthConfig, IDLE_MS } from '../../server/auth/config.js';
import { createAccessService } from '../../server/auth/service.js';
import {
  createAccessMiddleware,
  requestHeaders,
} from '../../server/auth/middleware.js';
import { createMailjetSender } from '../../server/auth/mailjet.js';

async function fixture(t, { secure = false, rejectApproval = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'norsaga-access-'));
  let middleware;
  let providerCalls = 0;
  const server = http.createServer((req, res) =>
    middleware(req, res, () => {
      providerCalls++;
      res.setHeader(
        'Content-Type',
        req.url.endsWith('.html') ? 'text/html' : 'application/json',
      );
      res.end(
        req.url.endsWith('.html')
          ? '<h1>Login</h1>'
          : JSON.stringify({ fixture: true }),
      );
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = readAuthConfig({
    AUTH_BASE_URL: secure ? 'https://godseye.norsaga.com' : origin,
    AUTH_LOCAL_DEV: secure ? '0' : '1',
    AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUTH_DB_PATH: join(directory, 'auth.sqlite'),
    MAILJET_API_KEY: 'fixture',
    MAILJET_SECRET_KEY: 'fixture',
    AUTH_MAIL_FROM: 'login@example.org',
  });
  const messages = [];
  const service = await createAccessService(config, {
    sendMail: async (message) => {
      if (rejectApproval && message.kind === 'approval')
        throw new Error('sensitive provider response');
      messages.push(message);
    },
  });
  middleware = createAccessMiddleware(service);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (path, body, cookie, extra = {}) =>
    fetch(origin + path, {
      redirect: 'manual',
      ...(body === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(body) }),
      headers: {
        origin: config.origin,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
    });
  const login = async (email = config.adminEmail) => {
    const send = await call('/api/auth/sign-in/magic-link', { email });
    assert.equal(send.status, 200);
    await service.waitForMail();
    const token = messages.at(-1).token;
    const response = await call('/api/access/redeem', { token });
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    assert.ok(
      cookie.includes('session_token'),
      'login sets a signed session cookie',
    );
    return { cookie, token, response };
  };
  return {
    origin,
    config,
    service,
    messages,
    call,
    login,
    providerCalls: () => providerCalls,
  };
}

test('configuration rejects insecure hosting and missing signing secrets', () => {
  assert.throws(() => readAuthConfig({}), /AUTH_SECRET/);
  assert.throws(
    () =>
      readAuthConfig({
        AUTH_BASE_URL: 'http://godseye.norsaga.com',
        AUTH_SECRET: 'x'.repeat(64),
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      readAuthConfig({
        AUTH_LOCAL_DEV: '1',
        AUTH_BASE_URL: 'https://godseye.norsaga.com',
        AUTH_SECRET: 'x'.repeat(64),
      }),
    /loopback/,
  );
});

test('anonymous feeds, PDFs, panel and app are blocked before providers; public signup is closed', async (t) => {
  const f = await fixture(t);
  for (const path of [
    '/api/vessels',
    '/api/openai/realtime/session',
    '/api/access/admin/users',
  ]) {
    assert.equal((await f.call(path)).status, 401, path);
  }
  for (const path of [
    '/',
    '/user-guide/godseye-user-guide.pdf',
    '/panel/index.html',
    '/account.html',
    '/%2e%2e/api/vessels',
  ]) {
    const r = await f.call(path);
    assert.ok([302, 401].includes(r.status), path);
  }
  assert.equal(f.providerCalls(), 0);
  assert.equal((await f.call('/login.html')).status, 200);
  assert.equal((await f.call('/healthz')).status, 200);
  for (const path of [
    '/api/auth/sign-up/email',
    '/api/auth/update-user',
    '/api/auth/magic-link/verify',
  ]) {
    assert.equal((await f.call(path, {})).status, 404, path);
  }
});

test('only approved addresses receive mail, responses match, tokens are hashed and single-use including concurrent redemption', async (t) => {
  const f = await fixture(t);
  const known = await f.call('/api/auth/sign-in/magic-link', {
    email: f.config.adminEmail,
  });
  const unknown = await f.call('/api/auth/sign-in/magic-link', {
    email: 'unknown@example.org',
  });
  assert.equal(known.status, unknown.status);
  assert.deepEqual(await known.json(), await unknown.json());
  await f.service.waitForMail();
  assert.equal(f.messages.length, 1);
  const { token } = f.messages[0];
  const stored = f.service.db
    .prepare('SELECT identifier,value FROM verification')
    .all();
  assert.ok(
    stored.every(
      (record) =>
        !record.identifier.includes(token) && !record.value.includes(token),
    ),
  );
  const responses = await Promise.all([
    f.call('/api/access/redeem', { token }),
    f.call('/api/access/redeem', { token }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  assert.equal((await f.call('/api/access/redeem', { token })).status, 400);
  assert.equal(
    f.service.users().length,
    1,
    'unknown users cannot auto-register',
  );
});

test('session cookies are signed and hardened; roles cannot be supplied; real logout revokes the session', async (t) => {
  const f = await fixture(t, { secure: true });
  const { cookie, response } = await f.login();
  const values = response.headers.getSetCookie().join('; ');
  assert.match(values, /HttpOnly/i);
  assert.match(values, /Secure/i);
  assert.match(values, /SameSite=Lax/i);
  assert.equal((await f.call('/api/vessels', undefined, cookie)).status, 200);
  const visibleSession = await (
    await f.call('/api/auth/get-session', undefined, cookie)
  ).json();
  assert.equal(
    visibleSession.session.token,
    undefined,
    'session introspection omits raw credentials',
  );
  assert.equal(
    (await f.call('/api/access/admin/users', undefined, cookie)).status,
    403,
    'email-only owner has no administration privilege',
  );
  const forged = cookie.replace(/session_token=./, 'session_token=z');
  assert.equal((await f.call('/api/vessels', undefined, forged)).status, 401);
  assert.equal(
    (
      await f.call(
        '/api/auth/update-user',
        { role: 'admin', active: true },
        cookie,
      )
    ).status,
    404,
  );
  const logout = await f.call('/api/auth/sign-out', {}, cookie);
  assert.equal(logout.status, 200);
  assert.equal((await f.call('/api/vessels', undefined, cookie)).status, 401);
});

test('server inactivity expires sessions despite polling; absolute expiry and membership revocation are enforced', async (t) => {
  const f = await fixture(t);
  f.service.setUser('fixture', { email: 'member@example.org', name: 'Member' });
  let { cookie } = await f.login('member@example.org');
  f.service.db
    .prepare('UPDATE session SET lastActivity = ?')
    .run(Date.now() - IDLE_MS - 1);
  assert.equal((await f.call('/api/vessels', undefined, cookie)).status, 401);
  ({ cookie } = await f.login('member@example.org'));
  f.service.db.prepare('UPDATE session SET expiresAt = ?').run(Date.now() - 1);
  assert.equal((await f.call('/api/vessels', undefined, cookie)).status, 401);
  ({ cookie } = await f.login('member@example.org'));
  f.service.setUser('fixture', { email: 'member@example.org', active: false });
  assert.equal((await f.call('/api/vessels', undefined, cookie)).status, 401);
  const lastToken = f.messages.at(-1).token;
  assert.equal(
    (await f.call('/api/access/redeem', { token: lastToken })).status,
    400,
  );
});

test('cross-origin and missing-origin mutations fail; auth bodies are capped; spoofed IP headers are ignored', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call(
        '/api/auth/sign-in/magic-link',
        { email: f.config.adminEmail },
        undefined,
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        '/api/auth/sign-in/magic-link',
        { email: f.config.adminEmail },
        undefined,
        { origin: '' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call('/api/auth/sign-in/magic-link', {
        email: f.config.adminEmail,
        excess: 'x'.repeat(70_000),
      })
    ).status,
    413,
  );
  assert.equal(
    requestHeaders(
      {
        headers: { 'x-real-ip': '1.2.3.4' },
        socket: { remoteAddress: '8.8.8.8' },
      },
      { trustProxy: true },
    ).get('x-real-ip'),
    '8.8.8.8',
  );
  assert.equal(
    requestHeaders(
      {
        headers: { 'x-real-ip': '1.2.3.4' },
        socket: { remoteAddress: '127.0.0.1' },
      },
      { trustProxy: false },
    ).get('x-real-ip'),
    '127.0.0.1',
  );
});

test('persistent per-email and per-IP limits cap email floods', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.call('/api/auth/sign-in/magic-link', {
          email: f.config.adminEmail,
        })
      ).status,
      200,
    );
  await f.service.waitForMail();
  assert.equal(f.messages.length, 3);
  assert.equal(
    (
      await f.call('/api/auth/sign-in/magic-link', {
        email: f.config.adminEmail,
      })
    ).status,
    429,
  );
  assert.ok(
    f.service.db.prepare('SELECT COUNT(*) AS count FROM access_limit').get()
      .count >= 2,
  );
});

test('expired links fail and disabling a user cancels their unused links even after reactivation', async (t) => {
  const f = await fixture(t);
  await f.call('/api/auth/sign-in/magic-link', { email: f.config.adminEmail });
  await f.service.waitForMail();
  f.service.db
    .prepare('UPDATE verification SET expiresAt = ?')
    .run(Date.now() - 1);
  assert.equal(
    (await f.call('/api/access/redeem', { token: f.messages.at(-1).token }))
      .status,
    400,
  );
  f.service.setUser('fixture', { email: 'member@example.org' });
  await f.call('/api/auth/sign-in/magic-link', { email: 'member@example.org' });
  await f.service.waitForMail();
  const token = f.messages.at(-1).token;
  f.service.setUser('fixture', { email: 'member@example.org', active: false });
  f.service.setUser('fixture', { email: 'member@example.org', active: true });
  assert.equal((await f.call('/api/access/redeem', { token })).status, 400);
});

test('last owner passkey has atomic database protection and owner configuration cannot bootstrap another admin', async (t) => {
  const f = await fixture(t);
  const owner = f.service.users()[0];
  const insert = f.service.db.prepare(
    'INSERT INTO passkey (id,publicKey,userId,credentialID,counter,deviceType,backedUp,createdAt) VALUES (?,?,?,?,0,?,0,?)',
  );
  insert.run(
    'key-1',
    'fixture-public-key',
    owner.id,
    'credential-1',
    'singleDevice',
    Date.now(),
  );
  insert.run(
    'key-2',
    'fixture-public-key',
    owner.id,
    'credential-2',
    'singleDevice',
    Date.now(),
  );
  assert.throws(
    () =>
      f.service.db
        .prepare('DELETE FROM passkey WHERE userId = ?')
        .run(owner.id),
    /Keep at least one/,
  );
  assert.equal(
    f.service.passkeyCount(owner.id),
    2,
    'a multi-row delete rolls back atomically',
  );
  f.service.db.prepare('DELETE FROM passkey WHERE id = ?').run('key-1');
  assert.throws(
    () => f.service.db.prepare('DELETE FROM passkey WHERE id = ?').run('key-2'),
    /Keep at least one/,
  );
  await assert.rejects(
    createAccessService(
      { ...f.config, adminEmail: 'another@example.org' },
      { sendMail: async () => {} },
    ),
    /existing owner/,
  );
  assert.equal(
    f.service.users().filter((user) => user.role === 'admin').length,
    1,
  );
});

test('Mailjet links use URL fragments and disabled tracking; failures never include provider bodies or secrets', async () => {
  let payload;
  const send = createMailjetSender(
    {
      origin: 'https://godseye.norsaga.com',
      mailFrom: 'login@example.org',
      mailjetKey: 'key',
      mailjetSecret: 'secret',
    },
    async (_, options) => {
      payload = JSON.parse(options.body);
      return Response.json({ Messages: [{ Status: 'success' }] });
    },
  );
  await send({ email: 'member@example.org', token: 'testtoken' });
  assert.match(payload.Messages[0].TextPart, /login\.html#token=testtoken/);
  assert.equal(payload.Messages[0].TrackClicks, 'disabled');
  assert.equal(payload.Messages[0].TrackOpens, 'disabled');
  const failed = createMailjetSender(
    { origin: 'https://test.example' },
    async () => new Response('secret', { status: 401 }),
  );
  await assert.rejects(
    failed({ email: 'member@example.org', token: 'testtoken' }),
    /^Error: Mailjet did not confirm acceptance \(HTTP 401\)$/,
  );
});

test('Mailjet approval notices link to the app and explain secure sign-in without issuing a token', async () => {
  let payload;
  const send = createMailjetSender(
    {
      origin: 'https://godseye.norsaga.com',
      mailFrom: 'no-reply@norsaga.com',
      mailFromName: 'NorSaga God´s Eye Access',
      mailjetKey: 'fixture',
      mailjetSecret: 'fixture',
    },
    async (_, options) => {
      payload = JSON.parse(options.body);
      return Response.json({ Messages: [{ Status: 'success' }] });
    },
  );
  await send({
    kind: 'approval',
    email: 'member@example.org',
    name: 'New Member',
  });
  const message = payload.Messages[0];
  assert.deepEqual(message.From, {
    Email: 'no-reply@norsaga.com',
    Name: 'NorSaga God´s Eye Access',
  });
  assert.deepEqual(message.To, [{ Email: 'member@example.org' }]);
  assert.match(message.Subject, /Access Has Been Approved/);
  assert.match(message.TextPart, /Hello New Member/);
  assert.match(message.TextPart, /https:\/\/godseye\.norsaga\.com\//);
  assert.match(
    message.TextPart,
    /approved email address \(member@example.org\)/,
  );
  assert.match(message.TextPart, /request a sign-in link/);
  assert.match(message.TextPart, /10 minutes/);
  assert.doesNotMatch(message.TextPart, /#token=|undefined/);
  assert.equal(message.TrackClicks, 'disabled');
  assert.equal(message.TrackOpens, 'disabled');
});

test('admin approval sends once per grant, preserves authentication requirements, and audits acceptance', async (t) => {
  const f = await fixture(t);
  const owner = f.service.users()[0];
  const { cookie } = await f.login();
  const body = {
    email: 'Member@Example.org',
    name: 'New Member',
    active: true,
  };
  assert.equal(
    (await f.call('/api/access/admin/users', body, cookie)).status,
    403,
  );
  assert.equal(f.messages.filter((m) => m.kind === 'approval').length, 0);
  f.service.db
    .prepare('UPDATE session SET passkeyVerified = 1 WHERE userId = ?')
    .run(owner.id);
  const sessionsBefore = f.service.db
    .prepare('SELECT COUNT(*) AS count FROM session')
    .get().count;
  const response = await f.call('/api/access/admin/users', body, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: true,
    notification: 'accepted',
  });
  const approvals = () => f.messages.filter((m) => m.kind === 'approval');
  assert.deepEqual(approvals(), [
    { kind: 'approval', email: 'member@example.org', name: 'New Member' },
  ]);
  assert.equal(
    f.service.db.prepare('SELECT COUNT(*) AS count FROM session').get().count,
    sessionsBefore,
  );
  assert.ok(
    f.service
      .events()
      .some(
        (e) =>
          e.event === 'approval_email_accepted' &&
          e.actor === owner.id &&
          e.target === 'member@example.org',
      ),
  );
  const edited = await f.call(
    '/api/access/admin/users',
    { ...body, name: 'Updated Name' },
    cookie,
  );
  assert.equal((await edited.json()).notification, null);
  assert.equal(
    approvals().length,
    1,
    'an already approved user is not notified again',
  );
  const disabled = await f.call(
    '/api/access/admin/users',
    { ...body, active: false },
    cookie,
  );
  assert.equal((await disabled.json()).notification, null);
  assert.equal(
    approvals().length,
    1,
    'blocking access does not send an approval email',
  );
  const reactivated = await f.call('/api/access/admin/users', body, cookie);
  assert.equal((await reactivated.json()).notification, 'accepted');
  assert.equal(approvals().length, 2);
  await f.login('member@example.org');
});

test('approval email failures retain approved access and report failure without exposing provider data', async (t) => {
  const f = await fixture(t, { rejectApproval: true });
  const owner = f.service.users()[0];
  const { cookie } = await f.login();
  f.service.db
    .prepare('UPDATE session SET passkeyVerified = 1 WHERE userId = ?')
    .run(owner.id);
  const response = await f.call(
    '/api/access/admin/users',
    { email: 'member@example.org', active: true },
    cookie,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: true,
    notification: 'failed',
  });
  assert.equal(
    f.service.users().find((u) => u.email === 'member@example.org').active,
    1,
  );
  const events = f.service.events();
  assert.ok(
    events.some(
      (e) =>
        e.event === 'approval_email_failed' &&
        e.target === 'member@example.org',
    ),
  );
  assert.doesNotMatch(JSON.stringify(events), /sensitive provider response/);
  await f.login('member@example.org');
});

test('access history records confirmed sessions, ignores background polling, and tracks activity and logout', async (t) => {
  const f = await fixture(t);
  await f.call('/api/auth/sign-in/magic-link', {
    email: 'unknown@example.org',
  });
  assert.equal(f.service.accessHistory.entries().length, 0);
  const { cookie } = await f.login();
  const first = f.service.accessHistory.entries()[0];
  assert.equal(first.email, f.config.adminEmail);
  assert.equal(first.method, 'email_link');
  assert.equal(first.status, 'active');
  for (const path of [
    '/api/vessels',
    '/api/access/status',
    '/api/auth/get-session',
  ])
    await f.call(path, undefined, cookie);
  assert.equal(
    f.service.accessHistory.entries()[0].lastSeenAt,
    first.lastSeenAt,
  );
  await f.call('/api/access/activity', {}, cookie);
  assert.ok(f.service.accessHistory.entries()[0].lastSeenAt > first.lastSeenAt);
  await f.call('/account.html', undefined, cookie);
  await f.call('/api/auth/sign-out', {}, cookie);
  const last = f.service.accessHistory.entries()[0];
  assert.equal(last.status, 'signed_out');
  assert.ok(last.endedAt >= last.signedInAt);
  assert.equal(f.service.accessHistory.entries().length, 1);
  assert.deepEqual(Object.keys(last).sort(), [
    'email',
    'endedAt',
    'lastSeenAt',
    'method',
    'name',
    'signedInAt',
    'status',
  ]);
});

test('access history is restricted to verified admins and survives revocation and service restart', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/access/admin/access-log')).status, 401);
  const admin = await f.login();
  assert.equal(
    (await f.call('/api/access/admin/access-log', undefined, admin.cookie))
      .status,
    403,
  );
  const owner = f.service.users()[0];
  f.service.db
    .prepare('UPDATE session SET passkeyVerified = 1 WHERE userId = ?')
    .run(owner.id);
  const response = await f.call(
    '/api/access/admin/access-log',
    undefined,
    admin.cookie,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.json()).entries[0].email, owner.email);
  f.service.db
    .prepare('UPDATE session SET createdAt = ? WHERE userId = ?')
    .run(Date.now() - 16 * 60_000, owner.id);
  assert.equal(
    (await f.call('/api/access/admin/access-log', undefined, admin.cookie))
      .status,
    403,
    'admin verification expires',
  );
  f.service.db
    .prepare('UPDATE session SET createdAt = ? WHERE userId = ?')
    .run(Date.now(), owner.id);
  f.service.setUser(owner.id, { email: 'member@example.org', name: 'Member' });
  const member = await f.login('member@example.org');
  assert.equal(
    (await f.call('/api/access/admin/access-log', undefined, member.cookie))
      .status,
    403,
  );
  f.service.setUser(owner.id, { email: 'member@example.org', active: false });
  f.service.setUser(owner.id, { email: 'member@example.org', active: true });
  assert.equal(f.service.accessHistory.entries()[0].status, 'revoked');
  const reopened = await createAccessService(f.config, {
    sendMail: async () => {},
  });
  try {
    assert.equal(
      reopened.accessHistory.entries().length,
      2,
      'initialization does not duplicate sessions',
    );
    assert.equal(reopened.accessHistory.entries()[0].status, 'revoked');
  } finally {
    await reopened.close();
  }
});

test('access history shows expired sessions, removes records after 90 days and limits results to 100', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.login();
  f.service.db
    .prepare('UPDATE session SET lastActivity = ?')
    .run(Date.now() - IDLE_MS - 1);
  assert.equal(f.service.accessHistory.entries()[0].status, 'expired');
  assert.equal(
    (await f.call('/api/access/status', undefined, cookie)).status,
    401,
  );
  assert.equal(f.service.accessHistory.entries()[0].status, 'expired');
  const again = await f.login();
  f.service.db.prepare('UPDATE session SET expiresAt = ?').run(Date.now() - 1);
  assert.equal(
    (await f.call('/api/access/status', undefined, again.cookie)).status,
    401,
  );
  assert.equal(
    f.service.accessHistory.entries()[0].status,
    'expired',
    'absolute expiry is retained after deletion',
  );
  const history = f.service.db.prepare('SELECT * FROM user_access').get();
  for (let i = 0; i < 105; i++) {
    f.service.accessHistory.record(
      {
        id: `retention-${i}`,
        passkeyVerified: false,
        createdAt: Date.now() - i * 1000,
        lastActivity: Date.now(),
        expiresAt: Date.now() + 100000,
      },
      { id: history.userId, name: 'Member', email: 'member@example.org' },
    );
  }
  const list = f.service.accessHistory.entries();
  assert.equal(list.length, 100);
  assert.ok(list.every((r, i) => !i || r.signedInAt <= list[i - 1].signedInAt));
  f.service.db
    .prepare('UPDATE user_access SET signedInAt = ? WHERE sessionId = ?')
    .run(Date.now() - 91 * 86400_000, 'retention-0');
  f.service.accessHistory.entries();
  assert.equal(
    f.service.db
      .prepare('SELECT sessionId FROM user_access WHERE sessionId = ?')
      .get('retention-0'),
    undefined,
  );
});
