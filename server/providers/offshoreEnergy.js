import { readResponseJsonCapped } from './common/http.js';

const HOUR = 3600_000;
const ROOT =
  'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/MapServer';
const UK =
  'https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS%20offshore%20infrastructure%20surface%20points%20WGS84/FeatureServer/1';
export const ENERGY_SOURCES = Object.freeze([
  {
    id: 'sodir',
    kind: 'oil',
    label: 'Norwegian Offshore Directorate',
    url: `${ROOT}/307/query`,
    format: 'arcgis',
    country: 'Norway',
    link: 'https://www.sodir.no/fakta/data-og-analyser/apne-data/',
  },
  {
    id: 'nsta',
    kind: 'oil',
    label: 'UK North Sea Transition Authority',
    url: `${UK}/query`,
    format: 'arcgis',
    country: 'United Kingdom',
    link: 'https://www.nstauthority.co.uk/data-and-insights/data/themes/infrastructure/',
  },
  {
    id: 'emodnet-oil',
    kind: 'oil',
    label: 'EMODnet / Cogea',
    layer: 'emodnet:platforms',
    revision: '2024-02-16',
    link: 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/ddbe3597-4e3f-4e74-8d31-947c4efef2e9',
  },
  {
    id: 'emodnet-wind-points',
    kind: 'wind',
    label: 'EMODnet / CETMAR',
    layer: 'emodnet:windfarms',
    revision: '2026-07-10',
    link: 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/8201070b-4b0b-4d54-8910-abcea5dce57f',
  },
  {
    id: 'emodnet-wind-areas',
    kind: 'wind',
    label: 'EMODnet / CETMAR',
    layer: 'emodnet:windfarmspoly',
    revision: '2026-07-10',
    link: 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/8201070b-4b0b-4d54-8910-abcea5dce57f',
  },
]);
const text = (v, max = 240) =>
  v == null ? '' : String(v).trim().slice(0, max);
const number = (v) =>
  v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0
    ? Number(v)
    : null;
const date = (v) => {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
};
export function energyStatus(value) {
  const v = text(value).toLowerCase().replaceAll('_', ' ');
  if (/^(active|in service|production|operational|producing)$/.test(v))
    return 'operational';
  if (
    /approved|planned|construction|installation|future|proposed|licensed/.test(
      v,
    )
  )
    return 'planned';
  if (
    /dismantled|removed|closed|decommission|abandon|shut|disused|inactive|out of service|not in use|disposal completed/.test(
      v,
    )
  )
    return 'retired';
  return 'unknown';
}

function geometryInfo(geometry) {
  if (
    !geometry ||
    !['Point', 'Polygon', 'MultiPolygon'].includes(geometry.type)
  )
    return null;
  if (!Array.isArray(geometry.coordinates)) return null;
  const points =
    geometry.type === 'Point'
      ? [geometry.coordinates]
      : geometry.type === 'Polygon'
        ? geometry.coordinates.flat()
        : geometry.coordinates.flat(2);
  if (
    !points.length ||
    points.length > 40000 ||
    points.some(
      (p) =>
        !Array.isArray(p) ||
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1]) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90,
    )
  )
    return null;
  const lons = points.map((p) => p[0]),
    lats = points.map((p) => p[1]);
  const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  return lon >= -20 && lon <= 40 && lat >= 48 && lat <= 82
    ? { lon, lat, geometry }
    : null;
}

/** Preserve published status and dates; never infer that a fetched record is live. */
export function normalizeEnergy(feature, source) {
  const p = feature.properties || {},
    position = geometryInfo(feature.geometry);
  if (/onshore|landfall|wind turbine/i.test(p.fclKind || '')) return null;
  if (
    source.kind === 'wind' &&
    /met\s*mast|meteorological|weather mast/i.test(
      `${p.name || ''} ${p.type_inst || ''}`,
    )
  )
    return null;
  const name = text(p.fclName || p.NAME || p.name);
  if (!position || !name) return null;
  const statusText =
    text(p.fclPhase || p.STATUS || p.current_status || p.status) ||
    'Not reported';
  const country = source.country || text(p.country);
  const key = (value) =>
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const stable =
    source.kind === 'wind'
      ? `${key(country)}:${key(name)}:${energyStatus(statusText)}`
      : `${source.id}:${p.fclNpdidFacility || p.FEATURE_ID || p.platformid || feature.id || name}`;
  return {
    id: `${source.kind}:${stable}`,
    kind: source.kind,
    name,
    country,
    ...position,
    status: energyStatus(statusText),
    statusText,
    type:
      text(p.fclKind || p.INF_TYPE || p.category || p.type_inst) ||
      (source.kind === 'wind' ? 'Wind farm' : 'Offshore installation'),
    subsea: p.fclSurface === 'N' || /subsea|subsurface/i.test(p.fclKind || ''),
    operator:
      text(p.fclCurrentOperatorName || p.REP_GROUP || p.operator) || null,
    capacityMW: number(p.power_mw),
    turbines: number(p.n_turbines),
    waterDepthM: number(p.fclWaterDepth ?? p.water_depth),
    recordUpdated: date(p.fclDateUpdated ?? p.UPD_DATE),
    recordUpdateYear: /^\d{4}$/.test(String(p.updateyear || ''))
      ? String(p.updateyear)
      : null,
    source: source.label,
    sourceId: source.id,
    sourceRevision: source.revision || null,
    sourceUrl: source.link,
  };
}

