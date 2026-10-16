/**
 * Curated overview destinations for frequently used maritime searches.
 * Exact aliases only: qualified addresses and similarly named businesses must
 * continue to the configured geocoders. Bounds are presentation extents, not
 * port limits or navigational charts. Sources are listed in DATA_SOURCES.md.
 */
const DESTINATIONS = [
  {
    name: 'Oslo',
    country: 'Norway',
    aliases: ['Oslo', 'Oslo Norway', 'Oslo Norge'],
    lat: 59.9133,
    lng: 10.739,
    type: 'locality',
    bounds: [59.84, 10.6, 59.99, 10.94],
  },
  {
    name: 'Copenhagen',
    country: 'Denmark',
    aliases: [
      'Copenhagen',
      'Copenhagen Denmark',
      'København',
      'København Danmark',
      'Kobenhavn',
      'Kobenhavn Denmark',
    ],
    lat: 55.6761,
    lng: 12.5683,
    type: 'locality',
    bounds: [55.61, 12.45, 55.75, 12.68],
  },
  {
    name: 'Port of Oslo',
    country: 'Norway',
    aliases: [
      'Port of Oslo',
      'Oslo Port',
      'Oslo Harbor',
      'Oslo Harbour',
      'Oslo Havn',
      'Oslo Havna',
      'Oslo Harbour Port',
    ],
    lat: 59.89,
    lng: 10.75,
    type: 'harbor',
    bounds: [59.865, 10.7, 59.925, 10.795],
  },
  {
    name: 'Port of Copenhagen',
    country: 'Denmark',
    aliases: [
      'Port of Copenhagen',
      'Copenhagen Port',
      'Copenhagen Harbor',
      'Copenhagen Harbour',
      'Københavns Havn',
      'Kobenhavns Havn',
      'København Havn',
      'Kobenhavn Havn',
      'Porto of Copenhagen',
    ],
    lat: 55.714056,
    lng: 12.598139,
    type: 'harbor',
    bounds: [55.645, 12.565, 55.74, 12.65],
  },
];

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
}

export function createMaritimeGeocoder() {
  const index = new Map();
  for (const destination of DESTINATIONS) {
    const [south, west, north, east] = destination.bounds;
    const place = {
      name: destination.name,
      label: `${destination.name}, ${destination.country}`,
      lat: destination.lat,
      lng: destination.lng,
      types: [destination.type],
      exact: true,
      viewport: {
        southwest: { lat: south, lng: west },
        northeast: { lat: north, lng: east },
      },
    };
    for (const alias of destination.aliases) {
      index.set(normalize(alias), place);
      index.set(normalize(`${alias} ${destination.country}`), place);
    }
  }
  return {
    async geocode(query, { signal } = {}) {
      signal?.throwIfAborted();
      const place = index.get(normalize(query));
      return { place: place ? structuredClone(place) : null, answered: true };
    },
  };
}
