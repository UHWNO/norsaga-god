import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// mgrs is CommonJS; stub only that import so Node can exercise the real HUD.
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'mgrs'
      ? { url: 'hud-summary-test:mgrs', shortCircuit: true }
      : next(specifier, context);
  },
  load(url, context, next) {
    return url === 'hud-summary-test:mgrs'
      ? {
          format: 'module',
          source: 'export function forward() { return ""; }',
          shortCircuit: true,
        }
      : next(url, context);
  },
});
const { IntelHUD } = await import('./hud.js');

const EMPTY_CONTEXT = {
  placeLabels: [],
  streetLabels: [],
  nearbyPlaceLabels: [],
  enabledLayerLabels: [],
  feedProvenance: { overall: null, layers: [] },
};

function fixture(
  t,
  context = EMPTY_CONTEXT,
  summary = 'God s Eye View unavailable',
) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const output = { textContent: '' };
  globalThis.document = {
    getElementById(id) {
      if (id === 'hud-summary') return output;
      if (id === 'hud-mode') return { textContent: 'NORMAL' };
      return null;
    },
  };
  globalThis.window = { setTimeout, clearTimeout };
  const requests = [];
  const hud = Object.assign(Object.create(IntelHUD.prototype), {
    viewer: { camera: { computeViewRectangle: () => undefined } },
    _latestMetrics: {
      latDeg: 89,
      lonDeg: 0,
      altM: 6500000,
      altMslM: 6500000,
      sunEl: -10,
      ona: 0,
    },
    _dataManager: null,
    _summaryDirty: true,
    _summaryRevision: 0,
    _summaryRequest: null,
    _lastSummarySignature: '',
    _summaryTypingInterval: null,
    summaryPolicy: {},
    _summaryContext: async () => context,
    summaryService: {
      async summarize(input) {
        requests.push(input);
        return { ok: true, status: 200, data: { summary, error: null } };
      },
    },
  });
  t.after(() => {
    clearInterval(hud._summaryTypingInterval);
    hud._summaryRequest?.abort();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  return { hud, output, requests };
}

test('an empty Arctic view displays camera telemetry without an AI request', async (t) => {
  const { hud, output, requests } = fixture(t);
  await hud._updateSummary();
  assert.equal(requests.length, 0);
  assert.equal(output.textContent, hud._composeSummary());
  assert.match(output.textContent, /ARCTIC/);
  assert.match(output.textContent, /ALT 6500\.0KM/);
  assert.doesNotMatch(output.textContent, /unavailable/i);

  hud._latestMetrics.latDeg = -80;
  hud._markSummaryDirty();
  await hud._updateSummary();
  assert.match(output.textContent, /ANTARCTIC/);
  assert.equal(requests.length, 0);
});

test('a labelled view keeps its useful AI description', async (t) => {
  const context = { ...EMPTY_CONTEXT, placeLabels: ['Tromsø'] };
  const { hud, output, requests } = fixture(
    t,
    context,
    'Tromsø coastline beneath Arctic skies',
  );
  await hud._updateSummary();
  assert.deepEqual(requests, [context]);
  assert.equal(output.textContent, 'Tromsø coastline beneath Arctic skies');
});

test('invented unavailability falls back to telemetry for a nominal AIS feed', async (t) => {
  const context = {
    ...EMPTY_CONTEXT,
    enabledLayerLabels: ['Live AIS Vessels'],
    feedProvenance: { overall: 'nominal', layers: [{ feedState: 'nominal' }] },
  };
  const { hud, output, requests } = fixture(t, context);
  await hud._updateSummary();
  assert.equal(requests.length, 1);
  assert.equal(output.textContent, hud._composeSummary());
  assert.doesNotMatch(output.textContent, /unavailable/i);
});

test('a real unavailable layer remains visible in the view summary', async (t) => {
  const context = {
    ...EMPTY_CONTEXT,
    enabledLayerLabels: ['Aurora Forecast'],
    feedProvenance: {
      overall: 'unavailable',
      layers: [{ feedState: 'unavailable' }],
    },
  };
  const { hud, output } = fixture(
    t,
    context,
    'Arctic aurora unavailable over ocean',
  );
  await hud._updateSummary();
  assert.equal(output.textContent, 'Arctic aurora unavailable over ocean');
});

test('an in-flight AI reply cannot overwrite a newer empty view', async (t) => {
  const { hud, output } = fixture(t, {
    ...EMPTY_CONTEXT,
    placeLabels: ['Tromsø'],
  });
  let finish;
  hud.summaryService.summarize = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = hud._updateSummary();
  await Promise.resolve();
  assert.equal(typeof finish, 'function');
  hud._summaryContext = async () => EMPTY_CONTEXT;
  hud._markSummaryDirty();
  await hud._updateSummary();
  const telemetry = output.textContent;
  finish({
    ok: true,
    status: 200,
    data: { summary: 'God s Eye View unavailable' },
  });
  await pending;
  assert.equal(output.textContent, telemetry);
  assert.equal(hud._summaryRequest, null);
});

test('replacing a typing summary cancels the old text animation', async (t) => {
  const { hud, output } = fixture(t);
  hud._setSummaryText('God s Eye View unavailable', true);
  hud._setSummaryText(hud._composeSummary(), false);
  const telemetry = output.textContent;
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(output.textContent, telemetry);
  assert.equal(hud._summaryTypingInterval, null);
});
