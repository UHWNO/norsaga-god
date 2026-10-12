import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARBOR_CAMERAS } from '../../server/providers/cctv/harbors.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';

test('new harbor sources merge with existing Oslofjord sources and can be disabled independently', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gev-harbor-pack-'));
  const original = { ...process.env };
  t.after(async () => {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await rm(root, { recursive: true, force: true });
  });
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('unavailable', { status: 503 }),
  );
  delete process.env.CCTV_SOURCES_JSON;
  process.env.CCTV_SOURCES_FILE = join(root, 'sources.json');
  process.env.CCTV_FORCE_AUSTIN = '1';
  process.env.CCTV_MAX_SOURCES = '1000';
  process.env.CCTV_OSLOFJORD_ENABLED = '1';
  process.env.CCTV_HARBORS_ENABLED = '1';
  const combined = await createCctvCatalog({ sourceRoot: root })();
  assert.equal(
    combined.filter((c) => c.pack === 'harbors').length,
    HARBOR_CAMERAS.length,
  );
  assert.equal(combined.filter((c) => c.pack === 'oslofjord').length, 14);
  assert.equal(new Set(combined.map((c) => c.id)).size, combined.length);
  assert.ok(
    combined
      .filter((c) => c.pack === 'harbors')
      .every(
        (c) =>
          c.feedType === 'image' &&
          c.sourceKind === 'public-harbor' &&
          c.headingConfidence === 'low',
      ),
  );
  process.env.CCTV_HARBORS_ENABLED = '0';
  const disabled = await createCctvCatalog({ sourceRoot: root })();
  assert.equal(disabled.filter((c) => c.pack === 'harbors').length, 0);
  assert.equal(disabled.filter((c) => c.pack === 'oslofjord').length, 14);
  // An explicitly configured catalog retains the existing custom-only behavior.
  process.env.CCTV_HARBORS_ENABLED = '1';
  process.env.CCTV_FORCE_AUSTIN = '0';
  await writeFile(
    process.env.CCTV_SOURCES_FILE,
    JSON.stringify([
      {
        id: 'custom-harbor',
        name: 'Custom Harbor',
        lat: 59,
        lon: 10,
        url: 'https://example.org/frame.jpg',
        feedType: 'image',
      },
    ]),
  );
  assert.deepEqual(
    (await createCctvCatalog({ sourceRoot: root })()).map((c) => c.id),
    ['custom-harbor'],
  );
});
