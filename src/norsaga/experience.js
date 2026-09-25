import { REGIONS, MISSIONS, MARITIME_LAYERS, runMission } from './profile.js';
import { navigateRegion } from './camera.js';
import {
  shouldShowFirstRun,
  setFirstRunSuppressed,
  rememberFirstRunSessionDismissed,
  runFirstRunChoice,
} from '../firstRunExperience.js';

/** NorSaga-only presentation. Upstream layer IDs, saved state and engines stay intact. */
export function initNorSagaExperience({
  styleManager,
  dataManager,
  viewer,
  signal,
  documentRef = document,
}) {
  if (signal?.aborted) return { destroy() {} };
  const doc = documentRef;
  const lifetime = new AbortController();
  const removers = [];
  const layerInputs = new Map();
  let activeRequest;
  let busy = false;
  let disposed = false;
  const make = (tag, className, text) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const bind = (element, type, handler) => {
    element.addEventListener(type, handler);
    removers.push(() => element.removeEventListener(type, handler));
  };
  const button = (label, action, parent, className = '') => {
    const element = make('button', className, label);
    element.type = 'button';
    bind(element, 'click', action);
    parent.append(element);
    return element;
  };

  const toolbar = make('nav', 'norsaga-operations');
  toolbar.id = 'norsaga-operations';
  toolbar.setAttribute('aria-label', 'NorSaga maritime workspace');
  const toolbarHead = make('div', 'norsaga-toolbar-head');
  toolbarHead.append(make('span', 'norsaga-eyebrow', 'MARITIME WORKSPACE'));
  toolbar.append(toolbarHead);
  const selectLabel = make('label', 'norsaga-region-label', 'Fly to region');
  const select = make('select', 'norsaga-region-select');
  select.id = 'norsaga-region';
  selectLabel.htmlFor = select.id;
  select.append(new Option('Choose operating area', ''));
  for (const region of REGIONS)
    select.append(new Option(region.label, region.id));
  toolbar.append(selectLabel, select);
  const details = make('details', 'norsaga-layers');
  details.append(make('summary', '', 'Maritime layers'));
  const layerList = make('div', 'norsaga-layer-list');
  for (const layer of MARITIME_LAYERS) {
    const label = make('label', 'norsaga-layer');
    const input = make('input');
    input.type = 'checkbox';
    input.dataset.norsagaLayer = layer.id;
    layerInputs.set(layer.id, input);
    const words = make('span');
    words.append(
      make('strong', '', layer.label),
      make('small', '', layer.note),
    );
    label.append(input, words);
    layerList.append(label);
    bind(input, 'change', async () => {
      input.disabled = true;
      try {
        const accepted = await dataManager.setEnabled(layer.id, input.checked, {
          origin: 'user',
        });
        if (!disposed)
          report(
            accepted === false
              ? 'Feed request could not complete. Check Data Layers.'
              : 'Layer selection updated. Check Data Layers for source status.',
          );
      } catch {
        if (!disposed)
          report('Feed request failed. Check Data Layers for details.');
      } finally {
        if (!disposed) {
          input.disabled = false;
          syncLayers();
        }
      }
    });
  }
  layerList.append(
    make(
      'p',
      'norsaga-fineprint',
      'Use Data Layers for all sources and their availability. An enabled layer is not proof of live coverage.',
    ),
  );
  details.append(layerList);
  toolbar.append(details);
  const status = make('p', 'norsaga-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  toolbar.append(status);

  const dialog = make('dialog', 'norsaga-dialog');
  dialog.id = 'norsaga-launcher';
  dialog.setAttribute('aria-labelledby', 'norsaga-launch-title');
  const header = make('div', 'norsaga-dialog-header');
  header.append(
    make('span', 'norsaga-eyebrow', 'NORSAGA / MARITIME INTELLIGENCE'),
  );
  button('Close', () => dialog.close(), header, 'norsaga-text-button');
  const title = make('h2', '', 'Choose your maritime view');
  title.id = 'norsaga-launch-title';
  dialog.append(
    header,
    title,
    make('p', 'norsaga-intro', 'Maritime technology. Secure by design.'),
  );
  const choices = make('div', 'norsaga-missions');
  for (const mission of MISSIONS) {
    const choice = button(
      '',
      () => launch(mission.id),
      choices,
      'norsaga-mission',
    );
    choice.dataset.norsagaMission = mission.id;
    choice.append(
      make('strong', '', mission.label),
      make('span', '', mission.description),
    );
  }
  dialog.append(choices);
  const advanced = make('details', 'norsaga-advanced');
  advanced.append(make('summary', '', 'Other exploration modes'));
  const advancedChoices = make('div', 'norsaga-advanced-choices');
  for (const [id, label] of [
    ['contacts', 'Live contacts'],
    ['space-missions', 'Space missions'],
    ['environmental', 'Environmental'],
  ])
    button(label, () => launch(id, true), advancedChoices);
  advanced.append(advancedChoices);
  dialog.append(advanced);
  const suppressLabel = make('label', 'norsaga-suppress');
  const suppress = make('input');
  suppress.type = 'checkbox';
  suppressLabel.append(
    suppress,
    doc.createTextNode('Do not show this at startup'),
  );
  const dialogStatus = make('p', 'norsaga-status');
  dialogStatus.setAttribute('role', 'status');
  dialog.append(
    suppressLabel,
    dialogStatus,
    make(
      'p',
      'norsaga-fineprint',
      'Situational intelligence only. Not for navigation or safety-critical decisions. AIS requires a configured provider; availability and coverage vary.',
    ),
  );

  const about = make('dialog', 'norsaga-dialog norsaga-about');
  about.setAttribute('aria-labelledby', 'norsaga-about-title');
  const aboutTitle = make('h2', '', 'About this workspace');
  aboutTitle.id = 'norsaga-about-title';
  about.append(
    aboutTitle,
    make(
      'p',
      '',
      'NorSaga Maritime Intelligence AS. Built on God’s Eye View by Bilawal Sidhu, using CesiumJS.',
    ),
  );
  about.append(
    make(
      'p',
      '',
      'The source-code license and third-party data licenses are separate. This evaluation branch is not cleared for commercial deployment. Required map and data-provider credits remain available on the globe.',
    ),
  );
  const links = make('div', 'norsaga-about-links');
  for (const [path, label] of [
    ['LICENSE', 'Software license'],
    ['THIRD_PARTY_NOTICES.md', 'Third-party notices'],
    ['docs/NORSAGA_DATA_COMPLIANCE.md', 'Data-source review'],
  ]) {
    const link = make('a', '', label);
    link.href = `https://github.com/UHWNO/norsaga-god/blob/norsaga-maritime-v1/${path}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  about.append(links);
  button('Close', () => about.close(), about);
  button('Views', () => dialog.showModal(), toolbarHead);
  button('About', () => about.showModal(), toolbarHead);
  doc.body.append(toolbar, dialog, about);

  function report(message) {
    status.textContent = message;
    dialogStatus.textContent = message;
  }
  function syncLayers() {
    for (const [id, input] of layerInputs)
      input.checked = dataManager.isEnabled(id);
  }
  async function launch(id, legacy = false) {
    if (busy || disposed) return;
    busy = true;
    activeRequest = new AbortController();
    const request = activeRequest;
    const controls = [
      ...choices.querySelectorAll('button'),
      ...advancedChoices.querySelectorAll('button'),
    ];
    controls.forEach((control) => {
      control.disabled = true;
    });
    select.disabled = true;
    report('Opening the view and requesting selected feeds…');
    try {
      const result = legacy
        ? await runFirstRunChoice(id, {
            setContextMode: (mode) => styleManager.setContextMode(mode),
            setLayerEnabled: (layer) =>
              dataManager.setEnabled(layer, true, { origin: 'user' }),
            flyToGlobe: () => styleManager.resetToGlobeView(),
          })
        : await runMission(id, {
            navigate: (region) => navigateRegion(styleManager, viewer, region),
            setEnabled: (...args) => dataManager.setEnabled(...args),
            signal: request.signal,
          });
      if (disposed || request.signal.aborted) return;
      if (!result.ok) {
        report(
          'The view could not start. Leave cockpit mode or check Data Layers, then retry.',
        );
        return;
      }
      const incomplete = result.layers?.some(
        (layer) => layer.outcome !== 'requested',
      );
      report(
        incomplete
          ? 'View opened. Some feed requests are pending or unavailable; check Data Layers.'
          : 'View selected. Data Layers shows feed availability and source status.',
      );
      dialog.close();
    } catch (error) {
      if (!disposed && !request.signal.aborted)
        report(
          'The view could not start. Try Global overview or check Data Layers.',
        );
    } finally {
      if (!disposed) {
        busy = false;
        controls.forEach((control) => {
          control.disabled = false;
        });
        select.disabled = false;
        syncLayers();
      }
      if (activeRequest === request) activeRequest = null;
    }
  }
  bind(select, 'change', () => {
    if (!select.value) return;
    try {
      const ok = navigateRegion(styleManager, viewer, select.value);
      report(
        ok === false
          ? 'Leave cockpit mode before changing the operating area.'
          : 'Region view selected. This changes the camera, not data coverage.',
      );
    } catch {
      report('This region could not open.');
    }
    select.value = '';
  });
  bind(dialog, 'close', () => {
    activeRequest?.abort();
    if (disposed) return;
    rememberFirstRunSessionDismissed();
    if (suppress.checked && !setFirstRunSuppressed(true))
      report('The view preference could not be saved in this browser.');
  });
  const unsubscribe = dataManager.subscribeActivity?.(() => {
    if (!disposed) syncLayers();
  });
  syncLayers();
  if (shouldShowFirstRun({ hasShareState: styleManager.hasShareState }))
    dialog.showModal();
  function destroy() {
    if (disposed) return;
    disposed = true;
    activeRequest?.abort();
    lifetime.abort();
    signal?.removeEventListener('abort', destroy);
    unsubscribe?.();
    for (const remove of removers) remove();
    toolbar.remove();
    dialog.remove();
    about.remove();
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { destroy };
}
