import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuroraPlayback } from './auroraPlayback.js';
import { createAuroraGrid } from '../layers/aurora/inspection.js';
import {
  createAuroraAnimationSource,
  validateAnimationIndex,
} from '../layers/aurora/animationSource.js';
const frames = Array.from({ length: 13 }, (_, i) => {
  const time = new Date(
    Date.parse('2026-10-06T00:00:00Z') + i * 5 * 60_000,
  ).toISOString();
  return { time, url: `/api/aurora-animation/north/frame/${time}` };
});
const index = {
  schemaVersion: 1,
  provider: 'NOAA SWPC',
  product: 'OVATION image history',
  hemisphere: 'north',
  fetchedAt: Date.now(),
  stale: false,
  frames,
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
test('grid inspection preserves zero, missing cells, dateline wrapping and both poles', () => {
  const grid = createAuroraGrid([
    [0, 70, 0],
    [-180, -70, 85],
    [20, 90, 7],
  ]);
  assert.equal(grid.sample(0.2, 70.1).value, 0);
  assert.equal(grid.sample(180, -70).value, 85);
  assert.equal(grid.sample(20, 90).value, 7);
  assert.equal(grid.sample(0, 0), null);
  assert.equal(grid.sample(0, 91), null);
});
test('animation source is lazy, bounded and rejects external URLs and unordered/foreign manifests', async () => {
  const calls = [];
  const source = createAuroraAnimationSource({
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(index), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(calls.length, 0);
  await source.getAnimationIndex();
  assert.deepEqual(calls, ['/api/aurora-animation/north']);
  assert.throws(() =>
    source.getAnimationFrame(
      'https://services.swpc.noaa.gov/images/latest.jpg',
    ),
  );
  assert.throws(() =>
    validateAnimationIndex(
      { ...index, frames: [...frames].reverse() },
      'north',
    ),
  );
  assert.throws(() =>
    validateAnimationIndex(
      { ...index, frames: [{ ...frames[0], url: 'https://evil.test/a.jpg' }] },
      'north',
    ),
  );
  const slow = createAuroraAnimationSource({
    timeoutMs: 5,
    fetchImpl: () => new Promise(() => {}),
  });
  await assert.rejects(slow.getAnimationIndex(), /timed out/);
});
test('player uses real frame times, defaults to 30 minutes, supports 24 hours, and only schedules while playing', async () => {
  const shown = [],
    timers = new Map();
  let id = 0;
  const player = createAuroraPlayback({
    source: {
      getAnimationIndex: async () => index,
      getAnimationFrame: async (url) => new Blob([url]),
    },
    onFrame: async (_blob, time) => shown.push(time),
    setTimer: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimer: (key) => timers.delete(key),
  });
  await player.load();
  assert.equal(player.getState().frames.length, 7);
  assert.equal(player.getState().time, frames.at(-1).time);
  assert.equal(timers.size, 0);
  player.play();
  await flush();
  assert.equal(player.getState().time, frames[6].time);
  assert.equal(timers.size, 1);
  player.pause();
  assert.equal(timers.size, 0);
  player.setWindow(1440);
  await flush();
  assert.equal(player.getState().frames.length, 13);
  await player.select(0);
  assert.equal(player.getState().time, frames[0].time);
  player.close();
  assert.equal(timers.size, 0);
  assert.equal(player.getState().frames.length, 0);
  assert.ok(shown.every((time) => frames.some((frame) => frame.time === time)));
});
test('closing or switching hemisphere aborts work and prevents late frame display; failures pause the loop', async () => {
  let pendingSignal,
    resolve,
    shown = 0;
  const player = createAuroraPlayback({
    source: {
      getAnimationIndex: async () => index,
      getAnimationFrame: (_url, { signal }) => {
        pendingSignal = signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
    onFrame: async () => shown++,
  });
  const loading = player.load();
  await flush();
  player.close();
  assert.equal(pendingSignal.aborted, true);
  resolve(new Blob());
  await loading;
  assert.equal(shown, 0);
  const broken = createAuroraPlayback({
    source: {
      getAnimationIndex: async () => index,
      getAnimationFrame: async () => {
        throw Error('offline');
      },
    },
  });
  await broken.load();
  assert.match(broken.getState().error, /offline/);
  assert.equal(broken.getState().playing, false);
  broken.close();
});
