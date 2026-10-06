import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindUserGuidePopup,
  userGuidePopupBounds,
  userGuidePopupFeatures,
} from './userGuidePopup.js';

test('guide popup is centered and remains smaller than the available screen', () => {
  const screen = {
    availWidth: 1512,
    availHeight: 900,
    availLeft: 100,
    availTop: 20,
  };
  assert.deepEqual(userGuidePopupBounds(screen), {
    width: 1180,
    height: 774,
    left: 266,
    top: 83,
  });
  assert.match(userGuidePopupFeatures(screen), /popup=yes/);
  assert.match(userGuidePopupFeatures(screen), /width=1180/);
  assert.match(userGuidePopupFeatures(screen), /height=774/);
});

test('guide link opens the named popup and preserves fallback unless it succeeds', () => {
  let listener;
  let removed;
  let focused = 0;
  let prevented = 0;
  const link = {
    href: 'https://example.test/user-guide.html',
    addEventListener: (_, callback) => {
      listener = callback;
    },
    removeEventListener: (_, callback) => {
      removed = callback;
    },
  };
  const calls = [];
  const unbind = bindUserGuidePopup({
    documentRef: { getElementById: () => link },
    windowRef: {
      screen: { availWidth: 1280, availHeight: 800 },
      open: (...args) => {
        calls.push(args);
        return { focus: () => focused++ };
      },
    },
  });
  listener({ preventDefault: () => prevented++ });
  assert.equal(calls[0][1], 'norsaga-user-guide');
  assert.match(calls[0][2], /resizable=yes/);
  assert.equal(prevented, 1);
  assert.equal(focused, 1);
  unbind();
  assert.equal(removed, listener);
});
