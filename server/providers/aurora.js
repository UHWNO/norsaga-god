import { readResponseJsonCapped } from './common/http.js';

const MINUTE = 60_000;
export const NOAA_AURORA_URLS = Object.freeze({
  ovation: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
  kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
  alerts: 'https://services.swpc.noaa.gov/products/alerts.json',
});
const LIMITS = { ovation: 2 * 1024 * 1024, kp: 128 * 1024, alerts: 512 * 1024 };
const fail = () => new Error('Invalid NOAA SWPC data');

/** Canonical UTC only; NOAA Kp and alert issuance omit the UTC suffix. */
export function noaaTime(value) {
  if (typeof value !== 'string') throw fail();
  const normalized = value.replace(' ', 'T');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z?$/.test(normalized))
    throw fail();
  const withZone = normalized.endsWith('Z') ? normalized : `${normalized}Z`;
  const ms = Date.parse(withZone);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().replace('.000Z', 'Z') !==
      withZone.replace('.000Z', 'Z')
  )
    throw fail();
  return new Date(ms).toISOString();
}

/** Keep NOAA's published 0–100 auroral value; never convert it to energy units. */
export function normalizeOvation(value, nowMs = Date.now()) {
  if (
    !value ||
    value.type !== 'MultiPoint' ||
    value['Data Format'] !== '[Longitude, Latitude, Aurora]' ||
    !Array.isArray(value.coordinates) ||
    value.coordinates.length > 65160
  )
    throw fail();
  const sourceTime = noaaTime(value['Observation Time']);
  const forecastTime = noaaTime(value['Forecast Time']);
  const sourceMs = Date.parse(sourceTime),
    forecastMs = Date.parse(forecastTime);
  if (
    sourceMs > nowMs + 5 * MINUTE ||
    nowMs - sourceMs > 60 * MINUTE ||
    forecastMs < sourceMs ||
    forecastMs - sourceMs > 120 * MINUTE
  )
    throw fail();
  const seen = new Set();
  const cells = value.coordinates.map((cell) => {
    if (
      !Array.isArray(cell) ||
      cell.length !== 3 ||
      !cell.every(Number.isInteger)
    )
      throw fail();
    const [lon, lat, aurora] = cell;
    const key = lon * 181 + lat + 90;
    if (
      lon < 0 ||
      lon > 359 ||
      lat < -90 ||
      lat > 90 ||
      aurora < 0 ||
      aurora > 100 ||
      seen.has(key)
    )
      throw fail();
    seen.add(key);
    return [lon >= 180 ? lon - 360 : lon, lat, aurora];
  });
  return { sourceTime, forecastTime, cells };
}

