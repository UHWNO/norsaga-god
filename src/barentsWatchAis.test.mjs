import assert from 'node:assert/strict';
import test from 'node:test';
import {
  barentsWatchRows,
  ensureBarentsWatchSnapshot,
  fetchBarentsWatchTrack,
  normalizeBarentsWatchVessel,
  resetBarentsWatchForTests,
} from '../server/providers/vessels/barentswatch.js';
import {
  mergeAisProviderRows,
  mergeAisTrackSamples,
} from '../server/providers/vessels/ais-live.js';

function credentials(t) {
  const original = {
    id: process.env.BARENTSWATCH_AIS_CLIENT_ID,
    secret: process.env.BARENTSWATCH_AIS_CLIENT_SECRET,
  };
  process.env.BARENTSWATCH_AIS_CLIENT_ID = 'fixture-client';
  process.env.BARENTSWATCH_AIS_CLIENT_SECRET = 'fixture-secret';
  resetBarentsWatchForTests();
  t.after(() => {
    if (original.id === undefined)
      delete process.env.BARENTSWATCH_AIS_CLIENT_ID;
    else process.env.BARENTSWATCH_AIS_CLIENT_ID = original.id;
    if (original.secret === undefined)
      delete process.env.BARENTSWATCH_AIS_CLIENT_SECRET;
    else process.env.BARENTSWATCH_AIS_CLIENT_SECRET = original.secret;
    resetBarentsWatchForTests();
  });
}

test('BarentsWatch vessel normalization preserves full AIS provenance', () => {
  const row = normalizeBarentsWatchVessel({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.75, 59.91] },
    properties: {
      mmsi: 257000001,
      name: 'NORSAGA TEST',
      msgtime: '2026-09-25T12:00:00Z',
      speedOverGround: 12.5,
      courseOverGround: 180,
      trueHeading: 179,
      imoNumber: 9876543,
      shipType: 70,
      destination: 'OSLO',
      stream: 'satellite',
    },
  });
  assert.equal(row.mmsi, '257000001');
  assert.equal(row.imo, '9876543');
  assert.equal(row.provider, 'BarentsWatch');
  assert.equal(row.stream, 'satellite');
  assert.deepEqual(row.sources, ['BarentsWatch']);
});

test('BarentsWatch snapshot obtains one OAuth token, caches rows and serves tracks', async (t) => {
  credentials(t);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/connect/token')) {
      const body = String(options.body);
      assert.match(body, /grant_type=client_credentials/);
      assert.match(body, /scope=ais/);
      return Response.json({ access_token: 'fixture-token', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    if (String(url).includes('/latest/combined')) {
      return Response.json([
        {
          mmsi: 257000001,
          latitude: 59.91,
          longitude: 10.75,
          msgtime: '2026-09-25T12:00:00Z',
          name: 'NORSAGA TEST',
          stream: 'terra',
        },
      ]);
    }
    if (String(url).includes('/trackslast24hours/257000001')) {
      return Response.json([
        {
          mmsi: 257000001,
          latitude: 59.9,
          longitude: 10.7,
          msgtime: '2026-09-25T11:00:00Z',
        },
      ]);
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const now = () => Date.parse('2026-09-25T12:00:30Z');
  const first = await ensureBarentsWatchSnapshot({ fetchImpl, now });
  assert.equal(first.status, 'live');
  assert.equal(barentsWatchRows()[0].stream, 'terra');
  await ensureBarentsWatchSnapshot({ fetchImpl, now });
  assert.equal(calls.filter((call) => call.url.includes('/latest/')).length, 1);
  const track = await fetchBarentsWatchTrack('257000001', { fetchImpl, now });
  assert.equal(track.length, 1);
  assert.equal(
    calls.filter((call) => call.url.includes('/connect/token')).length,
    1,
  );
});

test('AIS provider merge de-duplicates by MMSI, keeps newest fix and enriches fields', () => {
  const rows = mergeAisProviderRows(
    [
      {
        mmsi: '257000001',
        lat: 59,
        lon: 10,
        name: 'AISSTREAM NAME',
        imo: '',
        last_position_epoch: 100,
      },
    ],
    [
      {
        mmsi: '257000001',
        lat: 60,
        lon: 11,
        name: '',
        imo: '9876543',
        last_position_epoch: 200,
        provider: 'BarentsWatch',
        sources: ['BarentsWatch'],
      },
    ],
    100,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lat, 60);
  assert.equal(rows[0].name, 'AISSTREAM NAME');
  assert.equal(rows[0].imo, '9876543');
  assert.deepEqual(
    new Set(rows[0].sources),
    new Set(['AISStream', 'BarentsWatch']),
  );
});

test('AIS track merge is chronological and removes duplicate samples', () => {
  assert.deepEqual(
    mergeAisTrackSamples(
      [{ lat: 59, lon: 10, t: 2 }],
      [
        { lat: 58, lon: 9, t: 1 },
        { lat: 59, lon: 10, t: 2 },
      ],
    ),
    [
      { lat: 58, lon: 9, t: 1 },
      { lat: 59, lon: 10, t: 2 },
    ],
  );
});
