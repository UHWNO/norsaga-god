import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuroraSource, validateAuroraSnapshot } from './source.js';
import { createAuroraLayer } from './index.js';
import {
  createAuroraRendering,
  auroraPixels,
  auroraColor,
} from './rendering.js';
const NOW = Date.parse('2026-10-06T00:30:00Z');
const snapshot = (overrides = {}) => ({
  schemaVersion: 1,
  provider: 'NOAA SWPC',
  product: 'OVATION',
  metric: 'relative-intensity',
  range: [0, 100],
  sourceTime: '2026-10-06T00:20:00.000Z',
  forecastTime: '2026-10-06T01:05:00.000Z',
  fetchedAt: NOW,
  stale: false,
  delayed: false,
  unavailable: false,
  reason: null,
  cells: [
    [0, 70, 60],
    [-1, -70, 70],
  ],
  kp: {
    current: {
      time: '2026-10-06T00:00:00.000Z',
      validUntil: '2026-10-06T03:00:00.000Z',
      value: 4.33,
      kind: 'predicted',
      scale: null,
    },
    fetchedAt: NOW,
    stale: false,
    unavailable: false,
  },
  geomagnetic: {
    active: null,
    fetchedAt: NOW,
    stale: false,
    unavailable: false,
  },
  ...overrides,
});
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });

test('source is lazy, bounded, same-origin, and validates the stable internal schema', async () => {
  const calls = [];
  const source = createAuroraSource({
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(snapshot());
    },
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(await source.getSnapshot(), snapshot());
  assert.equal(calls[0][0], '/api/aurora');
  for (const value of [
    null,
    snapshot({ provider: 'other' }),
    snapshot({ cells: [[360, 0, 50]] }),
    snapshot({ cells: [[0, 91, 2]] }),
    snapshot({ cells: [[0, 0, 101]] }),
    snapshot({
      cells: [
        [0, 0, 50],
        [0, 0, 60],
      ],
    }),
    snapshot({ sourceTime: '2026-02-30T00:00:00.000Z' }),
    snapshot({ unavailable: true }),
  ])
    assert.throws(() => validateAuroraSnapshot(value));
  const oversized = createAuroraSource({
    fetchImpl: async () =>
      new Response('[]', {
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '3000000',
        },
      }),
  });
  await assert.rejects(oversized.getSnapshot(), /too large/);
});
test('source timeout, pre-abort, active abort and cancelled body reads settle cleanly', async () => {
  let calls = 0;
  const source = createAuroraSource({
    timeoutMs: 5,
    fetchImpl: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  await assert.rejects(source.getSnapshot(), /timed out/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(source.getSnapshot({ signal: controller.signal }));
  assert.equal(calls, 1);
  const active = new AbortController();
  const pending = source.getSnapshot({ signal: active.signal });
  active.abort();
  await assert.rejects(pending);
  const slowBody = createAuroraSource({
    timeoutMs: 5,
    fetchImpl: async () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  await assert.rejects(slowBody.getSnapshot(), /timed out/);
});
function layerFixture(
  feed = { getSnapshot: async () => snapshot() },
  now = () => NOW,
) {
  const listeners = new Set(),
    frames = [];
  let count = 0;
  const renderer = {
    setSnapshot(value) {
      frames.push(value);
      count = value.cells.length;
      return true;
    },
    clear() {
      count = 0;
    },
    destroy() {
      count = 0;
    },
    getDiagnostics() {
      return { count, primitiveCount: count ? 1 : 0 };
    },
  };
  const doc = {
    hidden: false,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const layer = createAuroraLayer({
    feed,
    now,
    documentRef: doc,
    createRendering: () => renderer,
  });
  layer.init({ scene: {} });
  return { layer, doc, listeners, frames };
}
test('enable/disable is idempotent, manager-polled, and destroys resources and listeners', async () => {
  const f = layerFixture();
  f.layer.enable();
  f.layer.enable();
  assert.equal(f.listeners.size, 1);
  await f.layer.update();
  assert.equal(f.layer.getStats().count, 2);
  assert.match(f.layer.getRowControls().info, /2026-10-06 01:05 UTC/);
  assert.match(f.layer.getRowControls().info, /4.33 predicted/);
  assert.match(f.layer.getRowControls().info, /No active G-level notice/);
  f.layer.disable();
  f.layer.disable();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.layer.getDiagnostics().primitiveCount, 0);
  assert.equal(f.layer.getDiagnostics().requestPending, false);
  f.layer.enable();
  await f.layer.update();
  assert.equal(f.frames.length, 2);
  f.layer.destroy();
  f.layer.destroy();
  assert.equal(f.listeners.size, 0);
  assert.equal(await f.layer.update(), false);
});
test('disable during acquisition discards late results and aborts the source', async () => {
  let resolve, signal;
  const f = layerFixture({
    getSnapshot: (options) => {
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  f.layer.enable();
  const pending = f.layer.update();
  f.layer.disable();
  assert.equal(signal.aborted, true);
  resolve(snapshot());
  assert.equal(await pending, false);
  assert.equal(f.frames.length, 0);
});
test('hidden tabs skip requests, abort pending work and refresh on return', async () => {
  let calls = 0,
    signal;
  const f = layerFixture({
    getSnapshot: async (options) => {
      calls++;
      signal = options.signal;
      return snapshot();
    },
  });
  f.layer.enable();
  f.doc.hidden = true;
  assert.equal(await f.layer.update(), true);
  assert.equal(calls, 0);
  f.doc.hidden = false;
  [...f.listeners][0]();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(signal.aborted, false);
  f.layer.destroy();
});
test('stale, partial and unavailable readouts are honest and failed fetches clear the old overlay', async () => {
  let value = snapshot({
    stale: true,
    kp: { current: null, fetchedAt: null, stale: false, unavailable: true },
  });
  const f = layerFixture({
    getSnapshot: async () => {
      if (value instanceof Error) throw value;
      return value;
    },
  });
  f.layer.enable();
  await f.layer.update();
  assert.match(f.layer.getRowControls().info, /Stale \/ delayed/);
  assert.match(f.layer.getRowControls().info, /Kp: Unavailable/);
  value = new Error('offline');
  await f.layer.update();
  assert.equal(f.layer.getStats().unavailable, true);
  assert.equal(f.layer.getDiagnostics().primitiveCount, 0);
  value = snapshot({
    sourceTime: '2026-10-05T20:00:00.000Z',
    forecastTime: '2026-10-05T21:00:00.000Z',
  });
  await f.layer.update();
  assert.equal(f.layer.getDiagnostics().primitiveCount, 0);
  assert.equal(f.layer.getStats().unavailable, true);
  f.layer.destroy();
});
test('globe readout accepts a current forecast with 90-minute observations and expires by forecast or cache age', async () => {
  let now = NOW;
  let value = snapshot({
    sourceTime: new Date(NOW - 90 * 60_000).toISOString(),
    forecastTime: new Date(NOW).toISOString(),
  });
  const f = layerFixture({ getSnapshot: async () => value }, () => now);
  f.layer.enable();
  await f.layer.update();
  assert.equal(f.layer.getReadout().status, 'Latest forecast');
  assert.equal(f.layer.getReadout().leadMinutes, 90);
  assert.equal(f.layer.getReadout().available, true);
  assert.equal(f.layer.getStats().unavailable, false);
  assert.equal(f.layer.getStats().stale, false);
  assert.equal(f.layer.getDiagnostics().primitiveCount, 1);
  now += 6 * 60_000;
  assert.equal(f.layer.getReadout().status, 'Stale / delayed');
  assert.equal(f.layer.getReadout().available, true);
  now = NOW + 61 * 60_000;
  value = { ...value, fetchedAt: now };
  await f.layer.update();
  assert.equal(f.layer.getReadout().available, false);
  assert.equal(f.layer.getStats().unavailable, true);
  assert.equal(f.layer.getDiagnostics().primitiveCount, 0);
  value = snapshot({
    fetchedAt: NOW,
    forecastTime: new Date(now).toISOString(),
  });
  await f.layer.update();
  assert.equal(f.layer.getReadout().available, false);
  assert.equal(f.layer.getDiagnostics().primitiveCount, 0);
  f.layer.destroy();
});
test('raster keeps hemispheres and clips polar cells, wraps seam and skips zero activity', () => {
  const raster = auroraPixels([
    [0, 70, 60],
    [0, -70, 60],
    [-180, 90, 80],
    [-180, -90, 80],
    [3, 1, 0],
  ]);
  assert.equal(raster.count, 4);
  assert.equal(raster.north, 2);
  assert.equal(raster.south, 2);
  assert.ok(raster.pixels.some((value, i) => i % 4 === 3 && value > 0));
  const seam = auroraPixels([[-180, 0, 80]]);
  assert.ok(seam.pixels[(179 * 720 + 719) * 4 + 3] > 0);
  assert.equal(auroraPixels([]).count, 0);
  assert.ok(
    auroraPixels([
      [0, 0, 0],
      [0, 1, 4],
    ]).pixels.every((value) => value === 0),
  );
  assert.ok(auroraColor(100)[3] < 220);
  assert.ok(auroraColor(20)[3] >= 150);
});
function rendererFixture() {
  class Resource {
    constructor(options) {
      Object.assign(this, options);
      this.dead = false;
    }
    destroy() {
      this.dead = true;
    }
    isDestroyed() {
      return this.dead;
    }
  }
  const material = new Resource({ uniforms: {} });
  const materials = new Map(),
    primitives = new Set();
  const C = {
    Material: {
      DefaultImageId: 'default',
      _materialCache: {
        getMaterial: (type) => materials.get(type),
        addMaterial: (type, value) => materials.set(type, value),
      },
      fromType: () => material,
    },
    Primitive: Resource,
    GeometryInstance: Resource,
    RectangleGeometry: Resource,
    Rectangle: { fromDegrees: (...edges) => edges },
    EllipsoidSurfaceAppearance: Resource,
    BlendingState: { ALPHA_BLEND: {} },
  };
  const viewer = {
    scene: {
      requestRender() {},
      primitives: {
        add: (value) => {
          primitives.add(value);
        },
        remove: (value) => {
          primitives.delete(value);
          value.destroy();
        },
      },
    },
  };
  const createCanvas = () => ({
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    }),
  });
  return {
    renderer: createAuroraRendering({ viewer, cesium: C, createCanvas }),
    primitives,
    material,
  };
}
test('renderer updates a single owned primitive in place and fully releases texture resources', () => {
  const f = rendererFixture();
  f.renderer.setSnapshot(snapshot());
  const first = [...f.primitives][0],
    image = f.material.uniforms.image;
  f.renderer.setSnapshot(snapshot());
  assert.equal([...f.primitives][0], first);
  assert.notEqual(f.material.uniforms.image, image);
  assert.equal(f.renderer.getDiagnostics().primitiveCount, 1);
  f.renderer.destroy();
  f.renderer.destroy();
  assert.equal(f.primitives.size, 0);
  assert.equal(first.dead, true);
  assert.equal(f.material.dead, true);
  assert.equal(f.renderer.getDiagnostics().canvasBytes, 0);
  assert.equal(f.renderer.setSnapshot(snapshot()), false);
});
test('zero activity and aborted snapshots allocate no Cesium resources', () => {
  const f = rendererFixture();
  f.renderer.setSnapshot(snapshot({ cells: [[0, 0, 0]] }));
  assert.equal(f.primitives.size, 0);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    f.renderer.setSnapshot(snapshot(), { signal: controller.signal }),
    false,
  );
  assert.equal(f.primitives.size, 0);
  f.renderer.setSnapshot(snapshot());
  f.renderer.setSnapshot(snapshot({ cells: [] }));
  assert.equal(f.primitives.size, 0);
});

test('a future Kp interval is explicitly labelled upcoming', async () => {
  const value = snapshot();
  value.kp.current.time = '2026-10-06T03:00:00.000Z';
  value.kp.current.validUntil = '2026-10-06T06:00:00.000Z';
  const f = layerFixture({ getSnapshot: async () => value });
  f.layer.enable();
  await f.layer.update();
  assert.match(f.layer.getRowControls().info, /upcoming predicted/);
  f.layer.destroy();
});

test('workspace readout subscribers coexist with the data row and report source-preserving contrast changes', async () => {
  const f = layerFixture();
  let row = 0,
    workspace = 0;
  f.layer.setRowControlsListener(() => row++);
  const unsubscribe = f.layer.subscribeReadout(() => workspace++);
  f.layer.enable();
  await f.layer.update();
  const value = f.layer.getReadout();
  assert.equal(value.available, true);
  assert.equal(value.leadMinutes, 45);
  assert.match(value.kp, /4.33 predicted/);
  assert.equal(value.reading, null);
  f.layer.setParams({ opacity: 0.45 });
  assert.equal(f.layer.getReadout().opacity, 0.45);
  assert.equal(f.frames[0].cells[0][2], 60);
  assert.ok(row > 0 && workspace > 0);
  unsubscribe();
  const before = workspace;
  f.layer.disable();
  assert.equal(workspace, before);
  assert.equal(f.layer.getReadout().available, false);
  assert.equal(f.layer.getReadout().reading, null);
  f.layer.destroy();
});
