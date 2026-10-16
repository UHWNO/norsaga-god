import { readResponseJsonCapped } from '../common/http.js';

const API_BASE = 'https://gateway.api.globalfishingwatch.org/v3';
const VESSEL_DATASET = 'public-global-vessel-identity:latest';
const EVENT_DATASETS = Object.freeze([
  'public-global-fishing-events:latest',
  'public-global-encounters-events:latest',
  'public-global-loitering-events:latest',
  'public-global-port-visits-events:latest',
  'public-global-gaps-events:latest',
]);
const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_MAX_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 100;
const DAY_MS = 86_400_000;

const cache = new Map();
const pending = new Map();

export function globalFishingWatchToken(environment = process.env) {
  return String(
    environment.GFW_API_ACCESS_TOKEN || environment.GFW_API_TOKEN || '',
  ).trim();
}

export function hasGlobalFishingWatchToken(environment = process.env) {
  return Boolean(globalFishingWatchToken(environment));
}

function array(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function latestIdentity(records, mmsi) {
  return (
    array(records)
      .filter((record) => !mmsi || text(record?.ssvid) === mmsi)
      .sort((left, right) => {
        const preferred =
          Number(Boolean(right?.latestVesselInfo)) -
          Number(Boolean(left?.latestVesselInfo));
        if (preferred) return preferred;
        return (
          Date.parse(right?.transmissionDateTo || '') -
          Date.parse(left?.transmissionDateTo || '')
        );
      })[0] || null
  );
}

function entryMatchesMmsi(entry, mmsi) {
  return [
    ...array(entry?.selfReportedInfo),
    ...array(entry?.registryInfo),
  ].some((record) => text(record?.ssvid) === mmsi);
}

function firstCombinedValue(entry, key) {
  for (const source of array(entry?.combinedSourcesInfo)) {
    for (const value of array(source?.[key])) {
      const candidate = text(value?.value ?? value?.name);
      if (candidate) return candidate;
    }
  }
  return '';
}

export function normalizeGlobalFishingWatchVessel(payload, mmsi) {
  const entries = array(payload?.entries);
  const entry = entries.find((candidate) => entryMatchesMmsi(candidate, mmsi));
  if (!entry) return null;
  const selfReported = latestIdentity(entry.selfReportedInfo, mmsi);
  const registry = latestIdentity(entry.registryInfo, mmsi);
  const identity = selfReported || registry || {};
  const registrySources = new Set();
  for (const record of array(entry.registryInfo)) {
    for (const source of array(record?.sourceCode)) {
      if (text(source)) registrySources.add(text(source));
    }
  }
  for (const owner of array(entry.registryOwners)) {
    if (text(owner?.sourceCode)) registrySources.add(text(owner.sourceCode));
  }
  return {
    id: text(identity.id || registry?.id),
    mmsi,
    name: text(identity.shipname || registry?.shipname),
    imo: text(identity.imo || registry?.imo),
    callsign: text(identity.callsign || registry?.callsign),
    flag: text(identity.flag || registry?.flag),
    shipType: text(
      identity.shiptype ||
        registry?.shiptype ||
        firstCombinedValue(entry, 'shiptypes'),
    ),
    gearType: text(
      identity.geartype ||
        array(registry?.geartypes)[0] ||
        firstCombinedValue(entry, 'inferredVesselClassAgNnet') ||
        firstCombinedValue(entry, 'geartypes'),
    ),
    lengthM: Number.isFinite(Number(registry?.lengthM))
      ? Number(registry.lengthM)
      : null,
    tonnageGt: Number.isFinite(Number(registry?.tonnageGt))
      ? Number(registry.tonnageGt)
      : null,
    transmissionFrom: text(identity.transmissionDateFrom),
    transmissionTo: text(identity.transmissionDateTo),
    registrySources: [...registrySources],
    registryRecords:
      Number(entry.registryInfoTotalRecords) ||
      array(entry.registryInfo).length,
    dataset: text(entry.dataset || VESSEL_DATASET),
  };
}

function validPosition(position) {
  const lat = Number(position?.lat);
  const lon = Number(position?.lon);
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
    ? { lat, lon }
    : null;
}

export function normalizeGlobalFishingWatchEvents(payload) {
  return array(payload?.entries).flatMap((event) => {
    const type = text(event?.type).toUpperCase();
    const start = text(event?.start);
    const end = text(event?.end);
    if (!type || !start) return [];
    return [
      {
        id: text(event?.id),
        type,
        start,
        end,
        position: validPosition(event?.position),
        vesselId: text(event?.vessel?.id),
        regions: {
          eez: array(event?.regions?.eez).map(text).filter(Boolean),
          mpa: array(event?.regions?.mpa).map(text).filter(Boolean),
          rfmo: array(event?.regions?.rfmo).map(text).filter(Boolean),
        },
      },
    ];
  });
}

async function requestJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Global Fishing Watch authorization failed (${response.status})`,
      );
    }
    if (response.status === 429) {
      throw new Error('Global Fishing Watch rate limit reached');
    }
    throw new Error(`Global Fishing Watch request failed (${response.status})`);
  }
  return readResponseJsonCapped(response, RESPONSE_MAX_BYTES);
}

function apiUrl(pathname) {
  const base = text(process.env.GFW_API_BASE_URL || API_BASE).replace(
    /\/$/,
    '',
  );
  return new URL(`${base}${pathname}`);
}

function lookbackDays(environment = process.env) {
  const value = Number.parseInt(environment.GFW_EVENTS_LOOKBACK_DAYS, 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(3650, value)) : 365;
}

function yyyyMmDd(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function trimCache() {
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export async function fetchGlobalFishingWatchIntelligence(
  mmsi,
  { fetchImpl = fetch, now = Date.now } = {},
) {
  const normalizedMmsi = text(mmsi);
  if (!/^\d{5,10}$/.test(normalizedMmsi)) {
    throw new Error('Valid vessel MMSI required');
  }
  const token = globalFishingWatchToken();
  if (!token)
    throw new Error('Global Fishing Watch API token is not configured');

  const current = now();
  const cached = cache.get(normalizedMmsi);
  if (cached && current - cached.fetchedAt < CACHE_TTL_MS) return cached.value;
  if (pending.has(normalizedMmsi)) return pending.get(normalizedMmsi);

  const promise = (async () => {
    const vesselUrl = apiUrl('/vessels/search');
    vesselUrl.searchParams.set('query', normalizedMmsi);
    vesselUrl.searchParams.append('datasets[0]', VESSEL_DATASET);
    vesselUrl.searchParams.set('limit', '10');
    const vesselPayload = await requestJson(vesselUrl, token, fetchImpl);
    const vessel = normalizeGlobalFishingWatchVessel(
      vesselPayload,
      normalizedMmsi,
    );
    let events = [];
    let eventTotal = 0;
    if (vessel?.id) {
      const eventsUrl = apiUrl('/events');
      eventsUrl.searchParams.append('vessels[0]', vessel.id);
      EVENT_DATASETS.forEach((dataset, index) => {
        eventsUrl.searchParams.append(`datasets[${index}]`, dataset);
      });
      eventsUrl.searchParams.set(
        'start-date',
        yyyyMmDd(current - lookbackDays() * DAY_MS),
      );
      eventsUrl.searchParams.set('end-date', yyyyMmDd(current + DAY_MS));
      eventsUrl.searchParams.set('limit', '50');
      eventsUrl.searchParams.set('offset', '0');
      eventsUrl.searchParams.set('sort', '-start');
      const eventPayload = await requestJson(eventsUrl, token, fetchImpl);
      events = normalizeGlobalFishingWatchEvents(eventPayload);
      eventTotal = Number(eventPayload?.total) || events.length;
    }
    const value = {
      status: vessel ? 'available' : 'not-found',
      source: 'Global Fishing Watch',
      vessel,
      events,
      eventTotal,
      lookbackDays: lookbackDays(),
      fetchedAt: new Date(current).toISOString(),
      datasets: [VESSEL_DATASET, ...EVENT_DATASETS],
      caveat:
        'Modelled and registry-derived research data; apparent activity and AIS gaps are not proof of wrongdoing.',
      useScope: 'Internal NorSaga research, training and development only',
    };
    cache.set(normalizedMmsi, { fetchedAt: current, value });
    trimCache();
    return value;
  })().finally(() => pending.delete(normalizedMmsi));
  pending.set(normalizedMmsi, promise);
  return promise;
}

export function resetGlobalFishingWatchForTests() {
  cache.clear();
  pending.clear();
}