async function download(source, fetchImpl) {
  const features = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const url = new URL(
      source.url || 'https://ows.emodnet-humanactivities.eu/wfs',
    );
    url.search = new URLSearchParams(
      source.format === 'arcgis'
        ? {
            where: '1=1',
            outFields: '*',
            outSR: '4326',
            f: 'geojson',
            orderByFields: 'OBJECTID',
            resultOffset: String(offset),
            resultRecordCount: '1000',
          }
        : {
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: source.layer,
            outputFormat: 'application/json',
            srsName: 'EPSG:4326',
            count: '1000',
            startIndex: String(offset),
          },
    ).toString();
    const response = await fetchImpl(url.href, {
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'application/geo+json, application/json' },
    });
    if (!response.ok) throw new Error('Source unavailable');
    const data = await readResponseJsonCapped(response, 16 * 1024 * 1024);
    if (
      data.type !== 'FeatureCollection' ||
      !Array.isArray(data.features) ||
      data.features.length > 1000
    )
      throw new Error('Invalid source response');
    features.push(...data.features);
    const matched = Number(data.numberMatched ?? data.totalFeatures);
    if (
      !data.features.length ||
      data.features.length < 1000 ||
      (Number.isFinite(matched) && features.length >= matched)
    )
      return features;
  }
  throw new Error('Source record limit exceeded');
}

/** Fixed public providers only; bounded memory cache, single flight and stale fallback. */
export function createEnergyProvider({
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map(),
    pending = new Map();
  async function load(source) {
    const previous = cache.get(source.id),
      time = now();
    if (previous && time - previous.at < 6 * HOUR)
      return { ...previous, available: true, stale: false };
    if (pending.has(source.id)) return pending.get(source.id);
    const task = (async () => {
      try {
        const raw = await download(source, fetchImpl);
        const records = raw
          .map((f) => normalizeEnergy(f, source))
          .filter(Boolean);
        const entry = { records, at: now() };
        cache.set(source.id, entry);
        return { ...entry, available: true, stale: false };
      } catch {
        if (previous && time - previous.at <= 7 * 24 * HOUR)
          return { ...previous, available: true, stale: true };
        return { records: [], at: null, available: false, stale: false };
      } finally {
        pending.delete(source.id);
      }
    })();
    pending.set(source.id, task);
    return task;
  }
  return {
    async getSnapshot(kind) {
      if (!['oil', 'wind'].includes(kind))
        throw new Error('Invalid energy layer');
      const sources = ENERGY_SOURCES.filter((s) => s.kind === kind);
      const results = await Promise.all(sources.map(load));
      const national = new Set(
        sources
          .filter(
            (s, i) => ['sodir', 'nsta'].includes(s.id) && results[i].available,
          )
          .map((s) => s.country),
      );
      const records = new Map();
      for (let i = 0; i < sources.length; i++) {
        for (const cachedRecord of results[i].records) {
          const record = { ...cachedRecord };
          if (sources[i].id === 'emodnet-oil' && national.has(record.country))
            continue;
          const previous = records.get(record.id);
          if (
            previous &&
            previous.geometry.type !== 'Point' &&
            record.geometry.type === 'Point'
          ) {
            previous.capacityMW ??= record.capacityMW;
            previous.turbines ??= record.turbines;
            continue;
          }
          if (previous) {
            record.capacityMW ??= previous.capacityMW;
            record.turbines ??= previous.turbines;
            record.operator ??= previous.operator;
          }
          // A wind farm may have several disjoint lease polygons. Keep them
          // together under one searchable farm, with a single information card.
          if (
            previous &&
            previous.geometry.type !== 'Point' &&
            record.geometry.type !== 'Point'
          ) {
            const polygons = (g) =>
              g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
            record.geometry = {
              type: 'MultiPolygon',
              coordinates: [
                ...polygons(previous.geometry),
                ...polygons(record.geometry),
              ],
            };
          }
          records.set(record.id, record);
        }
      }
      const metadata = sources.map((s, i) => ({
        id: s.id,
        label: s.label,
        revision: s.revision || null,
        url: s.link,
        fetchedAt: results[i].at,
        available: results[i].available,
        stale: results[i].stale,
        count: results[i].records.length,
      }));
      return {
        schemaVersion: 1,
        kind,
        fetchedAt: now(),
        coverage: 'Northern Europe · 48–82°N, 20°W–40°E',
        sources: metadata,
        records: [...records.values()],
        unavailable: results.every((r) => !r.available),
        partial: results.some((r) => !r.available),
        stale: results.some((r) => r.stale),
      };
    },
  };
}

export function offshoreEnergyProxy(options = {}) {
  const provider = createEnergyProvider(options);
  function install(middlewares) {
    middlewares.use('/api/offshore-energy', async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      const kind = new URL(req.url, 'http://localhost').searchParams.get(
        'kind',
      );
      if (!['oil', 'wind'].includes(kind)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Choose oil or wind.' }));
        return;
      }
      try {
        const snapshot = await provider.getSnapshot(kind);
        res.end(JSON.stringify(snapshot));
      } catch {
        res.statusCode = 503;
        res.end(
          JSON.stringify({ error: 'Offshore energy data is unavailable.' }),
        );
      }
    });
  }
  return {
    name: 'norsaga-offshore-energy',
    configureServer: (s) => install(s.middlewares),
    configurePreviewServer: (s) => install(s.middlewares),
  };
}
