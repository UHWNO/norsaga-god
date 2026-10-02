import test from 'node:test';
import assert from 'node:assert/strict';
import { removeLocalKeySetup } from './startupChrome.js';

test('production removes local credential controls without contacting setup routes', () => {
  const removed = [];
  const nodes = new Map([
    ['key-setup-chip', { remove: () => removed.push('chip') }],
    ['key-setup', { remove: () => removed.push('dialog') }],
  ]);

  assert.equal(
    removeLocalKeySetup({
      documentRef: { getElementById: (id) => nodes.get(id) || null },
    }),
    null,
  );
  assert.deepEqual(removed, ['chip', 'dialog']);
});
