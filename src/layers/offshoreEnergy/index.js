import * as Cesium from 'cesium';

export const ENERGY_LAYER_IDS = ['offshore-oil-gas', 'offshore-wind'];
export const ENERGY_STATUSES = ['operational', 'planned', 'retired', 'all'];
export function matchesEnergy(record, params, query = '') {
  return (
    (params.status === 'all' || record.status === params.status) &&
    (params.subsea || !record.subsea) &&
    `${record.name} ${record.country} ${record.operator || ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );
}

/** Static assets share the normal layer lifecycle; no animation or polling loop. */
export function createOffshoreEnergyLayer({
  kind,
  feed,
  picking,
  cesium: C = Cesium,
} = {}) {
  if (!['oil', 'wind'].includes(kind) || !feed?.getSnapshot)
    throw new TypeError('Offshore energy requires a kind and source');
  const id = kind === 'oil' ? ENERGY_LAYER_IDS[0] : ENERGY_LAYER_IDS[1];
  const prefix = `${id}/`;
  let viewer,
    dataSource,
    handler,
    request,
    snapshot,
    error = null,
    selected = null;
  let enabled = false,
    destroyed = false,
    loading = false,
    count = 0,
    rowListener;
  let params = { status: 'operational', subsea: false };
  const listeners = new Set(),
    entityRecords = new Map();
  const notify = () => {
    rowListener?.();
    for (const fn of listeners) fn();
  };
  const render = () => viewer?.scene.requestRender?.();
  const visible = () =>
    (snapshot?.records || []).filter((r) => matchesEnergy(r, params));
  function rebuild() {
    dataSource?.entities.removeAll();
    entityRecords.clear();
    const records = enabled ? visible() : [];
    count = records.length;
    if (selected && !records.some((r) => r.id === selected.id)) selected = null;
    if (!dataSource) return;
    const color = C.Color.fromCssColorString(
      kind === 'oil' ? '#ffbf66' : '#61e4cf',
    );
    const add = (record, suffix, graphics) => {
      const entityId = `${prefix}${record.id}${suffix}`;
      dataSource.entities.add({ id: entityId, name: record.name, ...graphics });
      entityRecords.set(entityId, record.id);
    };
    dataSource.entities.suspendEvents();
    try {
      for (const record of records) {
        add(record, '', {
          position: C.Cartesian3.fromDegrees(record.lon, record.lat, 60),
          point: {
            pixelSize: selected?.id === record.id ? 13 : 7,
            color,
            outlineColor: C.Color.BLACK,
            outlineWidth: 1,
            disableDepthTestDistance: 3000000,
          },
        });
        if (kind === 'wind' && record.geometry.type !== 'Point') {
          const polygons =
            record.geometry.type === 'Polygon'
              ? [record.geometry.coordinates]
              : record.geometry.coordinates;
          for (let i = 0; i < polygons.length; i++) {
            const rings = polygons[i];
            if (!rings[0] || rings[0].length < 4) continue;
            const ring = (coords) =>
              C.Cartesian3.fromDegreesArray(
                coords.flatMap((p) => [p[0], p[1]]),
              );
            add(record, `::area:${i}`, {
              polygon: {
                hierarchy: new C.PolygonHierarchy(
                  ring(rings[0]),
                  rings.slice(1).map((h) => new C.PolygonHierarchy(ring(h))),
                ),
                height: 25,
                material: color.withAlpha(0.18),
                outline: false,
              },
            });
          }
        }
      }
    } finally {
      dataSource.entities.resumeEvents();
    }
    render();
  }
  const layer = {
    id,
    name: kind === 'oil' ? 'Oil & Gas Installations' : 'Offshore Wind Farms',
    icon: kind === 'oil' ? '◆' : '✣',
    source: kind === 'oil' ? 'SODIR · NSTA · EMODnet' : 'EMODnet · CETMAR',
    updateInterval: 6 * 3600_000,
    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new C.CustomDataSource(id);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
    },
    enable() {
      if (enabled || destroyed) return;
      enabled = true;
      dataSource.show = true;
      picking?.registerPickOwner(id, (value) => value.startsWith(prefix));
      handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event) => {
        const recordId = entityRecords.get(
          picking?.resolvePickId(viewer.scene.pick(event.position)),
        );
        if (recordId) layer.select(recordId, { fly: false });
      }, C.ScreenSpaceEventType.LEFT_CLICK);
      rebuild();
      notify();
    },
    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      handler?.destroy();
      handler = null;
      picking?.unregisterPickOwner(id);
      selected = null;
      snapshot = null;
      error = null;
      count = 0;
      if (dataSource) {
        dataSource.show = false;
        dataSource.entities.removeAll();
      }
      entityRecords.clear();
      render();
      notify();
    },
    async update(_viewer, { signal } = {}) {
      if (!enabled || destroyed) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      loading = true;
      notify();
      try {
        controller.signal.throwIfAborted();
        const next = await feed.getSnapshot(kind, {
          signal: controller.signal,
        });
        if (!enabled || controller.signal.aborted || request !== controller)
          return false;
        snapshot = next;
        error = next.unavailable
          ? 'All offshore sources are unavailable.'
          : null;
        // Replace a selected record after refresh, preserving no stale detail.
        selected = next.records.find((r) => r.id === selected?.id) || null;
        rebuild();
        return true;
      } catch (cause) {
        if (controller.signal.aborted || request !== controller) return false;
        snapshot = null;
        selected = null;
        error = cause.message || 'Offshore energy unavailable.';
        rebuild();
        return true;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (request === controller) {
          request = null;
          loading = false;
          notify();
        }
      }
    },
    getParams: () => ({ ...params }),
    setParams(next = {}) {
      if (ENERGY_STATUSES.includes(next.status)) params.status = next.status;
      if (typeof next.subsea === 'boolean') params.subsea = next.subsea;
      rebuild();
      notify();
    },
    search: (query) =>
      visible()
        .filter((r) => matchesEnergy(r, params, query))
        .slice(0, 30),
    select(recordId, { fly = true } = {}) {
      const record = visible().find((r) => r.id === recordId);
      if (!record || destroyed || !enabled) return false;
      selected = record;
      rebuild();
      notify();
      if (fly)
        viewer.camera.flyTo({
          destination: C.Cartesian3.fromDegrees(
            record.lon,
            record.lat,
            kind === 'wind' ? 100000 : 65000,
          ),
          duration: 1.2,
        });
      return true;
    },
    subscribeReadout(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getReadout() {
      return {
        enabled,
        loading,
        error,
        selected,
        count,
        sources: snapshot?.sources || [],
        fetchedAt: snapshot?.fetchedAt || null,
        partial: snapshot?.partial || false,
        stale: snapshot?.stale || false,
        params: { ...params },
      };
    },
    getStats() {
      return {
        count,
        loading,
        error,
        lastUpdate: snapshot?.fetchedAt || null,
        unavailable: !!error,
        partial: snapshot?.partial,
        stale: snapshot?.stale,
        source: layer.source,
      };
    },
    getRowControls() {
      return {
        chips: [
          ...ENERGY_STATUSES.map((status) => ({
            id: `status-${status}`,
            label: {
              operational: 'Operating',
              planned: 'Planned / Building',
              retired: 'Retired',
              all: 'All Statuses',
            }[status],
            active: params.status === status,
            params: { status },
          })),
          ...(kind === 'oil'
            ? [
                {
                  id: 'subsea',
                  label: 'Include Subsea',
                  active: params.subsea,
                  params: { subsea: !params.subsea },
                },
              ]
            : []),
        ],
        info: `${count} visible · ${loading ? 'Loading registers…' : error || (snapshot?.partial ? 'Some sources unavailable' : snapshot?.stale ? 'Cached data · refresh failed' : 'Asset register, not live activity')}. Search and details: Maritime layers → Offshore energy.`,
      };
    },
    setRowControlsListener(fn) {
      rowListener = fn;
    },
    getDiagnostics() {
      return {
        ...layer.getReadout(),
        entities: dataSource?.entities.values.length || 0,
        handlerActive: !!handler,
        requestPending: !!request,
      };
    },
    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      if (dataSource) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
      rowListener = null;
      listeners.clear();
    },
  };
  return layer;
}
