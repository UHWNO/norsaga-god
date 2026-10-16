import test from 'node:test';
import * as Cesium from 'cesium';
import assert from 'node:assert/strict';
import {
  ENERGY_SOURCES,
  createEnergyProvider,
  normalizeEnergy,
  energyStatus,
  offshoreEnergyProxy,
} from '../../../server/providers/offshoreEnergy.js';
import { createOffshoreEnergySource } from './source.js';
import { createOffshoreEnergyLayer, matchesEnergy } from './index.js';
import {
  createDefaultLayerState,
  encodeLayerStateParams,
  decodeLayerStateParams,
  LAYER_STATE_TOKEN_RESERVATIONS,
} from '../../data/layerState.js';
const point = (properties, lon = 3, lat = 60) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: [lon, lat] },
});
const polygon = (properties) => ({
  type: 'Feature',
  properties,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [2, 55],
        [3, 55],
        [3, 56],
        [2, 55],
      ],
    ],
  },
});
const collection = (features) =>
  Response.json({
    type: 'FeatureCollection',
    features,
    numberMatched: features.length,
  });
const fixtureFetch = async (url) => {
  const u = new URL(url),
    type = u.searchParams.get('typeNames');
  if (u.hostname === 'factmaps.sodir.no')
    return collection([
      point({
        fclName: 'TROLL A',
        fclNpdidFacility: 1,
        fclPhase: 'IN SERVICE',
        fclSurface: 'Y',
      }),
    ]);
  if (u.hostname === 'services-eu1.arcgis.com')
    return collection([
      point({ NAME: 'ANASURIA', FEATURE_ID: 'uk-1', STATUS: 'ACTIVE' }),
    ]);
  if (type === 'emodnet:platforms')
    return collection([
      point({
        name: 'Duplicate Norway',
        country: 'Norway',
        current_status: 'Operational',
      }),
      point({
        name: 'Tyra',
        country: 'Denmark',
        current_status: 'Operational',
      }),
    ]);
  const props = {
    name: 'Wind Park',
    country: 'Denmark',
    status: 'Production',
    power_mw: 100,
    n_turbines: 10,
  };
  return collection([
    type === 'emodnet:windfarmspoly' ? polygon(props) : point(props),
  ]);
};

test('normalization preserves reported status, source dates and zero values, excluding land and invalid locations', () => {
  const source = ENERGY_SOURCES[0];
  const row = normalizeEnergy(
    point({
      fclName: '<b>Troll</b>',
      fclPhase: 'SHUT DOWN',
      fclSurface: 'N',
      fclWaterDepth: 0,
      fclDateUpdated: 1700000000000,
    }),
    source,
  );
  assert.equal(row.status, 'retired');
  assert.equal(row.name, '<b>Troll</b>');
  assert.equal(row.waterDepthM, 0);
  assert.equal(row.subsea, true);
  assert.equal(row.recordUpdated, '2023-11-14');
  assert.equal(energyStatus('Test site'), 'unknown');
  assert.equal(energyStatus('NOT IN USE'), 'retired');
  assert.equal(energyStatus('Construction'), 'planned');
  for (const feature of [
    point({ fclName: 'Land', fclKind: 'ONSHORE FACILITY' }),
    point({ fclName: 'Bad' }, 200),
    point({ fclName: 'Outside Europe' }, -80, 20),
    point({ fclName: 'NaN' }, NaN),
  ])
    assert.equal(normalizeEnergy(feature, source), null);
});

test('national oil records take precedence and wind points merge with farm polygons', async () => {
  const provider = createEnergyProvider({ fetchImpl: fixtureFetch });
  const oil = await provider.getSnapshot('oil');
  assert.deepEqual(
    oil.records.map((r) => r.name),
    ['TROLL A', 'ANASURIA', 'Tyra'],
  );
  assert.equal(oil.partial, false);
  const wind = await provider.getSnapshot('wind');
  assert.equal(wind.records.length, 1);
  assert.equal(wind.records[0].geometry.type, 'Polygon');
  assert.equal(wind.records[0].capacityMW, 100);
});

test('failed national sources use marked EMODnet coverage, caches coalesce and expire instead of claiming live data', async () => {
  let clock = 1700000000000,
    calls = 0,
    failed = false;
  const provider = createEnergyProvider({
    now: () => clock,
    fetchImpl: async (url) => {
      calls++;
      if (failed || new URL(url).hostname === 'factmaps.sodir.no')
        throw new Error('private upstream error');
      return fixtureFetch(url);
    },
  });
  const [a, b] = await Promise.all([
    provider.getSnapshot('oil'),
    provider.getSnapshot('oil'),
  ]);
  assert.equal(calls, 3);
  assert.equal(a.partial, true);
  assert.equal(
    b.records.some((r) => r.name === 'Duplicate Norway'),
    true,
  );
  assert.equal(a.sources[0].available, false);
  assert.equal(
    a.records.find((r) => r.name === 'Duplicate Norway').sourceRevision,
    '2024-02-16',
  );
  failed = true;
  clock += 7 * 3600_000;
  const cached = await provider.getSnapshot('oil');
  assert.equal(cached.stale, true);
  assert.ok(cached.records.length);
  clock += 8 * 86400_000;
  const expired = await provider.getSnapshot('oil');
  assert.equal(expired.unavailable, true);
  assert.deepEqual(expired.records, []);
  assert.equal(
    JSON.stringify(expired).includes('private upstream error'),
    false,
  );
});

