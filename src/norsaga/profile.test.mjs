import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, MISSIONS, MARITIME_LAYERS, getRegion, runMission } from './profile.js';

test('all regional camera presets have unique ids and valid coordinates', () => {
  assert.equal(REGIONS.length, 12);
  assert.equal(new Set(REGIONS.map((r) => r.id)).size, REGIONS.length);
  for (const region of REGIONS) {
    assert.ok(Math.abs(region.latitude) <= 90);
    assert.ok(Math.abs(region.longitude) <= 180);
    assert.ok(region.height > 0);
    assert.equal(getRegion(region.id), region);
    assert.ok(Object.isFrozen(region));
  }
});
test('unknown regions and missions fail before doing work', async () => {
  assert.throws(() => getRegion('__proto__'), RangeError);
  await assert.rejects(runMission('unknown', {}), RangeError);
});
test('maritime missions use only implemented layers, never commercial cable data or fictional ice feeds', () => {
  const ids = new Set(MARITIME_LAYERS.map((layer) => layer.id));
  for (const mission of MISSIONS) {
    assert.ok(getRegion(mission.region));
    for (const id of mission.layers) assert.ok(ids.has(id));
  }
  assert.match(MISSIONS.find((m) => m.id === 'arctic').description, /not connected/);
});
test('Baltic selection navigates and explicitly requests only maritime layers', async () => {
  const calls = [];
  const result = await runMission('baltic', {
    navigate: (region) => { calls.push(['navigate', region]); return true; },
    setEnabled: (...args) => { calls.push(args); return true; },
  });
  assert.deepEqual(calls[0], ['navigate', 'baltic']);
  assert.equal(calls.length, 4);
  for (const call of calls.slice(1)) {
    assert.equal(call[1], true);
    assert.deepEqual(call[2], { origin: 'user' });
  }
  assert.ok(result.layers.every((l) => l.outcome === 'requested'));
});
test('global overview does not enable or disable any feed', async () => {
  const result = await runMission('overview', {
    navigate: () => true,
    setEnabled: () => assert.fail('No layer mutation expected'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.layers, []);
});
test('camera ownership refusal prevents all feed changes', async () => {
  const result = await runMission('arctic', {
    navigate: () => false,
    setEnabled: () => assert.fail('No layer mutation expected'),
  });
  assert.equal(result.ok, false);
});
test('a missing key does not prevent the geographic view opening', async () => {
  const result = await runMission('global-maritime', {
    navigate: () => true,
    setEnabled: (id) => id !== 'ais-live-vessels',
  });
  assert.equal(result.ok, true);
  assert.equal(result.layers[0].outcome, 'unavailable');
});
test('a provider exception is reported as unavailable', async () => {
  const result = await runMission('baltic', {
    navigate: () => true,
    setEnabled: () => { throw new Error('offline'); },
  });
  assert.ok(result.layers.every((l) => l.outcome === 'unavailable'));
});
test('a stalled feed does not trap the launcher forever', async () => {
  const result = await runMission('arctic', {
    navigate: () => true,
    setEnabled: () => new Promise(() => {}),
    timeoutMs: 5,
  });
  assert.ok(result.layers.every((l) => l.outcome === 'pending'));
});
test('teardown before a mission causes no navigation or network work', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runMission('baltic', {
    signal: controller.signal,
    navigate: () => assert.fail('No navigation expected'),
    setEnabled: () => assert.fail('No layer mutation expected'),
  }), { name: 'AbortError' });
});
test('teardown during provider waits cancels the UI wait', async () => {
  const controller = new AbortController();
  const result = runMission('baltic', {
    signal: controller.signal,
    navigate: () => true,
    setEnabled: () => new Promise(() => {}),
  });
  await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});
test('invalid wait budget is rejected', async () => {
  await assert.rejects(runMission('overview', {
    navigate: () => true, setEnabled: () => true, timeoutMs: Infinity,
  }), RangeError);
});
