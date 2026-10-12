/** Share paced harbor snapshots between users and concurrent panel/map requests. */
export function createSnapshotCache(fetchImage, { now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  const MAX_BYTES = 16 * 1024 * 1024;
  function retain(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    let bytes = [...cache.values()].reduce(
      (sum, value) => sum + (value.image?.body?.length || 0),
      0,
    );
    while (cache.size > 32 || bytes > MAX_BYTES) {
      const oldest = cache.keys().next().value;
      bytes -= cache.get(oldest).image?.body?.length || 0;
      cache.delete(oldest);
    }
  }
  async function get(source, url) {
    if (source?.sourceKind !== 'public-harbor') return fetchImage(url);
    const key = `${source.id}:${url}`;
    const cached = cache.get(key);
    if (cached && now() < cached.nextFetchAt) return cached.image;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const image = await fetchImage(url);
      const interval = Math.max(
        60_000,
        Math.min(600_000, source.refreshIntervalMs || 60_000),
      );
      const value =
        image ||
        (cached?.image ? { ...cached.image, refreshFailed: true } : null);
      retain(key, {
        image: value,
        nextFetchAt: now() + (image ? interval : 30_000),
      });
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  return { get };
}
