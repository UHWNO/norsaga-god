import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createAisStreamAdapter } from '../../../src/data/aisStreamAdapter.js';
import { parseSilenceTimeoutEnv } from '../../../src/data/aisWatchdog.js';
import { clampInt } from '../common/query.js';
import {
  AISSTREAM_CACHE_MAX,
  AISSTREAM_STALE_MS,
  ingestAisStreamEnvelope,
  readAisTrack,
  aisStreamRows,
  newestAisPositionAt,
} from './ais-store.js';
import {
  barentsWatchRows,
  barentsWatchStatusSnapshot,
  ensureBarentsWatchSnapshot,
  fetchBarentsWatchTrack,
  hasBarentsWatchCredentials,
} from './barentswatch.js';
// ---------------------------------------------------------------------------
// AISStream live vessel cache state
// ---------------------------------------------------------------------------
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const AISSTREAM_DEFAULT_BBOXES = [
  [
    [-90, -180],
    [90, 180],
  ],
];
const AISSTREAM_DEFAULT_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
];
// Watchdog budgets (policy lives in src/data/aisWatchdog.js). Silence is
// REPORTED quickly and ACTED ON slowly: a dead feed must read as dead within
// ~2 min, but recycling the socket is throttled so recovery can never become a
// reconnect cycle against AISStream's one-connection-per-key limit.
const AISSTREAM_SILENCE_REPORT_MS = 120_000;
/** Recycle threshold as a multiple of the report threshold. */
const AISSTREAM_RECYCLE_RATIO = 2.5;
const AISSTREAM_BACKOFF_MS = Object.freeze([5_000, 15_000, 60_000, 300_000]);
/** Slow retry cadence once the ladder is spent and the feed reads DOWN. */
const AISSTREAM_DOWN_RETRY_MS = 900_000;
/**
 * Probe cadence while AISStream is rejecting the key. Retrying cannot fix a
 * bad credential, so this exists only to recover from an upstream-side
 * mistake — it must never approach the ladder's pace.
 */
const AISSTREAM_AUTH_PROBE_MS = 3_600_000;
/** How often the watchdog re-evaluates without request traffic. */
const AISSTREAM_TICK_MS = 15_000;

/**
 * @type {ReturnType<typeof createAisStreamAdapter>|null}
 * Module-lifetime: it owns the socket-generation namespace, which must never
 * restart across a dev-server reload (see aisStreamAdapter.js ownership rules).
 */
let _aisAdapter = null;
/** @type {{silenceWatch:boolean,reportMs:number,recycleMs:number,url:string}|null} */
let _aisWatchdogPolicy = null;
/** @type {number|null} */
let _aisStreamTickTimer = null;
/** Set by dispose so the next ensure() re-derives budgets from a reloaded .env. */
let _aisNeedsRearm = false;
/** @type {Function|null|undefined} `ws` constructor; null = unavailable, undefined = not yet probed. */
let _aisWebSocketImpl;

/**
 * Vite plugin: AISStream live vessel cache.
 *
 * AISStream does not support browser CORS and requires a private API key, so
 * the Vite server keeps one backend websocket open and exposes a same-origin
 * JSON snapshot to the Cesium layer.
 */
