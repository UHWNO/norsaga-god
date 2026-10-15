import { readResponseJsonCapped } from '../../sources/httpBody.js';

export function createOffshoreEnergySource({
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return {
    async getSnapshot(kind, { signal } = {}) {
      const response = await fetchImpl(
        `/api/offshore-energy?kind=${encodeURIComponent(kind)}`,
        { signal, credentials: 'same-origin', cache: 'no-store' },
      );
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Sign in again to load offshore energy.'
            : 'Offshore energy data is unavailable.',
        );
      const data = await readResponseJsonCapped(response, 24 * 1024 * 1024);
      if (
        data.schemaVersion !== 1 ||
        data.kind !== kind ||
        !Array.isArray(data.records) ||
        data.records.length > 20000 ||
        !Array.isArray(data.sources)
      )
        throw new Error('Invalid offshore energy response.');
      return data;
    },
  };
}