test('ArcGIS and WFS pagination retain records after the first 1000', async () => {
  let pages = [];
  const provider = createEnergyProvider({
    fetchImpl: async (url) => {
      const u = new URL(url);
      const offset = Number(
        u.searchParams.get('resultOffset') || u.searchParams.get('startIndex'),
      );
      pages.push(offset);
      const features = Array.from({ length: offset ? 1 : 1000 }, (_, i) =>
        point({
          name: `Site ${offset + i}`,
          fclName: `Site ${offset + i}`,
          fclNpdidFacility: offset + i + 1,
          country: 'Denmark',
          status: 'Production',
          fclPhase: 'IN SERVICE',
        }),
      );
      return Response.json({
        type: 'FeatureCollection',
        features,
        numberMatched: 1001,
      });
    },
  });
  const result = await provider.getSnapshot('oil');
  assert.ok(result.records.some((r) => r.name === 'Site 1000'));
  assert.equal(pages.filter((p) => p === 1000).length, 3);
});

test('bad source bodies do not become authoritative empty snapshots and client acquisition stays same-origin', async () => {
  const result = await createEnergyProvider({
    fetchImpl: async () => Response.json({ error: 'bad' }),
  }).getSnapshot('wind');
  assert.equal(result.unavailable, true);
  const source = createOffshoreEnergySource({
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/offshore-energy?kind=wind');
      assert.equal(options.credentials, 'same-origin');
      return Response.json(result);
    },
  });
  assert.deepEqual(await source.getSnapshot('wind'), result);
  await assert.rejects(
    createOffshoreEnergySource({
      fetchImpl: async () => Response.json({}, { status: 401 }),
    }).getSnapshot('wind'),
    /Sign in again/,
  );
});

test('operating defaults exclude retired, planned, unknown and subsea records; filters and search work together', () => {
  const defaults = { status: 'operational', subsea: false };
  const record = {
    name: 'Troll A',
    operator: 'Equinor',
    country: 'Norway',
    status: 'operational',
    subsea: false,
  };
  assert.equal(matchesEnergy(record, defaults, 'EQUINOR'), true);
  assert.equal(
    matchesEnergy({ ...record, status: 'retired' }, defaults),
    false,
  );
  assert.equal(matchesEnergy({ ...record, subsea: true }, defaults), false);
  assert.equal(
    matchesEnergy(
      { ...record, status: 'planned', subsea: true },
      { status: 'all', subsea: true },
    ),
    true,
  );
});

test('offshore state has unique reserved tokens and independent durable status filters', () => {
  assert.equal(LAYER_STATE_TOKEN_RESERVATIONS.aurora, '3');
  assert.equal(LAYER_STATE_TOKEN_RESERVATIONS['street-level'], '0');
  const state = createDefaultLayerState();
  state.enabledLayerIds = ['offshore-oil-gas', 'offshore-wind'];
  state.options['offshore-oil-gas'] = { status: 'retired', subsea: true };
  state.options['offshore-wind'] = { status: 'planned' };
  const params = new URLSearchParams('v=2');
  encodeLayerStateParams(params, state);
  const restored = decodeLayerStateParams(params);
  assert.equal(restored.options['offshore-oil-gas'].status, 'retired');
  assert.equal(restored.options['offshore-wind'].status, 'planned');
});