export function aisLiveProxy() {
  function install(middlewares) {
    middlewares.use('/api/ais-live', async (req, res) => {
      try {
        ensureAisStreamConnection();
        const incoming = new URL(req.url || '', 'http://localhost');

        // Track sub-route MUST be handled before the rows snapshot — this
        // mount prefix-matches every subpath, so without this branch
        // /api/ais-live/track would be silently answered with vessel rows.
        if (
          incoming.pathname === '/track' ||
          incoming.pathname.startsWith('/track/')
        ) {
          const mmsi = String(incoming.searchParams.get('mmsi') || '').trim();
          res.statusCode = /^\d{5,10}$/.test(mmsi) ? 200 : 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (res.statusCode !== 200) {
            res.end(
              JSON.stringify({
                error: 'mmsi query param required',
                samples: [],
              }),
            );
            return;
          }
          const localSamples = readAisTrack(mmsi);
          let barentsWatchSamples = [];
          let warning = null;
          if (hasBarentsWatchCredentials()) {
            try {
              barentsWatchSamples = await fetchBarentsWatchTrack(mmsi);
            } catch (error) {
              warning =
                error?.message || 'BarentsWatch historic AIS unavailable';
            }
          }
          const samples = mergeAisTrackSamples(
            localSamples,
            barentsWatchSamples,
          );
          res.end(
            JSON.stringify({
              mmsi,
              samples,
              source: barentsWatchSamples.length
                ? localSamples.length
                  ? 'AISStream + BarentsWatch'
                  : 'BarentsWatch historic AIS'
                : 'AISStream (accumulated since server start)',
              retainedSec: barentsWatchSamples.length
                ? 24 * 60 * 60
                : Math.floor(AISSTREAM_STALE_MS / 1000),
              warning,
            }),
          );
          return;
        }

        const maxRows = clampInt(
          incoming.searchParams.get('maxRows'),
          1,
          AISSTREAM_CACHE_MAX,
          AISSTREAM_CACHE_MAX,
        );
        await ensureBarentsWatchSnapshot();
        const aisStreamFeed = aisStreamStatusSnapshot();
        const barentsWatchFeed = barentsWatchStatusSnapshot();
        const rows = mergeAisProviderRows(
          aisStreamRows(AISSTREAM_CACHE_MAX),
          barentsWatchRows(AISSTREAM_CACHE_MAX),
          maxRows,
        );
        const feed = combinedAisStatus(aisStreamFeed, barentsWatchFeed, rows);
        const configured = Boolean(
          process.env.AISSTREAM_API_KEY || hasBarentsWatchCredentials(),
        );

        res.statusCode = configured ? 200 : 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({
            rows,
            source: feed.source,
            status: feed.status,
            error: feed.error,
            refreshing: feed.status !== 'live',
            newestPositionAt: newestAisPositionAt(rows),
            lastMessageAt: feed.lastMessageAt,
            // Honest-failure metadata: how long the feed has been quiet, which
            // recovery attempt we are on, and when the next one lands.
            silentForMs: feed.silentForMs,
            reconnectAttempt: feed.reconnectAttempt,
            nextAttemptAt: feed.nextAttemptAt,
            staleAfterMs: feed.staleAfterMs,
            watchdog: feed.watchdog,
            providers: {
              aisstream: aisStreamFeed,
              barentswatch: barentsWatchFeed,
            },
          }),
        );
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({
            error: error?.message || 'AIS live stream error',
            rows: [],
          }),
        );
      }
    });
  }

  return {
    name: 'ais-live-proxy',
    configureServer(server) {
      install(server.middlewares);
      startAisStreamWatchdogTick();
      // Vite restarts the server in-process on a config change while this
      // module's state survives; without teardown each reload stacks another
      // interval and another socket.
      server.httpServer?.on('close', disposeAisStream);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
      startAisStreamWatchdogTick();
      server.httpServer?.on('close', disposeAisStream);
    },
    // Middleware-mode backstop: there is no httpServer to hang 'close' on.
    closeBundle() {
      disposeAisStream();
    },
  };
}

function rowEpoch(row) {
  const explicit = Number(row?.last_position_epoch);
  if (Number.isFinite(explicit)) return explicit;
  const parsed = Date.parse(String(row?.last_position_UTC || ''));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function providerRow(row, provider) {
  const sources = new Set(
    Array.isArray(row?.sources) ? row.sources : [row?.provider || provider],
  );
  sources.add(provider);
  return { ...row, provider: row?.provider || provider, sources: [...sources] };
}

function mergeFields(primary, secondary) {
  const merged = { ...secondary, ...primary };
  for (const key of ['name', 'imo', 'type', 'destination']) {
    if (
      !String(primary?.[key] || '').trim() &&
      String(secondary?.[key] || '').trim()
    )
      merged[key] = secondary[key];
  }
  merged.sources = [
    ...new Set([...(secondary?.sources || []), ...(primary?.sources || [])]),
  ];
  return merged;
}

/** Merge provider snapshots by MMSI; the newest position wins and richer static fields survive. */
export function mergeAisProviderRows(aisRows, barentsRows, maxRows) {
  const merged = new Map();
  for (const [provider, providerRows] of [
    ['AISStream', aisRows],
    ['BarentsWatch', barentsRows],
  ]) {
    for (const raw of providerRows || []) {
      const row = providerRow(raw, provider);
      const mmsi = String(row.mmsi || '').trim();
      if (!mmsi) continue;
      const existing = merged.get(mmsi);
      if (!existing) {
        merged.set(mmsi, row);
        continue;
      }
      const newer = rowEpoch(row) >= rowEpoch(existing) ? row : existing;
      const older = newer === row ? existing : row;
      merged.set(mmsi, mergeFields(newer, older));
    }
  }
  return [...merged.values()]
    .sort((a, b) => rowEpoch(b) - rowEpoch(a))
    .slice(0, maxRows);
}

export function mergeAisTrackSamples(...sets) {
  const samples = new Map();
  for (const set of sets) {
    for (const sample of set || []) {
      const lat = Number(sample?.lat);
      const lon = Number(sample?.lon);
      const t = Number(sample?.t);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t))
        continue;
      samples.set(`${t}:${lat.toFixed(5)}:${lon.toFixed(5)}`, { lat, lon, t });
    }
  }
  return [...samples.values()].sort((a, b) => a.t - b.t);
}

