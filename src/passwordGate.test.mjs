import assert from 'node:assert/strict';
import {
  createInactivityLogout,
  INACTIVITY_LOGOUT_MS,
  isPasswordAccepted,
  meetsMinimumViewport,
  MINIMUM_VIEWPORT_HEIGHT,
  MINIMUM_VIEWPORT_WIDTH,
  NORSAGA_ACCESS_PASSWORD,
} from './passwordGateCore.js';

assert.equal(isPasswordAccepted(NORSAGA_ACCESS_PASSWORD), true);
assert.equal(isPasswordAccepted('NORSAGA'), false);
assert.equal(isPasswordAccepted(` ${NORSAGA_ACCESS_PASSWORD} `), false);
assert.equal(isPasswordAccepted(''), false);
assert.equal(INACTIVITY_LOGOUT_MS, 1_200_000);
assert.equal(MINIMUM_VIEWPORT_WIDTH, 1280);
assert.equal(MINIMUM_VIEWPORT_HEIGHT, 720);
assert.equal(meetsMinimumViewport(1280, 720), true);
assert.equal(meetsMinimumViewport(1279, 720), false);
assert.equal(meetsMinimumViewport(1280, 719), false);

const listeners = new Map();
const eventTarget = {
  addEventListener(name, listener) {
    listeners.set(name, listener);
  },
  removeEventListener(name, listener) {
    if (listeners.get(name) === listener) listeners.delete(name);
  },
};
let currentTime = 0;
let pendingTimer;
let logoutCount = 0;
const stop = createInactivityLogout({
  eventTarget,
  onTimeout: () => logoutCount++,
  now: () => currentTime,
  schedule: (callback) => {
    pendingTimer = callback;
    return callback;
  },
  cancel: () => {},
});

currentTime = INACTIVITY_LOGOUT_MS - 1;
listeners.get('keydown')();
currentTime = INACTIVITY_LOGOUT_MS;
pendingTimer();
assert.equal(logoutCount, 0, 'recent activity renews the session deadline');

currentTime = INACTIVITY_LOGOUT_MS * 2 - 1;
pendingTimer();
assert.equal(logoutCount, 1, 'twenty inactive minutes logs the session out');
assert.equal(listeners.size, 0, 'expiration releases activity listeners');
stop();
