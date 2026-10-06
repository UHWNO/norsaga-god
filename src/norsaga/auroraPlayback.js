/** Historical NOAA images; never modifies Cesium's time or the latest globe grid. */
export function createAuroraPlayback({
  source,
  onState = () => {},
  onFrame = async () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let all = [],
    frames = [],
    selected = -1,
    hemisphere = 'north',
    minutes = 30;
  let playing = false,
    loading = false,
    error = null,
    stale = false;
  let request = null,
    timer = null,
    open = false;
  const state = () => ({
    frames,
    selected,
    hemisphere,
    minutes,
    playing,
    loading,
    error,
    stale,
    time: frames[selected]?.time ?? null,
  });
  const notify = () => onState(state());
  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    request?.abort();
    request = null;
    loading = false;
  }
  function pause() {
    playing = false;
    cancel();
    notify();
  }
  const schedule = () => {
    if (playing && open && frames.length > 1)
      timer = setTimer(() => {
        timer = null;
        void select((selected + 1) % frames.length);
      }, 800);
  };
  async function select(index) {
    if (!open || !frames.length) return;
    cancel();
    const owned = new AbortController();
    request = owned;
    const target = Math.max(0, Math.min(frames.length - 1, Math.round(index)));
    loading = true;
    error = null;
    notify();
    try {
      const frame = frames[target];
      const blob = await source.getAnimationFrame(frame.url, {
        signal: owned.signal,
      });
      owned.signal.throwIfAborted();
      await onFrame(blob, frame.time, owned.signal);
      owned.signal.throwIfAborted();
      if (request !== owned || !open) return;
      selected = target;
    } catch (cause) {
      if (owned.signal.aborted || request !== owned) return;
      error = cause?.message || 'NOAA frame unavailable';
      playing = false;
    } finally {
      if (request === owned) {
        request = null;
        loading = false;
        notify();
        schedule();
      }
    }
  }
  function filter() {
    const end = Date.parse(all.at(-1)?.time);
    frames = all.filter(
      (frame) => end - Date.parse(frame.time) <= minutes * 60_000,
    );
    selected = -1;
  }
  return {
    async load(nextHemisphere = hemisphere) {
      pause();
      open = true;
      hemisphere = nextHemisphere;
      all = [];
      frames = [];
      selected = -1;
      const owned = new AbortController();
      request = owned;
      loading = true;
      error = null;
      notify();
      try {
        const result = await source.getAnimationIndex({
          hemisphere,
          signal: owned.signal,
        });
        owned.signal.throwIfAborted();
        if (request !== owned || !open) return;
        all = result.frames;
        stale = result.stale;
        filter();
        request = null;
        loading = false;
        await select(frames.length - 1);
      } catch (cause) {
        if (owned.signal.aborted || request !== owned) return;
        request = null;
        loading = false;
        error = cause?.message || 'NOAA image history unavailable';
        notify();
      }
    },
    setWindow(value) {
      if (![30, 1440].includes(value)) return;
      pause();
      minutes = value;
      filter();
      void select(frames.length - 1);
    },
    select(index) {
      playing = false;
      return select(index);
    },
    play() {
      if (!open || frames.length < 2) return;
      playing = true;
      void select(selected === frames.length - 1 ? 0 : Math.max(0, selected));
    },
    pause,
    close() {
      open = false;
      pause();
      all = [];
      frames = [];
      selected = -1;
      error = null;
      notify();
    },
    getState: state,
  };
}
