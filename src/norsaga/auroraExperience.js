import { createAuroraPlayback } from './auroraPlayback.js';
const utc = (value) =>
  value ? `${value.slice(0, 16).replace('T', ' ')} UTC` : 'Unavailable';

/** Compact workspace readout and an on-demand official NOAA image player. */
export function initAuroraExperience({
  dataManager,
  parent,
  documentRef: doc = document,
  notifyLayout = () => {},
}) {
  const make = (tag, text, className = '') => {
    const el = doc.createElement(tag);
    if (text !== undefined) el.textContent = text;
    el.className = className;
    return el;
  };
  const removers = [];
  const bind = (el, type, fn) => {
    el.addEventListener(type, fn);
    removers.push(() => el.removeEventListener(type, fn));
  };
  const button = (text, fn, parent) => {
    const el = make('button', text);
    el.type = 'button';
    bind(el, 'click', fn);
    parent.append(el);
    return el;
  };
  const section = make('section', undefined, 'norsaga-aurora');
  const label = make('label', undefined, 'norsaga-layer');
  const input = make('input');
  input.type = 'checkbox';
  input.dataset.norsagaLayer = 'aurora';
  const title = make('span');
  title.append(
    make('strong', 'Aurora Forecast'),
    make('small', 'NOAA SWPC · OVATION'),
  );
  label.append(input, title);
  section.append(label);
  const readout = make('div', undefined, 'norsaga-aurora-readout');
  readout.hidden = true;
  const status = make('p', '', 'norsaga-aurora-status');
  status.setAttribute('role', 'status');
  const forecast = make('p'),
    observed = make('p'),
    kp = make('p'),
    geo = make('p');
  const legend = make('div', undefined, 'norsaga-aurora-legend');
  legend.append(
    make('span', 'OVATION value · 0–100'),
    make('div', undefined, 'norsaga-aurora-ramp'),
    make('span', '5    20    50    75    100', 'norsaga-aurora-scale'),
  );
  legend.title =
    'Relative auroral intensity. Values below 5 are transparent. This is not a local visibility probability.';
  const actions = make('div', undefined, 'norsaga-aurora-actions');
  const inspection = make(
    'p',
    'Read the map center to inspect a NOAA grid value.',
    'norsaga-aurora-reading',
  );
  const module = () => dataManager.layers?.get('aurora')?.module;
  const inspect = button(
    'Read map center',
    () =>
      dataManager.setLayerParams(
        'aurora',
        { inspect: true },
        { origin: 'user' },
      ),
    actions,
  );
  inspect.dataset.auroraAction = 'inspect';
  const opacity = make('select');
  opacity.setAttribute('aria-label', 'Aurora overlay contrast');
  for (const [value, text] of [
    [0.45, 'Subtle'],
    [0.9, 'Clear'],
    [1, 'Strong'],
  ]) {
    const option = make('option', text);
    option.value = String(value);
    opacity.append(option);
  }
  bind(opacity, 'change', () =>
    dataManager.setLayerParams(
      'aurora',
      { opacity: Number(opacity.value) },
      { origin: 'user' },
    ),
  );
  actions.append(opacity);
  const loop = button(
    '▶ NOAA loop',
    () => {
      dialog.showModal();
      void playback.load(hemisphere.value);
    },
    actions,
  );
  loop.dataset.auroraAction = 'history';
  readout.append(
    status,
    forecast,
    observed,
    kp,
    geo,
    legend,
    actions,
    inspection,
  );
  section.append(readout);
  parent.append(section);

  const dialog = make('dialog', undefined, 'norsaga-aurora-dialog');
  dialog.setAttribute('aria-labelledby', 'norsaga-aurora-loop-title');
  const header = make('div', undefined, 'norsaga-dialog-header');
  const heading = make('h2', 'NOAA Aurora Forecast');
  heading.id = 'norsaga-aurora-loop-title';
  header.append(heading);
  button('Close', () => dialog.close(), header);
  const description = make(
    'p',
    'Official NOAA image history. The globe continues to show the latest grid forecast.',
    'norsaga-fineprint',
  );
  const selectors = make('div', undefined, 'norsaga-aurora-player-controls');
  const hemisphere = make('select');
  hemisphere.setAttribute('aria-label', 'Aurora hemisphere');
  for (const [value, text] of [
    ['north', 'Northern hemisphere'],
    ['south', 'Southern hemisphere'],
  ]) {
    const option = make('option', text);
    option.value = value;
    hemisphere.append(option);
  }
  const window = make('select');
  window.setAttribute('aria-label', 'Aurora history duration');
  for (const [value, text] of [
    [30, 'Latest 30 minutes'],
    [1440, 'Latest 24 hours'],
  ]) {
    const option = make('option', text);
    option.value = String(value);
    window.append(option);
  }
  selectors.append(hemisphere, window);
  const imageArea = make('div', undefined, 'norsaga-aurora-image-area');
  const image = make('img');
  image.hidden = true;
  image.alt =
    'Official NOAA OVATION auroral forecast map with probability legend and forecast annotations';
  imageArea.append(image);
  const message = make('p', 'Loading NOAA images…');
  message.setAttribute('role', 'status');
  imageArea.append(message);
  const controls = make('div', undefined, 'norsaga-aurora-player-controls');
  const play = button(
    'Play',
    () => (playback.getState().playing ? playback.pause() : playback.play()),
    controls,
  );
  play.dataset.auroraAction = 'play';
  const previous = button(
    'Previous',
    () => playback.select(playback.getState().selected - 1),
    controls,
  );
  const next = button(
    'Next',
    () => playback.select(playback.getState().selected + 1),
    controls,
  );
  const timeline = make('input');
  timeline.type = 'range';
  timeline.min = '0';
  timeline.step = '1';
  timeline.setAttribute('aria-label', 'NOAA image history timeline');
  controls.append(timeline);
  const time = make('p', '', 'norsaga-aurora-frame-time');
  const credit = make('a', 'Source: NOAA Space Weather Prediction Center');
  credit.href =
    'https://www.spaceweather.gov/products/aurora-30-minute-forecast';
  credit.target = '_blank';
  credit.rel = 'noopener noreferrer';
  dialog.append(
    header,
    description,
    selectors,
    imageArea,
    controls,
    time,
    credit,
  );
  doc.body.append(dialog);
  let imageUrl = null,
    disposed = false,
    subscribedModule = null,
    unsubscribeReadout = null;
  const clearImage = () => {
    image.hidden = true;
    image.removeAttribute('src');
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
  };
  const playback = createAuroraPlayback({
    source: {
      getAnimationIndex: (options) => module().getAnimationIndex(options),
      getAnimationFrame: (url, options) =>
        module().getAnimationFrame(url, options),
    },
    onState(state) {
      play.textContent = state.playing ? 'Pause' : 'Play';
      play.disabled =
        state.frames.length < 2 || (state.loading && !state.playing);
      previous.disabled =
        next.disabled =
        timeline.disabled =
          !state.frames.length;
      timeline.max = String(Math.max(0, state.frames.length - 1));
      timeline.value = String(Math.max(0, state.selected));
      time.textContent = state.time
        ? `Model frame: ${utc(state.time)} · ${state.selected + 1}/${state.frames.length}${state.stale ? ' · cached history' : ''}`
        : '';
      message.textContent =
        state.error || (state.loading ? 'Loading NOAA frame…' : '');
      message.hidden = !message.textContent;
      if (state.error || !state.frames.length) clearImage();
    },
    async onFrame(blob, frameTime, signal) {
      const url = URL.createObjectURL(blob);
      const decoded = new Image();
      decoded.src = url;
      try {
        await decoded.decode();
        signal.throwIfAborted();
        const old = imageUrl;
        imageUrl = url;
        image.src = url;
        image.hidden = false;
        image.alt = `NOAA ${hemisphere.value} auroral forecast · model frame ${utc(frameTime)}`;
        if (old) URL.revokeObjectURL(old);
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    },
  });
  bind(hemisphere, 'change', () => {
    clearImage();
    void playback.load(hemisphere.value);
  });
  bind(window, 'change', () => playback.setWindow(Number(window.value)));
  bind(timeline, 'input', () => void playback.select(Number(timeline.value)));
  bind(dialog, 'close', () => {
    playback.close();
    clearImage();
  });
  bind(doc, 'visibilitychange', () => {
    if (doc.hidden) playback.pause();
  });
  const motion = doc.defaultView?.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  );
  if (motion) bind(motion, 'change', () => playback.pause());
  bind(input, 'change', async () => {
    input.disabled = true;
    try {
      await dataManager.setEnabled('aurora', input.checked, { origin: 'user' });
    } catch {
      status.textContent = 'Aurora source unavailable';
    } finally {
      if (!disposed) {
        input.disabled = false;
        sync();
      }
    }
  });
  function sync() {
    if (disposed) return;
    input.checked = dataManager.isEnabled('aurora');
    readout.hidden = !input.checked;
    const layer = module();
    if (layer !== subscribedModule) {
      unsubscribeReadout?.();
      subscribedModule = layer;
      unsubscribeReadout = layer?.subscribeReadout(sync);
    }
    if (!input.checked && dialog.open) dialog.close();
    const value = layer?.getReadout();
    if (value && input.checked) {
      status.textContent = value.status;
      forecast.textContent = `Forecast: ${utc(value.forecastTime)}`;
      observed.textContent = `Source: ${utc(value.sourceTime)}${value.leadMinutes !== null ? ` · ${value.leadMinutes} min lead` : ''}`;
      kp.textContent = `Kp: ${value.kp}`;
      geo.textContent = value.geomagnetic;
      inspect.disabled = !value.available;
      opacity.value = String(value.opacity);
      loop.disabled = false;
      inspection.textContent = value.reading
        ? value.reading.value === null
          ? value.reading.coordinates
          : `${value.reading.value} / 100 · ${value.reading.coordinates} · nearest 1° cell ${value.reading.cell.latitude}°, ${value.reading.cell.longitude}°`
        : 'Read the map center to inspect a NOAA grid value.';
    }
    notifyLayout();
  }
  const unsubscribe = dataManager.subscribeActivity?.(sync);
  sync();
  return {
    destroy() {
      disposed = true;
      playback.close();
      clearImage();
      unsubscribe?.();
      unsubscribeReadout?.();
      for (const remove of removers) remove();
      dialog.remove();
      section.remove();
    },
  };
}
