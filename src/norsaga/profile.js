/** NorSaga presentation presets, not chart boundaries or navigable routes. */
export const REGIONS = Object.freeze(
  [
    ['global', 'Global maritime overview', 10, 35, 22000000],
    ['baltic', 'Baltic Sea', 20, 59, 2300000],
    ['gulf-of-finland', 'Gulf of Finland', 27, 60, 650000],
    ['gulf-of-bothnia', 'Gulf of Bothnia', 21, 63.5, 1000000],
    ['danish-straits', 'Danish Straits', 11, 56, 650000],
    ['north-sea', 'North Sea', 3, 57, 1700000],
    ['norwegian-sea', 'Norwegian Sea', 2, 68, 2200000],
    ['barents-sea', 'Barents Sea', 35, 74, 2000000],
    ['svalbard', 'Svalbard', 18, 78, 1000000],
    ['greenland-sea', 'Greenland Sea', -5, 76, 2000000],
    ['arctic', 'Arctic overview', 0, 89, 6500000],
    ['northern-sea-route', 'Northern Sea Route overview', 110, 76, 4300000],
  ].map(([id, label, longitude, latitude, height]) =>
    Object.freeze({ id, label, longitude, latitude, height }),
  ),
);

export const MARITIME_LAYERS = Object.freeze([
  Object.freeze({ id: 'ais-live-vessels', label: 'Vessels / AIS', note: 'Provider key required' }),
  Object.freeze({ id: 'wind', label: 'Wind forecast', note: 'Forecast, not observed conditions' }),
  Object.freeze({ id: 'weather-satellite', label: 'Weather imagery', note: 'Coverage varies by provider' }),
]);
const maritime = Object.freeze(['ais-live-vessels', 'wind', 'weather-satellite']);
export const MISSIONS = Object.freeze([
  Object.freeze({ id: 'global-maritime', label: 'Global maritime', region: 'global', layers: maritime, description: 'Vessels, wind forecasts and weather imagery.' }),
  Object.freeze({ id: 'baltic', label: 'Baltic Sea', region: 'baltic', layers: maritime, description: 'Open the Baltic with vessel and weather layers.' }),
  Object.freeze({ id: 'arctic', label: 'Arctic', region: 'arctic', layers: maritime, description: 'Vessels and weather. Sea-ice charts are not connected yet.' }),
  Object.freeze({ id: 'overview', label: 'Global overview', region: 'global', layers: Object.freeze([]), description: 'Explore the globe. Keep your current layer selection.' }),
]);

export function getRegion(id) {
  const region = REGIONS.find((entry) => entry.id === id);
  if (!region) throw new RangeError(`Unknown NorSaga region: ${id}`);
  return region;
}

/** Bound a UI wait; a timed-out provider request is not reported as successful. */
function requestLayer(id, setEnabled, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const finish = (outcome, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ id, outcome });
    };
    const abort = () => finish(null, signal.reason || new Error('Cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    timer = setTimeout(() => finish('pending'), timeoutMs);
    Promise.resolve()
      .then(() => {
        signal?.throwIfAborted();
        return setEnabled(id, true, { origin: 'user' });
      })
      .then(
        (result) => finish(result === false ? 'unavailable' : 'requested'),
        () => finish('unavailable'),
      );
  });
}

/** A deliberate preset adds only its own layers; other user selections survive. */
export async function runMission(id, { navigate, setEnabled, signal, timeoutMs = 10000 }) {
  const mission = MISSIONS.find((entry) => entry.id === id);
  if (!mission) throw new RangeError(`Unknown NorSaga mission: ${id}`);
  if (typeof navigate !== 'function' || typeof setEnabled !== 'function')
    throw new TypeError('Navigation and layer actions are required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('timeoutMs must be positive');
  signal?.throwIfAborted();
  if ((await navigate(mission.region)) === false)
    return { ok: false, reason: 'navigation-blocked', layers: [] };
  signal?.throwIfAborted();
  const layers = await Promise.all(
    mission.layers.map((layer) => requestLayer(layer, setEnabled, signal, timeoutMs)),
  );
  signal?.throwIfAborted();
  return { ok: true, region: mission.region, layers };
}
