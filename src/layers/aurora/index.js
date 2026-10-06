import * as Cesium from 'cesium';
import { createAuroraRendering } from './rendering.js';
import { createAuroraGrid, inspectAuroraAtCenter } from './inspection.js';

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
  let grid = null,
    reading = null,
    opacity = 0.9;
  const readoutListeners = new Set();
  const notify = () => {
    listener?.();
    for (const callback of readoutListeners) callback();
  };
  const expired = () =>
    snapshot &&
    !snapshot.unavailable &&
    (now() - Date.parse(snapshot.forecastTime) > 60 * 60_000 ||
      now() - snapshot.fetchedAt > 60 * 60_000);
  const stale = () =>
    !!snapshot &&
    (snapshot.stale || now() - Date.parse(snapshot.forecastTime) > 5 * 60_000);
  const visibility = () => {
    if (documentRef?.hidden) request?.abort();
    else if (enabled && !destroyed) void layer.update(viewer);
  };
  function supplements() {
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
    return {
      kpText: `${currentKp ? `${currentKp.value.toFixed(2)} ${Date.parse(currentKp.time) > now() ? 'upcoming predicted' : 'predicted'} · ${utc(currentKp.time)}${kp.stale ? ' · stale' : ''}` : 'Unavailable'}`,
      geomagneticText: `${geo?.unavailable || !geo ? 'Unavailable' : alert ? `${alert.scale} ${alert.kind} · until ${utc(alert.validUntil)}${geo.stale ? ' · stale' : ''}` : `No active G-level notice${geo.stale ? ' · stale' : ''}`}`,
    };
  }
  const layer = {
    id: 'aurora',
    name: 'Aurora Forecast',
    icon: '◒',
    source: 'NOAA SWPC · OVATION',
    updateInterval: 120_000,
    init(nextViewer) {
      viewer = nextViewer;
      rendering = createRendering({ viewer, cesium });
      rendering.setOpacity?.(opacity);
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
      grid = null;
      reading = null;
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
        grid =
          next.unavailable || expired() ? null : createAuroraGrid(next.cells);
        reading = null;
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
        grid = null;
        reading = null;
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
    getParams() {
      return { opacity };
    },
    setParams(params = {}) {
      if (
        Number.isFinite(params.opacity) &&
        params.opacity >= 0 &&
        params.opacity <= 1
      ) {
        opacity = params.opacity;
        rendering?.setOpacity?.(opacity);
      }
      if (params.inspect === true && enabled) {
        reading = inspectAuroraAtCenter(
          expired() ? null : grid,
          viewer,
          cesium,
        );
        reading.sourceTime = snapshot?.sourceTime ?? null;
        reading.forecastTime = snapshot?.forecastTime ?? null;
      }
      notify();
    },
    subscribeReadout(callback) {
      readoutListeners.add(callback);
      return () => readoutListeners.delete(callback);
    },
    getReadout() {
      const { kpText, geomagneticText } = supplements();
      return {
        enabled,
        status: loading
          ? snapshot
            ? 'Refreshing'
            : 'Loading'
          : error ||
            (expired() || snapshot?.unavailable || !snapshot
              ? 'Unavailable'
              : stale()
                ? 'Stale / delayed'
                : 'Latest forecast'),
        provider: 'NOAA SWPC · OVATION',
        forecastTime: snapshot?.forecastTime ?? null,
        sourceTime: snapshot?.sourceTime ?? null,
        leadMinutes:
          snapshot && !snapshot.unavailable
            ? Math.round(
                (Date.parse(snapshot.forecastTime) -
                  Date.parse(snapshot.sourceTime)) /
                  60_000,
              )
            : null,
        kp: kpText,
        geomagnetic: geomagneticText,
        reading,
        opacity,
        available: !!grid && !expired(),
      };
    },
    getAnimationIndex(options) {
      return feed.getAnimationIndex(options);
    },
    getAnimationFrame(url, options) {
      return feed.getAnimationFrame(url, options);
    },
    getRowControls() {
      const { kpText, geomagneticText } = supplements();
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
        chips: [
          {
            id: 'inspect',
            label: 'Read map center',
            params: { inspect: true },
            disabled: !grid || expired(),
            title: 'Read the nearest NOAA 1° grid cell at the map center',
          },
          ...[
            [0.45, 'Subtle'],
            [0.9, 'Clear'],
            [1, 'Strong'],
          ].map(([value, label]) => ({
            id: `opacity-${label}`,
            label,
            active: opacity === value,
            params: { opacity: value },
            title: 'Visual opacity; NOAA values stay unchanged',
          })),
        ],
        legend:
          snapshot && !snapshot.unavailable && !expired()
            ? [
                { label: '5–20', color: '#28d714' },
                { label: '20–50', color: '#1eff00' },
                { label: '50–75', color: '#ebff00' },
                { label: '75–100', color: '#ff9600' },
              ]
            : [],
        info: `NOAA SWPC · OVATION · ${status}\nForecast: ${utc(snapshot?.forecastTime)} · Source: ${utc(snapshot?.sourceTime)}\nKp: ${kpText}\nGeomagnetic: ${geomagneticText}`,
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
        inspection: reading,
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
      readoutListeners.clear();
    },
  };
  return layer;
}
