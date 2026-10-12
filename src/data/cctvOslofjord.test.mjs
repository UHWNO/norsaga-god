import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OSLOFJORD_CAMERAS } from '../../server/providers/cctv/oslofjord.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';
import { createSnapshotCache } from '../../server/providers/cctv/snapshot-cache.js';
import { fetchCctvImageFromUpstream } from '../../server/providers/cctv/media.js';

test('Oslofjord pack includes operator-published views and never claims surveyed poses or a video feed', () => {
  assert.equal(OSLOFJORD_CAMERAS.length, 14);
  assert.equal(new Set(OSLOFJORD_CAMERAS.map((c) => c.id)).size, 14);
  assert.equal(OSLOFJORD_CAMERAS.filter((c) => c.city === 'Oslo').length, 3);
  assert.equal(OSLOFJORD_CAMERAS.filter((c) => c.city === 'Drammen').length, 8);
  assert.equal(OSLOFJORD_CAMERAS.filter((c) => c.city === 'Drøbak').length, 3);
  assert.ok(
    OSLOFJORD_CAMERAS.every(
      (c) =>
        c.feedType === 'image' &&
        c.headingConfidence === 'low' &&
        c.poseSource === undefined &&
        /Approximate/.test(c.locationNote),
    ),
  );
  assert.equal(
    OSLOFJORD_CAMERAS.find((c) => c.id === 'drammen-port-kattegat').url,
    'https://tsftp.no/drammen/k1/snapshot_Pos20.jpg',
  );
  assert.ok(
    OSLOFJORD_CAMERAS.every(
      (c) => /^https:\/\//.test(c.url) && /^https:\/\//.test(c.sourcePageUrl),
    ),
  );
});

test('harbor snapshots share one request per source cadence, retry honestly after failure, and keep last good pixels', async () => {
  let time = 1_000,
    calls = 0,
    fail = false;
  const image = {
    ok: true,
    body: Buffer.from('frame'),
    contentType: 'image/jpeg',
    imageUpdatedAt: 500,
  };
  const cache = createSnapshotCache(
    async () => {
      calls++;
      await Promise.resolve();
      return fail ? null : image;
    },
    { now: () => time },
  );
  const camera = OSLOFJORD_CAMERAS.at(-1);
  const requests = await Promise.all(
    Array.from({ length: 10 }, () => cache.get(camera, camera.url)),
  );
  assert.equal(calls, 1);
  assert.ok(requests.every((r) => r === image));
  time += 599_999;
  await cache.get(camera, camera.url);
  assert.equal(calls, 1);
  time += 1;
  fail = true;
  const stale = await cache.get(camera, camera.url);
  assert.equal(calls, 2);
  assert.equal(stale.refreshFailed, true);
  assert.equal(stale.imageUpdatedAt, 500);
  assert.equal(stale.body, image.body);
  time += 20_000;
  await cache.get(camera, camera.url);
  assert.equal(calls, 2);
  time += 10_000;
  fail = false;
  const recovered = await cache.get(camera, camera.url);
  assert.equal(calls, 3);
  assert.equal(recovered.refreshFailed, undefined);
});

test('snapshot cache leaves other providers unchanged and bounds retained image bytes', async () => {
  let calls = 0;
  const cache = createSnapshotCache(async () => {
    calls++;
    return { ok: true, body: Buffer.alloc(9 * 1024 * 1024) };
  });
  await cache.get(
    { id: 'legacy', sourceKind: 'configured' },
    'https://example.org/frame.jpg',
  );
  await cache.get(
    { id: 'legacy', sourceKind: 'configured' },
    'https://example.org/frame.jpg',
  );
  assert.equal(
    calls,
    2,
    'existing providers are not cached by the new pack policy',
  );
  await cache.get(OSLOFJORD_CAMERAS[0], OSLOFJORD_CAMERAS[0].url);
  await cache.get(OSLOFJORD_CAMERAS[1], OSLOFJORD_CAMERAS[1].url);
  await cache.get(OSLOFJORD_CAMERAS[0], OSLOFJORD_CAMERAS[0].url);
  assert.equal(
    calls,
    5,
    'oldest image was evicted instead of exceeding 16 MiB',
  );
});

test('upstream modification time is retained; missing or invalid dates never become fetch-time image timestamps', async () => {
  const fetchImpl = async () =>
    new Response(Buffer.from('frame'), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Last-Modified': 'Mon, 12 Oct 2026 18:00:00 GMT',
      },
    });
  const image = await fetchCctvImageFromUpstream(
    'https://example.org/frame.jpg',
    { fetchImpl },
  );
  assert.equal(image.imageUpdatedAt, Date.parse('2026-10-12T18:00:00Z'));
  for (const value of ['not-a-date', 'Mon, 12 Oct 2099 18:00:00 GMT', '']) {
    const result = await fetchCctvImageFromUpstream(
      'https://example.org/frame.jpg',
      {
        fetchImpl: async () =>
          new Response(Buffer.from('frame'), {
            headers: { 'Content-Type': 'image/jpeg', 'Last-Modified': value },
          }),
      },
    );
    assert.equal(result.imageUpdatedAt, undefined);
  }
});

test('catalog adds the harbor pack alongside an existing road provider and honors its own kill switch', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norsaga-harbor-'));
  const saved = { ...process.env },
    nativeFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(directory, { recursive: true, force: true });
  });
  delete process.env.CCTV_SOURCES_JSON;
  process.env.CCTV_SOURCES_FILE = join(directory, 'absent.json');
  process.env.CCTV_FORCE_AUSTIN = '1';
  process.env.CCTV_OSLOFJORD_ENABLED = '1';
  process.env.CCTV_VEGVESEN_ENABLED = '1';
  process.env.CCTV_MAX_SOURCES = '1000';
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        String(url).includes('vegvesen')
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [10.73, 59.91] },
                  properties: {
                    cameraId: '3000063_1',
                    name: 'Road Camera',
                    stillImageUrl:
                      'https://kamera.atlas.vegvesen.no/api/images/3000063_1',
                    'status.stillImageAvailability': 'videoOrImagesAvailable',
                  },
                },
              ],
            }
          : {},
      ),
      { headers: { 'content-type': 'application/json' } },
    );
  const sources = await createCctvCatalog({ sourceRoot: directory })();
  assert.equal(sources.filter((c) => c.pack === 'oslofjord').length, 14);
  assert.ok(
    sources.some((c) => c.pack === 'vegvesen'),
    'road cameras remain available',
  );
  process.env.CCTV_OSLOFJORD_ENABLED = '0';
  const without = await createCctvCatalog({ sourceRoot: directory })();
  assert.equal(without.filter((c) => c.pack === 'oslofjord').length, 0);
  assert.ok(without.some((c) => c.pack === 'vegvesen'));
});