/** Normalize the labelled 3-hour planetary Kp intervals, preserving predicted/observed. */
export function normalizeKp(value, nowMs = Date.now()) {
  if (!Array.isArray(value) || value.length > 256 || !value.length)
    throw fail();
  const seen = new Set();
  return value
    .map((row) => {
      const time = noaaTime(row?.time_tag);
      const at = Date.parse(time);
      if (
        !Number.isFinite(row.kp) ||
        row.kp < 0 ||
        row.kp > 9 ||
        !['observed', 'estimated', 'predicted'].includes(row.observed) ||
        !(row.noaa_scale === null || /^G[1-5]$/.test(row.noaa_scale)) ||
        at % (180 * MINUTE) !== 0 ||
        Math.abs(at - nowMs) > 12 * 24 * 60 * MINUTE ||
        seen.has(time)
      )
        throw fail();
      seen.add(time);
      return {
        time,
        validUntil: new Date(at + 180 * MINUTE).toISOString(),
        value: row.kp,
        kind: row.observed,
        scale: row.noaa_scale,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
function messageTime(value) {
  const parts = value
    ?.trim()
    .match(/^(\d{4}) ([A-Z][a-z]{2}) (\d\d)(?: (\d\d)(\d\d) UTC)?$/);
  if (!parts || !MONTHS.includes(parts[2])) return null;
  try {
    return noaaTime(
      `${parts[1]}-${String(MONTHS.indexOf(parts[2]) + 1).padStart(2, '0')}-${parts[3]}T${parts[4] || '00'}:${parts[5] || '00'}:00Z`,
    );
  } catch {
    return null;
  }
}

/** Only explicit, bounded geomagnetic notices are active; cancellations supersede earlier products. */
export function normalizeGeomagneticAlerts(value, nowMs = Date.now()) {
  if (!Array.isArray(value) || value.length > 512) throw fail();
  const rows = value
    .map((row) => {
      if (
        !row ||
        typeof row.product_id !== 'string' ||
        !/^[A-Z0-9]{1,16}$/.test(row.product_id) ||
        typeof row.message !== 'string' ||
        row.message.length > 16_384
      )
        throw fail();
      const issuedAt = noaaTime(row.issue_datetime);
      if (
        Date.parse(issuedAt) > nowMs + 5 * MINUTE ||
        nowMs - Date.parse(issuedAt) > 30 * 24 * 60 * MINUTE
      )
        throw fail();
      return { id: row.product_id, issuedAt, message: row.message };
    })
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const seen = new Set(),
    alerts = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const message = row.message;
    if (
      /\bCANCEL(?:LED|ATION|LATION)?\b/i.test(message) ||
      !/Geomagnetic/i.test(message)
    )
      continue;
    const scale =
      message.match(/NOAA Scale:\s*(G[1-5])\b/i)?.[1]?.toUpperCase() ||
      message.match(/WATCH:\s*(G[1-5])\b/i)?.[1]?.toUpperCase();
    if (!scale) continue;
    let validFrom = messageTime(message.match(/^Valid From:\s*(.+)$/im)?.[1]);
    let validUntil = messageTime(
      message.match(/^Now Valid Until:\s*(.+)$/im)?.[1] ||
        message.match(/^Valid To:\s*(.+)$/im)?.[1],
    );
    let kind = 'warning';
    const day = messageTime(
      message.match(/^Valid for UTC Day:\s*(.+)$/im)?.[1],
    );
    if (day && /WATCH:/i.test(message)) {
      kind = 'watch';
      validFrom = day;
      validUntil = new Date(Date.parse(day) + 24 * 60 * MINUTE).toISOString();
    } else if (/^ALERT:/im.test(message)) {
      kind = 'alert';
      const period = message.match(
        /^Synoptic Period:\s*(\d\d)00-(\d\d)00\s*$/im,
      );
      if (!period || !/^Active Warning:\s*YES\s*$/im.test(message)) continue;
      const start = Number(period[1]),
        end = Number(period[2]);
      if (start < 0 || start > 21 || start % 3 || end !== start + 3) continue;
      const midnight = Date.parse(row.issuedAt.slice(0, 10) + 'T00:00:00Z');
      validFrom = new Date(midnight + start * 60 * MINUTE).toISOString();
      validUntil = new Date(midnight + end * 60 * MINUTE).toISOString();
    }
    if (
      !validFrom ||
      !validUntil ||
      Date.parse(validUntil) <= Date.parse(validFrom) ||
      Date.parse(validUntil) - Date.parse(validFrom) > 7 * 24 * 60 * MINUTE
    )
      continue;
    alerts.push({
      id: row.id,
      issuedAt: row.issuedAt,
      scale,
      kind,
      validFrom,
      validUntil,
    });
  }
  return alerts;
}

/** Shared fixed-endpoint cache with independently cancellable waiters and bounded last-good data. */
export function auroraProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 12_000,
} = {}) {
  const cache = new Map(),
    operations = new Map(),
    attempts = new Map();
  const parsers = {
    ovation: normalizeOvation,
    kp: normalizeKp,
    alerts: normalizeGeomagneticAlerts,
  };
  const ttl = (key) => (key === 'ovation' ? 2 * MINUTE : 5 * MINUTE);
  const maxAge = (key) => (key === 'ovation' ? 60 * MINUTE : 30 * MINUTE);
  const usable = (key, value) =>
    value &&
    now() - value.fetchedAt <= maxAge(key) &&
    (key !== 'ovation' ||
      now() - Date.parse(value.data.sourceTime) <= 60 * MINUTE);
  async function acquire(key, signal) {
    signal.throwIfAborted();
    const old = cache.get(key);
    if (usable(key, old) && now() - old.fetchedAt < ttl(key))
      return { ...old, stale: false, unavailable: false };
    let operation = operations.get(key);
    if (operation?.controller.signal.aborted) {
      operations.delete(key);
      operation = null;
    }
    try {
      if (!operation) {
        if (now() - (attempts.get(key) ?? -Infinity) < 30_000)
          throw new Error('NOAA retry cooling down');
        attempts.set(key, now());
        const controller = new AbortController();
        operation = { controller, waiters: 0 };
        const timer = setTimeout(
          () => controller.abort(new Error('NOAA request timed out')),
          timeoutMs,
        );
        const work = async () => {
          const response = await fetchImpl(NOAA_AURORA_URLS[key], {
            signal: controller.signal,
            redirect: 'error',
            headers: { Accept: 'application/json' },
          });
          if (
            !response.ok ||
            !/^application\/json(?:;|$)/i.test(
              response.headers.get('content-type') || '',
            )
          ) {
            await response.body?.cancel();
            throw fail();
          }
          const raw = await readResponseJsonCapped(
            response,
            LIMITS[key],
            controller.signal,
          );
          controller.signal.throwIfAborted();
          const value = { data: parsers[key](raw, now()), fetchedAt: now() };
          cache.set(key, value);
          return value;
        };
        // Abort settles even a transport that fails to honour its signal.
        let removeAbort;
        const aborted = new Promise((_, reject) => {
          const abort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', abort, { once: true });
          removeAbort = () =>
            controller.signal.removeEventListener('abort', abort);
        });
        const owned = operation;
        operation.promise = Promise.race([work(), aborted]).finally(() => {
          clearTimeout(timer);
          removeAbort();
          if (operations.get(key) === owned) operations.delete(key);
        });
        operations.set(key, operation);
      }
      operation.waiters++;
      let abort;
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      });
      try {
        const value = await Promise.race([operation.promise, cancelled]);
        signal.throwIfAborted();
        return { ...value, stale: false, unavailable: false };
      } finally {
        signal.removeEventListener('abort', abort);
        if (--operation.waiters === 0 && operations.get(key) === operation) {
          operation.controller.abort();
          if (signal.aborted) attempts.delete(key);
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      return usable(key, old)
        ? { ...old, stale: true, unavailable: false }
        : { data: null, fetchedAt: null, stale: false, unavailable: true };
    }
  }
  async function snapshot(signal) {
    const [grid, kp, alerts] = await Promise.all(
      ['ovation', 'kp', 'alerts'].map((key) => acquire(key, signal)),
    );
    signal.throwIfAborted();
    const delayed =
      !!grid.data &&
      (now() - Date.parse(grid.data.sourceTime) > 15 * MINUTE ||
        now() - Date.parse(grid.data.forecastTime) > 5 * MINUTE);
    const currentKp =
      kp.data?.find(
        (row) =>
          row.kind === 'predicted' &&
          Date.parse(row.time) <= now() &&
          Date.parse(row.validUntil) > now(),
      ) ??
      kp.data?.find(
        (row) =>
          row.kind === 'predicted' &&
          Date.parse(row.time) > now() &&
          Date.parse(row.time) - now() <= 180 * MINUTE,
      ) ??
      null;
    const active = (alerts.data || [])
      .filter(
        (row) =>
          Date.parse(row.validFrom) <= now() &&
          Date.parse(row.validUntil) > now(),
      )
      .sort(
        (a, b) =>
          b.scale.localeCompare(a.scale) ||
          b.issuedAt.localeCompare(a.issuedAt),
      );
    return {
      schemaVersion: 1,
      provider: 'NOAA SWPC',
      product: 'OVATION',
      metric: 'relative-intensity',
      range: [0, 100],
      sourceTime: grid.data?.sourceTime ?? null,
      forecastTime: grid.data?.forecastTime ?? null,
      fetchedAt: grid.fetchedAt,
      stale: grid.stale || delayed,
      delayed,
      unavailable: grid.unavailable,
      reason: grid.unavailable
        ? 'Aurora forecast unavailable'
        : grid.stale
          ? 'Stale cached forecast; NOAA unavailable'
          : delayed
            ? 'Delayed NOAA forecast'
            : null,
      cells: grid.data?.cells ?? [],
      kp: {
        current: currentKp,
        fetchedAt: kp.fetchedAt,
        stale: kp.stale,
        unavailable: kp.unavailable || !currentKp,
      },
      geomagnetic: {
        active: active[0] ?? null,
        fetchedAt: alerts.fetchedAt,
        stale: alerts.stale,
        unavailable: alerts.unavailable,
      },
    };
  }
  async function handler(req, res) {
    const controller = new AbortController();
    const close = () => controller.abort();
    res.once?.('close', close);
    const json = (status, body) => {
      if (controller.signal.aborted) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method !== 'GET')
        return json(405, { error: 'method_not_allowed' });
      if (req.url !== '/' && req.url !== '')
        return json(400, { error: 'invalid_aurora_query' });
      json(200, await snapshot(controller.signal));
    } catch (error) {
      if (!controller.signal.aborted)
        json(503, { error: 'aurora_unavailable' });
    } finally {
      res.removeListener?.('close', close);
    }
  }
  return {
    name: 'aurora',
    configureServer({ middlewares }) {
      middlewares.use('/api/aurora', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/aurora', handler);
    },
  };
}
