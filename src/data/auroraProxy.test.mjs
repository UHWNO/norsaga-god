import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  auroraProxy,
  normalizeOvation,
  normalizeKp,
  normalizeGeomagneticAlerts,
  NOAA_AURORA_URLS,
} from '../../server/providers/aurora.js';

const NOW = Date.parse('2026-10-06T00:30:00Z');
const grid = (
  cells = [
    [0, 70, 55],
    [359, -70, 80],
    [180, 0, 0],
  ],
) => ({
  type: 'MultiPoint',
  'Data Format': '[Longitude, Latitude, Aurora]',
  'Observation Time': '2026-10-06T00:20:00Z',
  'Forecast Time': '2026-10-06T01:05:00Z',
  coordinates: cells,
});
const kp = [
  {
    time_tag: '2026-10-06T00:00:00',
    kp: 4.33,
    observed: 'predicted',
    noaa_scale: null,
  },
];
const warning = (message, id = 'K05W', issued = '2026-10-06 00:20:00.000') => ({
  product_id: id,
  issue_datetime: issued,
  message,
});
const warningText =
  'WARNING: Geomagnetic K-index of 5 expected\nValid From: 2026 Oct 06 0000 UTC\nValid To: 2026 Oct 06 0300 UTC\nNOAA Scale: G1 - Minor';
const response = (body) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
function fixture(options = {}) {
  const calls = [];
  let now = NOW,
    broken = false;
  const plugin = auroraProxy({
    now: () => now,
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (broken) throw new Error('offline');
      return response(
        url === NOAA_AURORA_URLS.ovation
          ? grid()
          : url === NOAA_AURORA_URLS.kp
            ? kp
            : [],
      );
    },
    ...options,
  });
  let handler;
  plugin.configureServer({
    middlewares: {
      use: (route, fn) => {
        assert.equal(route, '/api/aurora');
        handler = fn;
      },
    },
  });
  const request = (url = '/', method = 'GET') => {
    const res = new EventEmitter();
    res.writeHead = (status) => {
      res.status = status;
    };
    res.end = (text) => {
      res.body = JSON.parse(text);
    };
    const done = handler({ url, method }, res).then(() => res);
    return { res, done };
  };
  return {
    calls,
    request,
    setNow: (value) => {
      now = value;
    },
    setBroken: () => {
      broken = true;
    },
    plugin,
  };
}

