import * as Cesium from 'cesium';
import { createAuroraRendering } from './rendering.js';

const utc = (value) =>
  value ? `${value.slice(0, 16).replace('T', ' ')} UTC` : 'Unavailable';
const DESCRIPTION =
  'NOAA OVATION relative intensity (0–100). Viewing probability is empirically derived from intensity; this is not a location-specific chance accounting for daylight, clouds or viewing conditions. Display height is for map visibility, not auroral altitude. Environmental context; not for navigation, voyage planning or safety decisions.';

/** Static aurora display whose refresh interval belongs to the existing layer manager. */
export function createAuroraLayer({
  feed,
  cesium = Cesium,
  createRendering = createAuroraRendering,
  documentRef = globalThis.document,
  now = () => Date.now(),
} = {}) {
  if (typeof feed?.getSnapshot !== 'function')
    throw new TypeError('Aurora requires a snapshot source');
  let viewer = null,
    rendering = null,
    snapshot = null,
    request = null,
    listener = null;
  let enabled = false,
    destroyed = false,
    loading = false,
    error = null;
  const notify = () => listener?.();
  const expired = () =>
    snapshot &&
    !snapshot.unavailable &&
    now() - Date.parse(snapshot.sourceTime) > 60 * 60_000;
  const stale = () =>
    !!snapshot &&
    (snapshot.stale ||
      now() - Date.parse(snapshot.sourceTime) > 15 * 60_000 ||
      now() - Date.parse(snapshot.forecastTime) > 5 * 60_000);
  const visibility = () => {
    if (documentRef?.hidden) request?.abort();
    else if (enabled && !destroyed) void layer.update(viewer);
  };
  const layer = {
    id: 'aurora',
    name: 'Aurora Forecast',
    icon: '◒',
    source: 'NOAA SWPC · OVATION',
    updateInterval: 120_000,
    init(nextViewer) {
      viewer = nextViewer;
      rendering = createRendering({ viewer, cesium });
    },
    enable() {
      if (destroyed || enabled) return;
      enabled = true;
      documentRef?.addEventListener?.('visibilitychange', visibility);
    },
    disable() {
      enabled = false;
      documentRef?.removeEventListener?.('visibilitychange', visibility);
      request?.abort();
      request = null;
      loading = false;
      error = null;
      snapshot = null;
      rendering?.clear();
      notify();
    },
    async update(_viewer, { signal } = {}) {
      if (!enabled || destroyed) return false;
      if (documentRef?.hidden) return true;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      loading = true;
      notify();
      try {
        controller.signal.throwIfAborted();
        const next = await feed.getSnapshot({ signal: controller.signal });
        if (!enabled || controller.signal.aborted || request !== controller)
          return false;
        snapshot = next;
        if (next.unavailable || expired()) {
          rendering.clear();
          error = next.reason || 'Aurora forecast expired';
        } else {
          if (
            rendering.setSnapshot(next, { signal: controller.signal }) === false
          )
            return false;
          error = null;
        }
        return true;
      } catch (cause) {
        if (controller.signal.aborted || request !== controller) return false;
        // Only the server may offer a bounded last-good snapshot.
        rendering?.clear();
        snapshot = null;
        error = cause?.message || 'Aurora forecast unavailable';
        return true;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (request === controller) {
          request = null;
          loading = false;
          notify();
        }
      }
    },
    getRowControls() {
      const kp = snapshot?.kp,
        geo = snapshot?.geomagnetic;
      const currentKp =
        kp?.current && Date.parse(kp.current.validUntil) > now()
          ? kp.current
          : null;
      const alert =
        geo?.active && Date.parse(geo.active.validUntil) > now()
          ? geo.active
          : null;
      const status =
        error ||
        (loading
          ? 'Loading…'
          : expired()
            ? 'Unavailable · expired'
            : stale()
              ? 'Stale / delayed forecast'
              : snapshot?.unavailable || !snapshot
                ? 'Unavailable'
                : 'Latest forecast');
      return {
        chips: [],
        legend:
          snapshot && !snapshot.unavailable && !expired()
            ? [
                { label: 'OVATION 5–50', color: '#72c77d' },
                { label: '50–100', color: '#d7cd5a' },
              ]
            : [],
        info: `NOAA SWPC · OVATION · ${status}\nForecast: ${utc(snapshot?.forecastTime)} · Source: ${utc(snapshot?.sourceTime)}\nKp: ${currentKp ? `${currentKp.value.toFixed(2)} ${Date.parse(currentKp.time) > now() ? 'upcoming predicted' : 'predicted'} · ${utc(currentKp.time)}${kp.stale ? ' · stale' : ''}` : 'Unavailable'}\nGeomagnetic: ${geo?.unavailable || !geo ? 'Unavailable' : alert ? `${alert.scale} ${alert.kind} · until ${utc(alert.validUntil)}${geo.stale ? ' · stale' : ''}` : `No active G-level notice${geo.stale ? ' · stale' : ''}`}`,
        infoTitle: DESCRIPTION,
      };
    },
    setRowControlsListener(value) {
      listener = typeof value === 'function' ? value : null;
    },
    getStats() {
      const unavailable =
        !!error || !snapshot || snapshot.unavailable || !!expired();
      return {
        count: rendering?.getDiagnostics().count || 0,
        lastUpdate: unavailable ? null : Date.parse(snapshot.sourceTime),
        loading,
        error,
        stale: stale(),
        unavailable,
        status:
          unavailable && !loading
            ? 'unavailable'
            : stale()
              ? 'stale'
              : 'nominal',
        source: 'NOAA SWPC · OVATION',
        forecastTime: snapshot?.forecastTime ?? null,
      };
    },
    getDiagnostics() {
      return {
        ...rendering?.getDiagnostics(),
        enabled,
        loading,
        requestPending: !!request,
        sourceTime: snapshot?.sourceTime ?? null,
        forecastTime: snapshot?.forecastTime ?? null,
        stale: stale(),
        unavailable: !!layer.getStats().unavailable,
        timerActive: false,
      };
    },
    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      rendering?.destroy();
      rendering = null;
      viewer = null;
      listener = null;
    },
  };
  return layer;
}
