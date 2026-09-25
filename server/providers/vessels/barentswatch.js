import { readResponseJsonCapped } from '../common/http.js';

const TOKEN_URL = 'https://id.barentswatch.no/connect/token';
const LATEST_URL =
  'https://live.ais.barentswatch.no/v1/latest/combined?modelType=Full';
const HISTORIC_TRACK_URL =
  'https://historic.ais.barentswatch.no/v1/historic/trackslast24hours';

const SNAPSHOT_TTL_MS = 30_000;
const MAX_ROWS = 50_000;
const TOKEN_MAX_BYTES = 64 * 1024;
const SNAPSHOT_MAX_BYTES = 25 * 1024 * 1024;
const TRACK_MAX_BYTES = 10 * 1024 * 1024;
const TOKEN_TIMEOUT_MS = 10_000;
const AIS_TIMEOUT_MS = 20_000;

let token = null;
let tokenExpiresAt = 0;
let tokenPromise = null;
let rows = [];
let fetchedAt = 0;
let refreshPromise = null;
let lastError = null;

export function hasBarentsWatchCredentials(environment = process.env) {
  return Boolean(
    String(environment.BARENTSWATCH_AIS_CLIENT_ID || '').trim() &&
    String(environment.BARENTSWATCH_AIS_CLIENT_SECRET || '').trim(),
  );
}

async function accessToken({ fetchImpl = fetch, now = Date.now } = {}) {
  if (token && now() < tokenExpiresAt - 60_000) return token;
  if (tokenPromise) return tokenPromise;

  const clientId = String(process.env.BARENTSWATCH_AIS_CLIENT_ID || '').trim();
  const clientSecret = String(
    process.env.BARENTSWATCH_AIS_CLIENT_SECRET || '',
  ).trim();
  if (!clientId || !clientSecret)
    throw new Error('BarentsWatch AIS credentials are not configured');

  tokenPromise = (async () => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'ais',
      grant_type: 'client_credentials',
    });
    const response = await fetchImpl(
      process.env.BARENTSWATCH_TOKEN_URL || TOKEN_URL,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    const payload = await readResponseJsonCapped(
      response,
      TOKEN_MAX_BYTES,
    ).catch(() => ({}));
    const nextToken = String(payload?.access_token || '').trim();
    if (!response.ok || !nextToken) {
      const detail = String(payload?.error_description || payload?.error || '');
      throw new Error(
        detail
          ? `BarentsWatch OAuth rejected the client: ${detail}`
          : `BarentsWatch OAuth failed (${response.status})`,
      );
    }
    token = nextToken;
    tokenExpiresAt =
      now() + Math.max(60, Number(payload?.expires_in) || 3600) * 1000;
    return token;
  })().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bounded(value, minimum, maximumExclusive) {
  const number = finite(value);
  return number !== null && number >= minimum && number < maximumExclusive
    ? number
    : null;
}

