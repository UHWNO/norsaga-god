import { createAuroraAnimationSource } from './animationSource.js';
import { readResponseJsonCapped } from '../../sources/httpBody.js';

export const AURORA_RESPONSE_LIMIT = 2 * 1024 * 1024;
const malformed = () => new Error('Malformed aurora snapshot');
const time = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const fetched = (value) =>
  value === null || (Number.isFinite(value) && value >= 0);
const state = (value) =>
  value &&
  typeof value.stale === 'boolean' &&
  typeof value.unavailable === 'boolean' &&
  fetched(value.fetchedAt);

/** Validate the internal contract before it can allocate globe resources. */
export function validateAuroraSnapshot(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.provider !== 'NOAA SWPC' ||
    value.product !== 'OVATION' ||
    value.metric !== 'relative-intensity' ||
    !Array.isArray(value.range) ||
    value.range.join(',') !== '0,100' ||
    !state(value) ||
    typeof value.delayed !== 'boolean' ||
    !(
      value.reason === null ||
      (typeof value.reason === 'string' && value.reason.length <= 160)
    ) ||
    !Array.isArray(value.cells) ||
    value.cells.length > 65160 ||
    !state(value.kp) ||
    !state(value.geomagnetic)
  )
    throw malformed();
  if (value.unavailable) {
    if (
      value.cells.length ||
      value.sourceTime !== null ||
      value.forecastTime !== null ||
      value.fetchedAt !== null
    )
      throw malformed();
  } else if (
    !time(value.sourceTime) ||
    !time(value.forecastTime) ||
    value.fetchedAt === null ||
    value.forecastTime < value.sourceTime ||
    Date.parse(value.forecastTime) - Date.parse(value.sourceTime) > 120 * 60_000
  )
    throw malformed();
  const seen = new Set();
  for (const cell of value.cells) {
    if (
      !Array.isArray(cell) ||
      cell.length !== 3 ||
      !cell.every(Number.isInteger)
    )
      throw malformed();
    const [lon, lat, intensity] = cell,
      key = (lon + 180) * 181 + lat + 90;
    if (
      lon < -180 ||
      lon > 179 ||
      lat < -90 ||
      lat > 90 ||
      intensity < 0 ||
      intensity > 100 ||
      seen.has(key)
    )
      throw malformed();
    seen.add(key);
  }
  const kp = value.kp.current;
  if (
    kp !== null &&
    (!kp ||
      !time(kp.time) ||
      !time(kp.validUntil) ||
      Date.parse(kp.validUntil) - Date.parse(kp.time) !== 180 * 60_000 ||
      !Number.isFinite(kp.value) ||
      kp.value < 0 ||
      kp.value > 9 ||
      kp.kind !== 'predicted' ||
      !(kp.scale === null || /^G[1-5]$/.test(kp.scale)))
  )
    throw malformed();
  const alert = value.geomagnetic.active;
  if (
    alert !== null &&
    (!alert ||
      typeof alert.id !== 'string' ||
      !/^[A-Z0-9]{1,16}$/.test(alert.id) ||
      !time(alert.issuedAt) ||
      !time(alert.validFrom) ||
      !time(alert.validUntil) ||
      alert.validUntil <= alert.validFrom ||
      !/^G[1-5]$/.test(alert.scale) ||
      !['alert', 'warning', 'watch'].includes(alert.kind))
  )
    throw malformed();
  return value;
}

/** Lazy, same-origin acquisition; the browser never contacts NOAA. */
export function createAuroraSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 15_000,
} = {}) {
  return {
    ...createAuroraAnimationSource({ fetchImpl, timeoutMs }),
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error('Aurora request timed out')),
        timeoutMs,
      );
      let removeAbort;
      const cancelled = new Promise((_, reject) => {
        const cancel = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', cancel, { once: true });
        removeAbort = () =>
          controller.signal.removeEventListener('abort', cancel);
      });
      const work = async () => {
        const response = await fetchImpl('/api/aurora', {
          signal: controller.signal,
          cache: 'no-store',
          redirect: 'error',
        });
        if (
          !response.ok ||
          !/^application\/json(?:;|$)/i.test(
            response.headers.get('content-type') || '',
          )
        ) {
          await response.body?.cancel();
          throw new Error('Aurora source unavailable');
        }
        const value = await readResponseJsonCapped(
          response,
          AURORA_RESPONSE_LIMIT,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        return validateAuroraSnapshot(value);
      };
      try {
        return await Promise.race([work(), cancelled]);
      } finally {
        clearTimeout(timer);
        removeAbort();
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
