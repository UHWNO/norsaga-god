import {
  readResponseJsonCapped,
  readResponseBytesCapped,
} from '../../sources/httpBody.js';
const ROOT = '/api/aurora-animation';
const invalid = () => new Error('NOAA animation unavailable');

export function validateAnimationIndex(value, hemisphere) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.provider !== 'NOAA SWPC' ||
    value.product !== 'OVATION image history' ||
    value.hemisphere !== hemisphere ||
    !Number.isFinite(value.fetchedAt) ||
    typeof value.stale !== 'boolean' ||
    !Array.isArray(value.frames) ||
    !value.frames.length ||
    value.frames.length > 600
  )
    throw invalid();
  let previous = '';
  for (const frame of value.frames) {
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(frame.time) ||
      !Number.isFinite(Date.parse(frame.time)) ||
      new Date(frame.time).toISOString() !== frame.time ||
      frame.time <= previous ||
      frame.url !== `${ROOT}/${hemisphere}/frame/${frame.time}`
    )
      throw invalid();
    previous = frame.time;
  }
  return value;
}

/** Same-origin JPEG acquisition. No NOAA URL supplied by UI is ever fetched. */
export function createAuroraAnimationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 15_000,
} = {}) {
  async function request(url, signal, image = false) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error('NOAA animation request timed out')),
      timeoutMs,
    );
    let remove;
    const cancelled = new Promise((_, reject) => {
      const cancel = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', cancel, { once: true });
      remove = () => controller.signal.removeEventListener('abort', cancel);
    });
    const work = async () => {
      const res = await fetchImpl(url, {
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
      });
      if (
        !res.ok ||
        !(image ? /^image\/jpeg(?:;|$)/i : /^application\/json(?:;|$)/i).test(
          res.headers.get('content-type') || '',
        )
      ) {
        await res.body?.cancel();
        throw invalid();
      }
      const value = image
        ? await readResponseBytesCapped(res, 2 * 1024 * 1024)
        : await readResponseJsonCapped(res, 128 * 1024, controller.signal);
      controller.signal.throwIfAborted();
      if (image) {
        if (value[0] !== 255 || value[1] !== 216 || value[2] !== 255)
          throw invalid();
        return new Blob([value], { type: 'image/jpeg' });
      }
      return value;
    };
    try {
      return await Promise.race([work(), cancelled]);
    } finally {
      clearTimeout(timer);
      remove();
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    async getAnimationIndex({ hemisphere = 'north', signal } = {}) {
      if (!['north', 'south'].includes(hemisphere)) throw invalid();
      return validateAnimationIndex(
        await request(`${ROOT}/${hemisphere}`, signal),
        hemisphere,
      );
    },
    getAnimationFrame(url, { signal } = {}) {
      if (
        !/^\/api\/aurora-animation\/(north|south)\/frame\/\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(
          url,
        )
      )
        throw invalid();
      return request(url, signal, true);
    },
  };
}
