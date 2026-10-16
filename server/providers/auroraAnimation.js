import {
  readResponseJsonCapped,
  readResponseBytesCapped,
} from './common/http.js';
import { noaaTime } from './aurora.js';

const HOST = 'https://services.swpc.noaa.gov';
const MINUTE = 60_000;
const ROOT = '/api/aurora-animation';
const hemispheres = ['north', 'south'];
const invalid = () => new Error('Invalid NOAA animation data');

/** Only manifest-listed, time-tagged NOAA JPEGs can be requested. */
export function normalizeAuroraFrames(rows, hemisphere, nowMs = Date.now()) {
  if (
    !hemispheres.includes(hemisphere) ||
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 600
  )
    throw invalid();
  const seen = new Set();
  return rows
    .map((row) => {
      const time = noaaTime(row?.time_tag);
      const date = new Date(time);
      if (
        date.getUTCSeconds() ||
        date.getUTCMilliseconds() ||
        nowMs - date.getTime() > 26 * 60 * MINUTE ||
        date.getTime() - nowMs > 120 * MINUTE ||
        seen.has(time)
      )
        throw invalid();
      const filename = `aurora_${hemisphere === 'north' ? 'N' : 'S'}_${time.slice(0, 10)}_${time.slice(11, 16).replace(':', '')}.jpg`;
      const upstream = `/images/animations/ovation/${hemisphere}/${filename}`;
      if (row.url !== upstream) throw invalid();
      seen.add(time);
      return { time, url: `${ROOT}/${hemisphere}/frame/${time}`, upstream };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Lazy, bounded animation proxy shared by development, preview and production. */
export function auroraAnimationProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 12_000,
} = {}) {
  const indexes = new Map(),
    images = new Map(),
    operations = new Map(),
    attempts = new Map();
  let imageBytes = 0;
  async function shared(key, signal, work) {
    signal.throwIfAborted();
    let op = operations.get(key);
    if (op?.controller.signal.aborted) op = null;
    if (!op) {
      if (operations.size >= 10) throw new Error('NOAA animation busy');
      const controller = new AbortController();
      op = { controller, waiters: 0 };
      const timer = setTimeout(
        () => controller.abort(new Error('NOAA animation timed out')),
        timeoutMs,
      );
      let remove;
      const aborted = new Promise((_, reject) => {
        const abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
        remove = () => controller.signal.removeEventListener('abort', abort);
      });
      const owned = op;
      op.promise = Promise.race([
        Promise.resolve().then(() => work(controller.signal)),
        aborted,
      ]).finally(() => {
        clearTimeout(timer);
        remove();
        if (operations.get(key) === owned) operations.delete(key);
      });
      operations.set(key, op);
    }
    op.waiters++;
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([op.promise, cancelled]);
    } finally {
      signal.removeEventListener('abort', abort);
      if (--op.waiters === 0 && operations.get(key) === op) {
        op.controller.abort();
        if (signal.aborted) attempts.delete(key);
      }
    }
  }
  async function index(hemisphere, signal) {
    signal.throwIfAborted();
    const old = indexes.get(hemisphere),
      key = `index-${hemisphere}`;
    if (old && now() - old.fetchedAt < 2 * MINUTE)
      return { ...old, stale: false };
    try {
      const value = await shared(key, signal, async (upstreamSignal) => {
        if (now() - (attempts.get(key) ?? -Infinity) < 30_000) throw invalid();
        attempts.set(key, now());
        const res = await fetchImpl(
          `${HOST}/products/animations/ovation_${hemisphere}_24h.json`,
          {
            signal: upstreamSignal,
            redirect: 'error',
            headers: { Accept: 'application/json' },
          },
        );
        if (
          !res.ok ||
          !/^application\/json(?:;|$)/i.test(
            res.headers.get('content-type') || '',
          )
        ) {
          await res.body?.cancel();
          throw invalid();
        }
        const rows = await readResponseJsonCapped(
          res,
          128 * 1024,
          upstreamSignal,
        );
        upstreamSignal.throwIfAborted();
        const result = {
          frames: normalizeAuroraFrames(rows, hemisphere, now()),
          fetchedAt: now(),
        };
        indexes.set(hemisphere, result);
        return result;
      });
      signal.throwIfAborted();
      return { ...value, stale: false };
    } catch (error) {
      signal.throwIfAborted();
      if (old && now() - old.fetchedAt <= 15 * MINUTE)
        return { ...old, stale: true };
      throw error;
    }
  }
  async function frame(hemisphere, time, signal) {
    const manifest = await index(hemisphere, signal);
    const listed = manifest.frames.find((item) => item.time === time);
    if (!listed) throw invalid();
    const key = listed.upstream;
    const cached = images.get(key);
    if (cached) {
      images.delete(key);
      images.set(key, cached);
      return cached;
    }
    return shared(key, signal, async (upstreamSignal) => {
      const res = await fetchImpl(`${HOST}${key}`, {
        signal: upstreamSignal,
        redirect: 'error',
        headers: { Accept: 'image/jpeg' },
      });
      if (
        !res.ok ||
        !/^image\/jpeg(?:;|$)/i.test(res.headers.get('content-type') || '')
      ) {
        await res.body?.cancel();
        throw invalid();
      }
      const bytes = await readResponseBytesCapped(
        res,
        2 * 1024 * 1024,
        upstreamSignal,
      );
      upstreamSignal.throwIfAborted();
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
        throw invalid();
      images.set(key, bytes);
      imageBytes += bytes.byteLength;
      while (images.size > 32 || imageBytes > 16 * 1024 * 1024) {
        const first = images.keys().next().value;
        imageBytes -= images.get(first).byteLength;
        images.delete(first);
      }
      return bytes;
    });
  }
  async function handler(req, res) {
    const controller = new AbortController(),
      signal = controller.signal;
    const close = () => controller.abort();
    res.once?.('close', close);
    const json = (status, value) => {
      if (signal.aborted) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method !== 'GET')
        return json(405, { error: 'method_not_allowed' });
      const route =
        /^\/(north|south)(?:\/frame\/(\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z))?$/.exec(
          req.url || '',
        );
      if (!route) return json(400, { error: 'invalid_animation_request' });
      const [, hemisphere, time] = route;
      if (time) {
        const bytes = await frame(hemisphere, time, signal);
        if (!signal.aborted) {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(Buffer.from(bytes));
        }
      } else {
        const value = await index(hemisphere, signal);
        json(200, {
          schemaVersion: 1,
          provider: 'NOAA SWPC',
          product: 'OVATION image history',
          hemisphere,
          fetchedAt: value.fetchedAt,
          stale: value.stale,
          frames: value.frames.map(({ time, url }) => ({ time, url })),
        });
      }
    } catch {
      json(503, { error: 'noaa_animation_unavailable' });
    } finally {
      res.removeListener?.('close', close);
    }
  }
  return {
    name: 'aurora-animation',
    configureServer({ middlewares }) {
      middlewares.use(ROOT, handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use(ROOT, handler);
    },
  };
}