test('OVATION normalizes longitudes and preserves both hemispheres, including empty and zero grids', () => {
  assert.deepEqual(normalizeOvation(grid(), NOW).cells, [
    [0, 70, 55],
    [-1, -70, 80],
    [-180, 0, 0],
  ]);
  assert.deepEqual(normalizeOvation(grid([]), NOW).cells, []);
  assert.deepEqual(normalizeOvation(grid([[0, 0, 0]]), NOW).cells, [[0, 0, 0]]);
});
test('OVATION rejects malformed shape, excessive cells, duplicates, bad ranges and invalid or expired times', () => {
  for (const value of [
    null,
    {},
    { ...grid(), type: 'Point' },
    { ...grid(), 'Data Format': 'unknown' },
    grid([[360, 1, 1]]),
    grid([[0, 91, 1]]),
    grid([[0, 1, 101]]),
    grid([[0, 1, NaN]]),
    grid([[0, 1, '20']]),
    grid([[0, 1, 1.5]]),
    grid([
      [0, 1, 1],
      [0, 1, 1],
    ]),
    grid(Array(65161).fill([0, 0, 0])),
    { ...grid(), 'Observation Time': '2026-02-30T00:00:00Z' },
    { ...grid(), 'Observation Time': '2026-10-06T02:00:00Z' },
    { ...grid(), 'Forecast Time': '2026-10-06T00:00:00Z' },
  ])
    assert.throws(() => normalizeOvation(value, NOW));
  assert.throws(() => normalizeOvation(grid(), NOW + 61 * 60_000));
});
test('Kp preserves interval provenance and never labels observed data as a forecast', async () => {
  const rows = normalizeKp(
    [
      ...kp,
      { ...kp[0], time_tag: '2026-10-05T21:00:00', observed: 'observed' },
    ],
    NOW,
  );
  assert.equal(rows[0].kind, 'observed');
  assert.equal(rows[1].validUntil, '2026-10-06T03:00:00.000Z');
  for (const bad of [
    [],
    [{ ...kp[0], kp: 10 }],
    [{ ...kp[0], kp: '4' }],
    [{ ...kp[0], observed: 'unknown' }],
    [{ ...kp[0], noaa_scale: 'G9' }],
    [kp[0], kp[0]],
    [{ ...kp[0], time_tag: '2026-10-06T01:00:00' }],
  ])
    assert.throws(() => normalizeKp(bad, NOW));
  const f = fixture({
    fetchImpl: async (url) =>
      response(
        url === NOAA_AURORA_URLS.ovation
          ? grid()
          : url === NOAA_AURORA_URLS.kp
            ? [{ ...kp[0], observed: 'observed' }]
            : [],
      ),
  });
  assert.equal((await f.request().done).body.kp.current, null);
});
test('geomagnetic extraction handles extensions, bounded alerts, watches, expired notices and cancellation', async () => {
  const extended = warning(
    warningText.replace('Valid To:', 'Now Valid Until:'),
  );
  const threshold = warning(
    'ALERT: Geomagnetic K-index of 6\nSynoptic Period: 0000-0300\nActive Warning: YES\nNOAA Scale: G2 - Moderate',
    'K06A',
  );
  const watch = warning(
    'WATCH: G3 (Strong) Geomagnetic Storm Level\nValid for UTC Day: 2026 Oct 06',
    'WATA',
  );
  const unrelated = warning('ALERT: Proton Flux\nNOAA Scale: S1', 'P10A');
  const cancelled = warning(
    'CANCELLED: Geomagnetic warning',
    'K05W',
    '2026-10-06 00:25:00.000',
  );
  assert.equal(
    normalizeGeomagneticAlerts([extended, threshold, watch, unrelated], NOW)
      .length,
    3,
  );
  assert.equal(
    normalizeGeomagneticAlerts([extended, cancelled], NOW).length,
    0,
  );
  assert.equal(
    normalizeGeomagneticAlerts(
      [warning('ALERT: Geomagnetic K-index of 5\nNOAA Scale: G1')],
      NOW,
    ).length,
    0,
  );
  const f = fixture({
    fetchImpl: async (url) =>
      response(
        url === NOAA_AURORA_URLS.ovation
          ? grid()
          : url === NOAA_AURORA_URLS.kp
            ? kp
            : [extended, threshold, watch],
      ),
  });
  const value = (await f.request().done).body;
  assert.equal(value.geomagnetic.active.scale, 'G3');
  f.setNow(NOW + 24 * 60 * 60_000);
  assert.equal((await f.request().done).body.geomagnetic.active, null);
});
test('provider only accepts fixed routes and methods; schema and endpoints are internal', async () => {
  const f = fixture();
  for (const url of ['/?url=https://example.com', '/x', '/?product=kp'])
    assert.equal((await f.request(url).done).status, 400);
  assert.equal((await f.request('/', 'POST').done).status, 405);
  assert.equal(f.calls.length, 0);
  const { body } = await f.request().done;
  assert.equal(body.provider, 'NOAA SWPC');
  assert.equal(body.stale, false);
  assert.equal(body.forecastTime, '2026-10-06T01:05:00.000Z');
  assert.equal(body.kp.current.value, 4.33);
  assert.deepEqual(
    new Set(f.calls.map((call) => call.url)),
    new Set(Object.values(NOAA_AURORA_URLS)),
  );
  assert.ok(f.calls.every(({ request }) => request.redirect === 'error'));
});
test('shared cache coalesces clients, falls back stale and expires bounded snapshots', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.request().done, f.request().done]);
  assert.deepEqual(a.body, b.body);
  assert.equal(f.calls.length, 3);
  await f.request().done;
  assert.equal(f.calls.length, 3);
  f.setBroken();
  f.setNow(NOW + 6 * 60_000);
  const stale = (await f.request().done).body;
  assert.equal(stale.stale, true);
  assert.equal(stale.unavailable, false);
  assert.equal(stale.fetchedAt, NOW);
  assert.equal(stale.kp.stale, true);
  f.setNow(NOW + 61 * 60_000);
  const expired = (await f.request().done).body;
  assert.equal(expired.unavailable, true);
  assert.deepEqual(expired.cells, []);
});
test('newly fetched old observations are clearly delayed and do not renew the source expiry', async () => {
  const f = fixture();
  f.setNow(NOW + 10 * 60_000);
  const { body } = await f.request().done;
  assert.equal(body.delayed, true);
  assert.equal(body.stale, true);
});
test('malformed, oversized streamed or declared bodies, bad status and content type never fabricate grids', async () => {
  const bodies = [
    () =>
      new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
    () => response({ bogus: true }),
    () => new Response('[]', { status: 503 }),
    () => new Response('[]', { headers: { 'Content-Type': 'text/html' } }),
    () =>
      new Response('[]', {
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '9000000',
        },
      }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  ];
  for (const make of bodies) {
    const f = fixture({ fetchImpl: async () => make() });
    const { body } = await f.request().done;
    assert.equal(body.unavailable, true);
    assert.deepEqual(body.cells, []);
  }
});
test('timeouts settle uncooperative fetches and abort all upstream signals', async () => {
  const signals = [];
  const f = fixture({
    timeoutMs: 5,
    fetchImpl: (_, { signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    },
  });
  const { body } = await f.request().done;
  assert.equal(body.unavailable, true);
  assert.ok(signals.every((signal) => signal.aborted));
});
test('one disconnect releases only its waiter; last disconnect aborts shared requests', async () => {
  const signals = [],
    pending = [];
  const f = fixture({
    fetchImpl: (url, { signal }) => {
      signals.push(signal);
      return new Promise((resolve) =>
        pending.push(() =>
          resolve(
            response(
              url === NOAA_AURORA_URLS.ovation
                ? grid()
                : url === NOAA_AURORA_URLS.kp
                  ? kp
                  : [],
            ),
          ),
        ),
      );
    },
  });
  const a = f.request(),
    b = f.request();
  a.res.emit('close');
  await a.done;
  assert.equal(a.res.body, undefined);
  assert.ok(signals.every((signal) => !signal.aborted));
  pending.forEach((resolve) => resolve());
  assert.equal((await b.done).body.unavailable, false);
  f.setNow(NOW + 6 * 60_000);
  const c = f.request();
  c.res.emit('close');
  await c.done;
  assert.ok(signals.slice(3).every((signal) => signal.aborted));
  assert.equal(c.res.listenerCount('close'), 0);
});
test('preview registers the same keyless route', () => {
  const f = fixture();
  let route;
  f.plugin.configurePreviewServer({
    middlewares: {
      use: (value) => {
        route = value;
      },
    },
  });
  assert.equal(route, '/api/aurora');
});

test('the next predicted Kp interval is available without fabricating a current prediction', async () => {
  const future = [{ ...kp[0], time_tag: '2026-10-06T03:00:00' }];
  const f = fixture({
    fetchImpl: async (url) =>
      response(
        url === NOAA_AURORA_URLS.ovation
          ? grid()
          : url === NOAA_AURORA_URLS.kp
            ? future
            : [],
      ),
  });
  assert.equal(
    (await f.request().done).body.kp.current.time,
    '2026-10-06T03:00:00.000Z',
  );
});

test('supplement failure does not discard a valid OVATION forecast', async () => {
  const f = fixture({
    fetchImpl: async (url) =>
      url === NOAA_AURORA_URLS.ovation
        ? response(grid())
        : new Response('unavailable', { status: 503 }),
  });
  const { body } = await f.request().done;
  assert.equal(body.unavailable, false);
  assert.equal(body.kp.unavailable, true);
  assert.equal(body.geomagnetic.unavailable, true);
});

test('labelled cancelled warnings suppress earlier active notices', () => {
  const active = warning(warningText);
  const cancelled = warning(
    'CANCELLED WARNING: Geomagnetic K-index of 5 expected\nValid From: 2026 Oct 06 0000 UTC\nValid To: 2026 Oct 06 0300 UTC\nNOAA Scale: G1 - Minor',
    'K05W',
    '2026-10-06 00:25:00.000',
  );
  assert.deepEqual(normalizeGeomagneticAlerts([active, cancelled], NOW), []);
});

test('extended warning validity supersedes the original end time', () => {
  const extended = warning(
    warningText + '\nNow Valid Until: 2026 Oct 06 0600 UTC',
  );
  const alerts = normalizeGeomagneticAlerts([extended], NOW);
  assert.equal(alerts[0].validUntil, '2026-10-06T06:00:00.000Z');
});