function combinedAisStatus(aisStream, barentsWatch, rows) {
  const active = [];
  if (aisStream.status === 'live') active.push('AISStream');
  if (barentsWatch.status === 'live') active.push('BarentsWatch');
  const configured = [];
  if (process.env.AISSTREAM_API_KEY) configured.push('AISStream');
  if (hasBarentsWatchCredentials()) configured.push('BarentsWatch');
  const live = rows.length > 0 && active.length > 0;
  return {
    ...aisStream,
    source: active.join(' + ') || configured.join(' + ') || 'AIS',
    status: live
      ? 'live'
      : rows.length
        ? 'stale'
        : configured.length
          ? 'connecting'
          : 'missing-key',
    error: live
      ? null
      : barentsWatch.error || aisStream.error || 'AIS providers unavailable',
    lastMessageAt:
      newestAisPositionAt(rows) ||
      barentsWatch.lastMessageAt ||
      aisStream.lastMessageAt,
  };
}

/**
 * Load the `ws` constructor once.
 *
 * Node's built-in WebSocket cannot be used here: it has no terminate(), and
 * its close() waits forever for a close frame a black-holed peer never sends
 * (verified in src/data/aisWatchdogTransport.test.mjs). A socket parked in
 * CLOSING keeps holding AISStream's single per-key connection, which is how
 * the reverted watchdog wedged.
 *
 * Loaded lazily rather than imported at the top of this file so a missing
 * optional dependency degrades the vessel feed honestly instead of breaking
 * the whole dev server and build.
 *
 * @returns {Function|null}
 */
function aisWebSocketImpl() {
  if (_aisWebSocketImpl !== undefined) return _aisWebSocketImpl;
  try {
    _aisWebSocketImpl = createRequire(import.meta.url)('ws');
  } catch (error) {
    _aisWebSocketImpl = null;
    console.warn(
      '[AISStream] `ws` is unavailable; the live vessel feed is off.',
      error?.message || '',
    );
  }
  return _aisWebSocketImpl;
}

/**
 * Resolve the watchdog policy from the environment, once.
 *
 * Read lazily because module evaluation happens before Vite's loadEnv() copies
 * .env into process.env — the reverted watchdog read these at import time and
 * silently ignored every .env value, including its own kill switch.
 *
 * A custom subscription (one harbor, one message type) can be legitimately
 * silent for minutes, so the silence watch only self-arms for the default
 * worldwide subscription. An operator with a narrow filter opts back in by
 * setting AISSTREAM_SILENCE_TIMEOUT_MS to a value sized for that filter; 0 is
 * an explicit kill switch.
 */
function aisWatchdogPolicy() {
  if (_aisWatchdogPolicy) return _aisWatchdogPolicy;
  const customSubscription = Boolean(
    process.env.AISSTREAM_BOUNDING_BOXES || process.env.AISSTREAM_MESSAGE_TYPES,
  );
  const override = parseSilenceTimeoutEnv(
    process.env.AISSTREAM_SILENCE_TIMEOUT_MS,
    (message) => console.warn(message),
  );
  const reportMs =
    override.kind === 'timeout' ? override.value : AISSTREAM_SILENCE_REPORT_MS;
  _aisWatchdogPolicy = {
    silenceWatch:
      override.kind === 'off'
        ? false
        : override.kind === 'timeout' || !customSubscription,
    reportMs,
    recycleMs: Math.round(reportMs * AISSTREAM_RECYCLE_RATIO),
    // Overridable so the watchdog can be exercised end-to-end against a local
    // stand-in upstream without opening a connection to AISStream (which
    // allows only one per key).
    url: process.env.AISSTREAM_URL || AISSTREAM_URL,
  };
  return _aisWatchdogPolicy;
}

/**
 * The transport adapter, built on first use and kept for the module lifetime.
 *
 * Never rebuilt: it owns the socket-generation namespace, and a restarted
 * namespace would let a pre-disposal handler act on its successor's socket.
 */
function aisAdapter() {
  if (_aisAdapter) return _aisAdapter;
  _aisAdapter = createAisStreamAdapter({
    createSocket: (url) => {
      const WebSocketCtor = aisWebSocketImpl();
      if (!WebSocketCtor) throw new Error('ws transport unavailable');
      return new WebSocketCtor(url);
    },
    resolveUrl: () => aisWatchdogPolicy().url,
    buildSubscription: aisStreamSubscription,
    ingestEnvelope: ingestAisStreamEnvelope,
    warn: (message) => console.warn(message),
  });
  _aisAdapter.setWatchdogOptions(aisWatchdogBudgets());
  return _aisAdapter;
}

