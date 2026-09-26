// This is an intentionally lightweight client-side gate, not authentication.
// Anyone with access to the built JavaScript can discover this value.
export const NORSAGA_ACCESS_PASSWORD = '2026Oslo*';
export const INACTIVITY_LOGOUT_MS = 20 * 60 * 1000;
export const MINIMUM_VIEWPORT_WIDTH = 1280;
export const MINIMUM_VIEWPORT_HEIGHT = 720;

const ACTIVITY_EVENTS = Object.freeze([
  'keydown',
  'pointerdown',
  'pointermove',
  'scroll',
  'touchstart',
  'wheel',
  'focus',
]);

export function isPasswordAccepted(candidate) {
  return candidate === NORSAGA_ACCESS_PASSWORD;
}

export function meetsMinimumViewport(width, height) {
  return width >= MINIMUM_VIEWPORT_WIDTH && height >= MINIMUM_VIEWPORT_HEIGHT;
}

/** Renew an unlocked session on user activity and expire it at its deadline. */
export function createInactivityLogout({
  eventTarget,
  onTimeout,
  timeoutMs = INACTIVITY_LOGOUT_MS,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  if (!eventTarget?.addEventListener || !eventTarget?.removeEventListener) {
    throw new TypeError('An event target is required for inactivity logout');
  }
  if (typeof onTimeout !== 'function') {
    throw new TypeError('An inactivity timeout callback is required');
  }

  let deadline = now() + timeoutMs;
  let timer;
  let stopped = false;

  const removeListeners = () => {
    for (const eventName of ACTIVITY_EVENTS) {
      eventTarget.removeEventListener(eventName, handleActivity);
    }
  };

  const expire = () => {
    if (stopped) return;
    const remaining = deadline - now();
    if (remaining > 0) {
      timer = schedule(expire, remaining);
      return;
    }
    stopped = true;
    removeListeners();
    onTimeout();
  };

  const handleActivity = () => {
    if (stopped) return;
    if (now() >= deadline) {
      expire();
      return;
    }
    deadline = now() + timeoutMs;
    cancel(timer);
    timer = schedule(expire, timeoutMs);
  };

  for (const eventName of ACTIVITY_EVENTS) {
    eventTarget.addEventListener(eventName, handleActivity, { passive: true });
  }
  timer = schedule(expire, timeoutMs);

  return () => {
    if (stopped) return;
    stopped = true;
    cancel(timer);
    removeListeners();
  };
}
