import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  auroraAnimationProxy,
  normalizeAuroraFrames,
} from '../../server/providers/auroraAnimation.js';
const NOW = Date.parse('2026-10-06T00:30:00Z');
const rows = (hemisphere = 'north') => [
  {
    url: `/images/animations/ovation/${hemisphere}/aurora_${hemisphere === 'north' ? 'N' : 'S'}_2026-10-06_0025.jpg`,
    time_tag: '2026-10-06T00:25:00Z',
  },
];
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
function fixture(options) {
  let handler;
  auroraAnimationProxy(options).configureServer({
    middlewares: {
      use: (route, fn) => {
        assert.equal(route, '/api/aurora-animation');
        handler = fn;
      },
    },
  });
  const start = (url, method = 'GET') => {
    const res = new EventEmitter();
    res.writeHead = (status, headers) => {
      res.status = status;
      res.headers = headers;
    };
    res.end = (body) => {
      res.body = body;
    };
    const done = handler({ url, method }, res);
    return { res, done };
  };
  return {
    start,
    async request(url, method) {
      const value = start(url, method);
      await value.done;
      return value.res;
    },
  };
}
test('manifest accepts both hemispheres and rejects arbitrary upstreams, duplicate/invalid/old frames', () => {
  for (const hemisphere of ['north', 'south']) {
    const frames = normalizeAuroraFrames(rows(hemisphere), hemisphere, NOW);
    assert.equal(
      frames[0].url,
      `/api/aurora-animation/${hemisphere}/frame/2026-10-06T00:25:00.000Z`,
    );
  }
  for (const value of [
    [],
    [...rows(), ...rows()],
    [{ ...rows()[0], url: 'https://evil.test/image.jpg' }],
    [{ ...rows()[0], time_tag: '2026-02-30T00:25:00Z' }],
    [{ ...rows()[0], time_tag: '2026-10-06T00:25:01Z' }],
  ])
    assert.throws(() => normalizeAuroraFrames(value, 'north', NOW));
  assert.throws(() =>
    normalizeAuroraFrames(rows(), 'north', NOW + 27 * 3600_000),
  );
});
test('proxy is lazy, validates routes, exposes only same-origin frames and caches JPEGs', async () => {
  const calls = [];
  const f = fixture({
    now: () => NOW,
    fetchImpl: async (url) => {
      calls.push(url);
      return url.endsWith('.json')
        ? json(rows())
        : new Response(new Uint8Array([255, 216, 255, 1]), {
            headers: { 'Content-Type': 'image/jpeg' },
          });
    },
  });
  assert.equal(calls.length, 0);
  for (const url of [
    '/north?url=https://evil.test',
    '/north/frame/latest.jpg',
    '/west',
    '/north/frame/2026-10-06T00:24:00.000Z',
  ])
    assert.notEqual((await f.request(url)).status, 200);
  assert.equal((await f.request('/north', 'POST')).status, 405);
  const index = JSON.parse((await f.request('/north')).body);
  assert.equal(index.frames[0].url.startsWith('/api/aurora-animation/'), true);
  const path = '/north/frame/2026-10-06T00:25:00.000Z';
  const image = await f.request(path);
  assert.equal(image.status, 200);
  assert.equal(image.headers['Content-Type'], 'image/jpeg');
  await f.request(path);
  assert.equal(calls.filter((url) => url.endsWith('.jpg')).length, 1);
  assert.ok(
    calls.every((url) => url.startsWith('https://services.swpc.noaa.gov/')),
  );
});
test('history falls back briefly with a stale label, then expires', async () => {
  let time = NOW,
    broken = false;
  const f = fixture({
    now: () => time,
    fetchImpl: async () => {
      if (broken) throw Error('offline');
      return json(rows());
    },
  });
  assert.equal(JSON.parse((await f.request('/north')).body).stale, false);
  broken = true;
  time += 3 * 60_000;
  assert.equal(JSON.parse((await f.request('/north')).body).stale, true);
  time += 13 * 60_000;
  assert.equal((await f.request('/north')).status, 503);
});
test('coalesced viewers cancel independently; last viewer aborts and timeout settles uncooperative transport', async () => {
  let signal,
    resolve,
    calls = 0;
  const f = fixture({
    now: () => NOW,
    fetchImpl: (_url, options) => {
      calls++;
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const a = f.start('/north'),
    b = f.start('/north');
  await Promise.resolve();
  a.res.emit('close');
  await a.done;
  assert.equal(signal.aborted, false);
  resolve(json(rows()));
  await b.done;
  assert.equal(b.res.status, 200);
  assert.equal(calls, 1);
  const alone = f.start('/south');
  await Promise.resolve();
  alone.res.emit('close');
  await alone.done;
  assert.equal(signal.aborted, true);
  const slow = fixture({
    now: () => NOW,
    timeoutMs: 5,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.equal((await slow.request('/north')).status, 503);
});
test('oversized manifests, invalid JPEGs and oversized streamed frames never become successful responses', async () => {
  const big = fixture({
    now: () => NOW,
    fetchImpl: async () =>
      new Response('[]', {
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '999999',
        },
      }),
  });
  assert.equal((await big.request('/north')).status, 503);
  for (const image of [
    new Response('bad', { headers: { 'Content-Type': 'image/jpeg' } }),
    new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
      headers: { 'Content-Type': 'image/jpeg' },
    }),
  ]) {
    const f = fixture({
      now: () => NOW,
      fetchImpl: async (url) => (url.endsWith('.json') ? json(rows()) : image),
    });
    assert.equal(
      (await f.request('/north/frame/2026-10-06T00:25:00.000Z')).status,
      503,
    );
  }
});
