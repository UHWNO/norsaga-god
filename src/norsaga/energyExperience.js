const LAYERS = [
  ['offshore-oil-gas', 'Oil & Gas Installations'],
  ['offshore-wind', 'Offshore Wind Farms'],
];

/** Beginner-friendly search and source-aware details; all provider text stays text. */
export function initEnergyExperience({
  dataManager,
  parent,
  documentRef: doc = document,
  notifyLayout = () => {},
}) {
  const removers = [];
  const make = (tag, text) => {
    const el = doc.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const bind = (el, type, fn) => {
    el.addEventListener(type, fn);
    removers.push(() => el.removeEventListener(type, fn));
  };
  const section = make('details');
  section.className = 'norsaga-energy';
  section.id = 'norsaga-energy';
  section.append(make('summary', 'Offshore energy — search & details'));
  section.append(
    make(
      'p',
      'Enable an energy layer above, then search or click a map marker. Operating sites appear by default. Change the status filters below to see other sites.',
    ),
  );
  section.append(
    make(
      'p',
      'Amber markers: oil and gas. Teal markers and areas: offshore wind.',
    ),
  );
  const filterControls = new Map();
  for (const [id, name] of LAYERS) {
    const label = make('label', `${name} status`);
    const filter = make('select');
    filter.setAttribute('aria-label', `${name} status`);
    for (const [value, text] of [
      ['operational', 'Operating'],
      ['planned', 'Planned / Building'],
      ['retired', 'Retired'],
      ['all', 'All Statuses'],
    ]) {
      const option = make('option', text);
      option.value = value;
      filter.append(option);
    }
    bind(filter, 'change', () =>
      dataManager.setLayerParams(
        id,
        { status: filter.value },
        { origin: 'user' },
      ),
    );
    filterControls.set(id, filter);
    label.append(filter);
    section.append(label);
  }
  const input = make('input');
  input.type = 'search';
  input.placeholder = 'Name, operator, or country';
  input.maxLength = 100;
  input.setAttribute('aria-label', 'Search enabled offshore energy layers');
  const status = make('p');
  status.setAttribute('role', 'status');
  const results = make('div');
  results.className = 'norsaga-energy-results';
  const info = make('section');
  info.className = 'norsaga-energy-card';
  info.hidden = true;
  info.setAttribute('aria-label', 'Selected offshore installation');
  const sources = make('details');
  sources.append(make('summary', 'Sources & data dates'));
  const sourceList = make('div');
  sources.append(sourceList);
  section.append(input, status, results, info, sources);
  parent.append(section);
  let selectedLayer = null,
    lastSelection = null;
  const modules = () =>
    LAYERS.map(([id, label]) => ({
      id,
      label,
      module: dataManager.layers?.get(id)?.module,
    })).filter((x) => x.module);
  function showCard() {
    const active = modules().find((x) => x.id === selectedLayer),
      record = active?.module.getReadout().selected;
    info.replaceChildren();
    info.hidden = !record;
    if (!record) return;
    info.append(make('h3', record.name));
    const fields = [
      ['Country', record.country],
      ['Type', record.type],
      ['Status', record.statusText],
      ['Operator', record.operator],
      [
        'Capacity',
        record.capacityMW === null ? null : `${record.capacityMW} MW`,
      ],
      ['Turbines', record.turbines],
      [
        'Water depth',
        record.waterDepthM === null ? null : `${record.waterDepthM} m`,
      ],
      ['Position', `${record.lat.toFixed(5)}, ${record.lon.toFixed(5)}`],
      ['Source', record.source],
      ['Published revision', record.sourceRevision],
      ['Record updated', record.recordUpdated],
      ['Record update year', record.recordUpdateYear],
    ];
    for (const [label, value] of fields)
      if (value !== null && value !== undefined && value !== '')
        info.append(make('p', `${label}: ${value}`));
    const link = make('a', 'View source and metadata');
    link.href = record.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    info.append(link);
    const nearby = make('button', 'Show AIS around this site');
    nearby.type = 'button';
    nearby.onclick = async () => {
      nearby.disabled = true;
      try {
        const result = await dataManager.setEnabled('ais-live-vessels', true, {
          origin: 'user',
        });
        active.module.select(record.id);
        status.textContent =
          result === false
            ? 'AIS could not load. Check Data Layers for provider availability.'
            : 'AIS enabled. Vessel coverage depends on your AIS provider; this does not indicate vessels are present.';
      } catch {
        status.textContent = 'AIS is unavailable. Check Data Layers.';
      } finally {
        nearby.disabled = false;
      }
    };
    info.append(nearby);
  }
  function sync() {
    for (const entry of modules()) {
      const filter = filterControls.get(entry.id);
      filter.value = entry.module.getParams().status;
      filter.disabled = !entry.module.getReadout().enabled;
    }
    const active = modules().filter((x) => x.module.getReadout().enabled);
    results.replaceChildren();
    sourceList.replaceChildren();
    input.disabled = active.length === 0;
    let total = 0;
    const found = [];
    for (const entry of active) {
      const state = entry.module.getReadout();
      total += state.count;
      found.push(
        ...entry.module
          .search(input.value)
          .map((record) => ({ record, entry })),
      );
      for (const source of state.sources)
        sourceList.append(
          make(
            'p',
            `${source.label}${source.id.endsWith('areas') ? ' (boundaries)' : ''} · ${!source.available ? 'Unavailable' : source.stale ? 'Cached; refresh failed' : 'Available'}${source.revision ? ` · published ${source.revision}` : ''}${source.fetchedAt ? ` · checked ${new Date(source.fetchedAt).toLocaleDateString('en-US')}` : ''}`,
          ),
        );
    }
    status.textContent = !active.length
      ? 'Enable Oil & Gas Installations or Offshore Wind Farms to begin.'
      : active.some((x) => x.module.getReadout().loading)
        ? 'Loading offshore registers…'
        : active.some((x) => x.module.getReadout().error)
          ? active
              .map((x) => x.module.getReadout().error)
              .filter(Boolean)
              .join(' ')
          : `${total} sites match the status filters. ${input.value ? `${found.length}${found.length >= 30 ? '+' : ''} search results.` : 'Enter a name, operator, or country to search.'}`;
    if (input.value.trim())
      for (const { record, entry } of found.slice(0, 30)) {
        const button = make('button', `${record.name} · ${record.country}`);
        button.type = 'button';
        button.onclick = () => {
          selectedLayer = entry.id;
          entry.module.select(record.id);
        };
        results.append(button);
      }
    showCard();
    notifyLayout();
  }
  bind(input, 'input', sync);
  bind(section, 'toggle', notifyLayout);
  bind(sources, 'toggle', notifyLayout);
  for (const entry of modules())
    removers.push(
      entry.module.subscribeReadout(() => {
        const selected = entry.module.getReadout().selected;
        const selectionKey = selected ? `${entry.id}/${selected.id}` : null;
        const changed = selectionKey && selectionKey !== lastSelection;
        if (selected) {
          selectedLayer = entry.id;
          section.open = true;
          lastSelection = selectionKey;
        } else if (selectedLayer === entry.id) lastSelection = null;
        sync();
        if (changed) info.scrollIntoView?.({ block: 'nearest' });
      }),
    );
  const unsubscribe = dataManager.subscribeActivity?.((change) => {
    if (!change?.layerId || LAYERS.some(([id]) => id === change.layerId))
      sync();
  });
  if (unsubscribe) removers.push(unsubscribe);
  sync();
  return {
    destroy() {
      for (const remove of removers) remove();
      section.remove();
    },
  };
}