test('layer selection, status filtering and destruction release scene resources and late requests', async () => {
  let click,
    flights = 0,
    handlers = 0;
  const dataSources = new Set();
  const C = {
    ...Cesium,
    ScreenSpaceEventHandler: class {
      constructor() {
        handlers++;
      }
      setInputAction(fn) {
        click = fn;
      }
      destroy() {
        handlers--;
      }
    },
  };
  const viewer = {
    dataSources: {
      add: (ds) => dataSources.add(ds),
      remove: (ds) => dataSources.delete(ds),
    },
    scene: {
      canvas: {},
      requestRender() {},
      pick() {
        return { id: [...dataSources][0].entities.values[0] };
      },
    },
    camera: {
      flyTo() {
        flights++;
      },
    },
  };
  const picking = {
    registerPickOwner() {},
    unregisterPickOwner() {},
    resolvePickId: (p) => p.id.id,
  };
  const source = ENERGY_SOURCES[0];
  const records = [
    normalizeEnergy(
      point({ fclName: 'Operating', fclPhase: 'IN SERVICE' }),
      source,
    ),
    normalizeEnergy(point({ fclName: 'Planned', fclPhase: 'FUTURE' }), source),
  ];
  let finish;
  const layer = createOffshoreEnergyLayer({
    kind: 'oil',
    cesium: C,
    picking,
    feed: {
      getSnapshot: async () => ({
        records,
        sources: [],
        fetchedAt: 1700000000000,
      }),
    },
  });
  layer.init(viewer);
  layer.enable();
  await layer.update(viewer);
  assert.equal(layer.getStats().count, 1);
  assert.equal(handlers, 1);
  click({ position: {} });
  assert.equal(layer.getReadout().selected.name, 'Operating');
  assert.equal(flights, 0);
  layer.setParams({ status: 'planned' });
  assert.equal(layer.getReadout().selected, null);
  assert.equal(layer.search('planned').length, 1);
  assert.equal(layer.select(records[1].id), true);
  assert.equal(flights, 1);
  layer.disable();
  assert.equal(layer.getDiagnostics().entities, 0);
  assert.equal(handlers, 0);
  layer.destroy();
  assert.equal(dataSources.size, 0);
  const late = createOffshoreEnergyLayer({
    kind: 'oil',
    cesium: C,
    picking,
    feed: { getSnapshot: () => new Promise((resolve) => (finish = resolve)) },
  });
  late.init(viewer);
  late.enable();
  const pending = late.update(viewer);
  late.disable();
  finish({ records, sources: [] });
  assert.equal(await pending, false);
  assert.equal(late.getStats().count, 0);
  late.destroy();
  assert.equal(dataSources.size, 0);
  assert.equal(handlers, 0);
});

test('repeated cached reads do not grow merged wind polygons or lose known point details', async () => {
  const provider = createEnergyProvider({
    fetchImpl: async (url) => {
      const type = new URL(url).searchParams.get('typeNames');
      return collection(
        type === 'emodnet:windfarms'
          ? [
              point({
                name: 'WIND PARK',
                country: 'Denmark',
                status: 'Production',
                power_mw: 100,
              }),
            ]
          : [
              polygon({
                name: 'Wind Park',
                country: 'Denmark',
                status: 'Production',
              }),
              polygon({
                name: 'Wind Park',
                country: 'Denmark',
                status: 'Production',
              }),
            ],
      );
    },
  });
  const first = await provider.getSnapshot('wind');
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0].capacityMW, 100);
  assert.equal(first.records[0].geometry.coordinates.length, 2);
  for (let i = 0; i < 4; i++)
    assert.deepEqual(
      (await provider.getSnapshot('wind')).records,
      first.records,
    );
});

test('conflicting published farm statuses stay separate instead of overwriting operating assets', async () => {
  const provider = createEnergyProvider({
    fetchImpl: async (url) =>
      collection([
        new URL(url).searchParams.get('typeNames') === 'emodnet:windfarms'
          ? point({
              name: 'Wind Park',
              country: 'Denmark',
              status: 'Production',
            })
          : polygon({
              name: 'Wind Park',
              country: 'Denmark',
              status: 'Planned',
            }),
      ]),
  });
  const result = await provider.getSnapshot('wind');
  assert.deepEqual(result.records.map((r) => r.status).sort(), [
    'operational',
    'planned',
  ]);
});

test('provider route rejects invalid kinds and methods before fetching a fixed source', async () => {
  let handler,
    calls = 0;
  offshoreEnergyProxy({
    fetchImpl: async (url) => {
      calls++;
      return fixtureFetch(url);
    },
  }).configureServer({
    middlewares: {
      use(_path, fn) {
        handler = fn;
      },
    },
  });
  const request = (method, url) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 200,
        setHeader() {},
        end(body) {
          resolve({ status: this.statusCode, body: JSON.parse(body) });
        },
      };
      void handler({ method, url }, res);
    });
  assert.equal((await request('POST', '/?kind=oil')).status, 405);
  assert.equal((await request('GET', '/?kind=invalid')).status, 400);
  assert.equal(calls, 0);
  const response = await request('GET', '/?kind=wind');
  assert.equal(response.status, 200);
  assert.equal(response.body.records.length, 1);
  assert.equal(calls, 2);
});

test('wind sites preserve the reported update year without inventing a date, and exclude weather masts', () => {
  const source = ENERGY_SOURCES.find((s) => s.id === 'emodnet-wind-points');
  const row = normalizeEnergy(
    point({
      name: 'Wind Park',
      country: 'Denmark',
      status: 'Production',
      updateyear: '2024',
    }),
    source,
  );
  assert.equal(row.recordUpdateYear, '2024');
  assert.equal(row.recordUpdated, null);
  assert.equal(
    normalizeEnergy(
      point({
        name: 'Hornsea Met Mast',
        country: 'United Kingdom',
        status: 'Production',
      }),
      source,
    ),
    null,
  );
});
