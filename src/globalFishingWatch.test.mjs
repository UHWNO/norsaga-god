import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  fetchGlobalFishingWatchIntelligence,
  normalizeGlobalFishingWatchEvents,
  normalizeGlobalFishingWatchVessel,
  resetGlobalFishingWatchForTests,
} from '../server/providers/vessels/global-fishing-watch.js';

const originalToken = process.env.GFW_API_ACCESS_TOKEN;

afterEach(() => {
  resetGlobalFishingWatchForTests();
  if (originalToken === undefined) delete process.env.GFW_API_ACCESS_TOKEN;
  else process.env.GFW_API_ACCESS_TOKEN = originalToken;
});

const vesselPayload = {
  entries: [
    {
      dataset: 'public-global-vessel-identity:v4.0',
      registryInfoTotalRecords: 2,
      selfReportedInfo: [
        {
          id: 'gfw-vessel-id',
          ssvid: '257111020',
          shipname: 'RESEARCH VESSEL',
          flag: 'NOR',
          callsign: 'LAAA',
          transmissionDateTo: '2026-09-20T12:00:00Z',
        },
      ],
      registryInfo: [
        {
          id: 'registry-id',
          ssvid: '257111020',
          shipname: 'RESEARCH VESSEL',
          imo: '9876543',
          flag: 'NOR',
          geartypes: ['trawlers'],
          lengthM: 54.2,
          tonnageGt: 800,
          sourceCode: ['NOR_REGISTRY'],
          latestVesselInfo: true,
        },
      ],
      combinedSourcesInfo: [
        {
          shiptypes: [{ name: 'FISHING' }],
          inferredVesselClassAgNnet: [{ value: 'TRAWLERS' }],
        },
      ],
    },
  ],
};

test('GFW vessel normalization selects the exact MMSI and preserves registry provenance', () => {
  const vessel = normalizeGlobalFishingWatchVessel(vesselPayload, '257111020');
  assert.equal(vessel.id, 'gfw-vessel-id');
  assert.equal(vessel.name, 'RESEARCH VESSEL');
  assert.equal(vessel.flag, 'NOR');
  assert.equal(vessel.gearType, 'trawlers');
  assert.deepEqual(vessel.registrySources, ['NOR_REGISTRY']);
  assert.equal(
    normalizeGlobalFishingWatchVessel(vesselPayload, '111111111'),
    null,
  );
});

test('GFW event normalization labels inferred activity and rejects invalid positions', () => {
  const events = normalizeGlobalFishingWatchEvents({
    entries: [
      {
        id: 'event-1',
        type: 'fishing',
        start: '2026-09-01T00:00:00Z',
        end: '2026-09-01T01:00:00Z',
        position: { lat: 60, lon: 5 },
        regions: { eez: ['NOR'], mpa: [], rfmo: ['NEAFC'] },
      },
      {
        id: 'event-2',
        type: 'gap',
        start: '2026-09-02T00:00:00Z',
        position: { lat: 125, lon: 5 },
      },
    ],
  });
  assert.equal(events[0].type, 'FISHING');
  assert.deepEqual(events[0].position, { lat: 60, lon: 5 });
  assert.deepEqual(events[0].regions.rfmo, ['NEAFC']);
  assert.equal(events[1].position, null);
});

test('GFW intelligence searches identity, requests bounded events and caches the result', async () => {
  process.env.GFW_API_ACCESS_TOKEN = 'fixture-token';
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (parsed.pathname.endsWith('/vessels/search')) {
      return Response.json(vesselPayload);
    }
    return Response.json({
      total: 1,
      entries: [
        {
          id: 'event-1',
          type: 'fishing',
          start: '2026-09-01T00:00:00Z',
          end: '2026-09-01T01:00:00Z',
          position: { lat: 60, lon: 5 },
          vessel: { id: 'gfw-vessel-id' },
        },
      ],
    });
  };
  const now = () => Date.parse('2026-09-25T12:00:00Z');
  const first = await fetchGlobalFishingWatchIntelligence('257111020', {
    fetchImpl,
    now,
  });
  const second = await fetchGlobalFishingWatchIntelligence('257111020', {
    fetchImpl,
    now,
  });
  assert.equal(calls.length, 2);
  assert.equal(first, second);
  assert.equal(first.status, 'available');
  assert.equal(first.eventTotal, 1);
  assert.match(first.caveat, /not proof of wrongdoing/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(calls[0].parsed.searchParams.get('query'), '257111020');
  assert.equal(calls[1].parsed.searchParams.get('start-date'), '2025-09-25');
  assert.equal(
    [...calls[1].parsed.searchParams.keys()].filter((key) =>
      key.startsWith('datasets['),
    ).length,
    5,
  );
});
