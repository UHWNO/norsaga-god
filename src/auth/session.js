import { createInactivityLogout } from '../passwordGateCore.js';
import { accessFetch, signOut } from './client.js';

export function maintainSession() {
  let lastActivity = Date.now();
  let lastPing = Date.now();
  let inFlight = false;
  const activity = () => {
    lastActivity = Date.now();
  };
  for (const type of [
    'pointerdown',
    'pointermove',
    'keydown',
    'touchstart',
    'wheel',
    'scroll',
  ]) {
    window.addEventListener(type, activity, { passive: true });
  }
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      // Passive provider polling cannot keep a session alive indefinitely.
      if (lastActivity > lastPing) {
        await accessFetch('/api/access/activity', {});
        lastPing = Date.now();
      } else await accessFetch('/api/access/status');
    } catch (error) {
      if (error.status === 401) {
        clearInterval(timer);
        location.replace('/login.html');
      }
    } finally {
      inFlight = false;
    }
  }, 60_000);
  createInactivityLogout({
    eventTarget: window,
    onTimeout: () => {
      void signOut().catch(() => location.replace('/login.html'));
    },
  });
}