function timestamp(value) {
  const epochMs = Date.parse(String(value || ''));
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

export function normalizeBarentsWatchVessel(record, now = Date.now()) {
  const properties = record?.properties || record || {};
  const coordinates = Array.isArray(record?.geometry?.coordinates)
    ? record.geometry.coordinates
    : null;
  const mmsi = String(properties.mmsi || '').trim();
  const lat = finite(properties.latitude ?? coordinates?.[1]);
  const lon = finite(properties.longitude ?? coordinates?.[0]);
  if (!/^\d{5,10}$/.test(mmsi) || lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const observed = timestamp(properties.msgtime);
  const observedEpoch = observed
    ? Math.floor(Date.parse(observed) / 1000)
    : Math.floor(now / 1000);
  return {
    lat,
    lon,
    name: String(properties.name || '').trim() || `MMSI ${mmsi}`,
    mmsi,
    imo: String(properties.imoNumber || '').trim(),
    type: String(properties.shipType ?? '').trim(),
    destination: String(properties.destination || '').trim(),
    speed: bounded(properties.speedOverGround, 0, 102.3),
    course: bounded(properties.courseOverGround, 0, 360),
    heading: bounded(properties.trueHeading, 0, 360),
    last_position_UTC: observed || new Date(now).toISOString(),
    last_position_epoch: observedEpoch,
    provider: 'BarentsWatch',
    stream: String(properties.stream || '').trim() || null,
    sources: ['BarentsWatch'],
  };
}

export async function ensureBarentsWatchSnapshot({
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (!hasBarentsWatchCredentials()) return barentsWatchStatusSnapshot(now());
  const current = now();
  if (rows.length && current - fetchedAt < SNAPSHOT_TTL_MS)
    return barentsWatchStatusSnapshot(current);
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const bearer = await accessToken({ fetchImpl, now });
      const response = await fetchImpl(
        process.env.BARENTSWATCH_LATEST_URL || LATEST_URL,
        {
          redirect: 'error',
          signal: AbortSignal.timeout(AIS_TIMEOUT_MS),
          headers: { Authorization: `Bearer ${bearer}` },
        },
      );
      if (!response.ok)
        throw new Error(`BarentsWatch AIS failed (${response.status})`);
      const payload = await readResponseJsonCapped(
        response,
        SNAPSHOT_MAX_BYTES,
      );
      if (!Array.isArray(payload))
        throw new Error('BarentsWatch AIS returned malformed data');
      rows = payload
        .slice(0, MAX_ROWS)
        .map((record) => normalizeBarentsWatchVessel(record, current))
        .filter(Boolean)
        .sort((a, b) => b.last_position_epoch - a.last_position_epoch);
      fetchedAt = current;
      lastError = null;
    } catch (error) {
      lastError = error?.message || 'BarentsWatch AIS unavailable';
    }
    return barentsWatchStatusSnapshot(now());
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function barentsWatchRows(maxRows = MAX_ROWS) {
  return rows.slice(0, Math.max(0, Math.min(MAX_ROWS, maxRows)));
}

export function barentsWatchStatusSnapshot(now = Date.now()) {
  if (!hasBarentsWatchCredentials()) {
    return {
      status: 'missing-key',
      error: 'BarentsWatch AIS client credentials are not set',
      fetchedAt: null,
      lastMessageAt: null,
      rowCount: 0,
    };
  }
  const newest = rows[0]?.last_position_UTC || null;
  return {
    status: rows.length
      ? lastError
        ? 'stale'
        : 'live'
      : lastError
        ? 'error'
        : 'connecting',
    error: lastError,
    fetchedAt: fetchedAt || null,
    lastMessageAt: newest,
    rowCount: rows.length,
    ageMs: fetchedAt ? Math.max(0, now - fetchedAt) : null,
  };
}

export async function fetchBarentsWatchTrack(
  mmsi,
  { fetchImpl = fetch, now = Date.now } = {},
) {
  if (!hasBarentsWatchCredentials()) return [];
  const bearer = await accessToken({ fetchImpl, now });
  const base =
    process.env.BARENTSWATCH_HISTORIC_TRACK_URL || HISTORIC_TRACK_URL;
  const response = await fetchImpl(`${base}/${encodeURIComponent(mmsi)}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(AIS_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!response.ok)
    throw new Error(`BarentsWatch historic AIS failed (${response.status})`);
  const payload = await readResponseJsonCapped(response, TRACK_MAX_BYTES);
  if (!Array.isArray(payload))
    throw new Error('BarentsWatch historic AIS returned malformed data');
  return payload.flatMap((record) => {
    const row = normalizeBarentsWatchVessel(record, now());
    return row
      ? [{ lat: row.lat, lon: row.lon, t: row.last_position_epoch }]
      : [];
  });
}

export function resetBarentsWatchForTests() {
  token = null;
  tokenExpiresAt = 0;
  tokenPromise = null;
  rows = [];
  fetchedAt = 0;
  refreshPromise = null;
  lastError = null;
}