/** Watchdog budgets derived from the resolved environment policy. */
function aisWatchdogBudgets() {
  const policy = aisWatchdogPolicy();
  return {
    staleMs: policy.reportMs,
    recycleAfterMs: policy.recycleMs,
    backoffMs: [...AISSTREAM_BACKOFF_MS],
    downRetryMs: AISSTREAM_DOWN_RETRY_MS,
    authProbeMs: AISSTREAM_AUTH_PROBE_MS,
  };
}

/**
 * Fingerprint the credential so a key change can clear the terminal
 * auth-failed state. Only a truncated digest is kept — never the key.
 */
function aisKeyFingerprint() {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) return null;
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}

/**
 * Drive the watchdog once. Called on every /api/ais-live request and on the
 * background interval, so recovery does not depend on browser traffic.
 */
function ensureAisStreamConnection() {
  const adapter = aisAdapter();
  if (_aisNeedsRearm) {
    // Post-dispose re-arm, now that the restarted server's .env is loaded. The
    // adapter keeps its generation namespace across this.
    _aisNeedsRearm = false;
    adapter.setWatchdogOptions(aisWatchdogBudgets());
  }
  const policy = aisWatchdogPolicy();
  adapter.ensure({
    hasKey: Boolean(process.env.AISSTREAM_API_KEY),
    hasTransport: Boolean(aisWebSocketImpl()),
    silenceWatch: policy.silenceWatch,
    keyFingerprint: aisKeyFingerprint(),
  });
}
/** Status metadata for /api/ais-live, safe to call before the first connect. */
function aisStreamStatusSnapshot() {
  const snapshot = _aisAdapter ? _aisAdapter.snapshot() : null;
  if (snapshot) return snapshot;
  return {
    status: process.env.AISSTREAM_API_KEY ? 'idle' : 'missing-key',
    error: process.env.AISSTREAM_API_KEY
      ? null
      : 'AISSTREAM_API_KEY is not set',
    lastMessageAt: null,
    silentForMs: null,
    reconnectAttempt: 0,
    nextAttemptAt: null,
    watchdog: 'armed',
    staleAfterMs: AISSTREAM_SILENCE_REPORT_MS,
  };
}

/**
 * Start the background watchdog tick. Unref'd so it never holds the dev server
 * open, and idempotent so a Vite in-process restart cannot stack intervals.
 */
function startAisStreamWatchdogTick() {
  if (_aisStreamTickTimer) return;
  _aisStreamTickTimer = setInterval(() => {
    try {
      ensureAisStreamConnection();
    } catch (error) {
      console.warn('[AISStream] watchdog tick failed', error?.message || '');
    }
  }, AISSTREAM_TICK_MS);
  _aisStreamTickTimer.unref?.();
}

/**
 * Tear down every timer and socket this module owns.
 *
 * Vite restarts the dev server in-process on a config change while module
 * state survives, so without this each reload stacked another interval and
 * another reconnect chain. The cached policy is dropped too, so a restart
 * re-reads .env.
 *
 * The adapter instance itself is deliberately KEPT: it owns the socket
 * generation namespace, which must stay monotonic across restarts so a
 * pre-disposal handler can never collide with a post-disposal socket.
 */
function disposeAisStream() {
  if (_aisStreamTickTimer) {
    clearInterval(_aisStreamTickTimer);
    _aisStreamTickTimer = null;
  }
  if (_aisAdapter) _aisAdapter.dispose();
  // Drop the cached policy and re-arm LAZILY. Re-deriving budgets here would
  // read process.env before the restarted server's loadEnv() has repopulated
  // it, caching the outgoing configuration; the next ensure() runs after that.
  _aisWatchdogPolicy = null;
  _aisNeedsRearm = true;
}

function aisStreamSubscription() {
  return {
    APIKey: process.env.AISSTREAM_API_KEY,
    BoundingBoxes: parseJsonEnv(
      'AISSTREAM_BOUNDING_BOXES',
      AISSTREAM_DEFAULT_BBOXES,
    ),
    FilterMessageTypes: parseCsvOrJsonEnv(
      'AISSTREAM_MESSAGE_TYPES',
      AISSTREAM_DEFAULT_MESSAGE_TYPES,
    ),
  };
}

function parseJsonEnv(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`[AISStream] Invalid ${key}; using default.`);
    return fallback;
  }
}

function parseCsvOrJsonEnv(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
}
