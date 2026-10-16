import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaritimeGeocoder } from './maritimeGeocoder.js';
import { createDefaultPlaceSearch } from './defaults.js';
import { searchAndFlyTo, CANCELLED_SEARCH } from '../locations.js';
import * as Cesium from 'cesium';

const cases = [
  ['Oslo, Norway', 'Oslo, Norway', 'city-overview', 59.9133, 10.739],
  ['OSLO', 'Oslo, Norway', 'city-overview', 59.9133, 10.739],
  ['Oslo Norge', 'Oslo, Norway', 'city-overview', 59.9133, 10.739],
  [
    'Copenhagen, Denmark',
    'Copenhagen, Denmark',
    'city-overview',
    55.6761,
    12.5683,
  ],
  ['København', 'Copenhagen, Denmark', 'city-overview', 55.6761, 12.5683],
  ['Port of Oslo', 'Port of Oslo, Norway', 'area-overview', 59.89, 10.75],
  ['Oslo Havn', 'Port of Oslo, Norway', 'area-overview', 59.89, 10.75],
  [
    'the Oslo harbour, Norway',
    'Port of Oslo, Norway',
    'area-overview',
    59.89,
    10.75,
  ],
  [
    'Port of Copenhagen',
    'Port of Copenhagen, Denmark',
    'area-overview',
    55.714056,
    12.598139,
  ],
  [
    'Porto of Copenhagen',
    'Port of Copenhagen, Denmark',
    'area-overview',
    55.714056,
    12.598139,
  ],
  [
    'Københavns Havn',
    'Port of Copenhagen, Denmark',
    'area-overview',
    55.714056,
    12.598139,
  ],
];

for (const [query, label, mode, lat, lng] of cases) {
  test(`${query} navigates to a correctly framed overview with every network provider offline`, async () => {
    let requests = 0;
    const placeSearch = createDefaultPlaceSearch({
      resolveApiKey: () => 'unavailable-test-key',
      fetchImpl: async () => {
        requests++;
        throw new Error('Provider offline');
      },
    });
    const outcome = await placeSearch.geocode(query, {
      bias: '-45,-120|-40,-110',
    });
    assert.equal(outcome.place.label, label);
    assert.equal(outcome.place.lat, lat);
    assert.equal(outcome.place.lng, lng);
    assert.equal(outcome.place.exact, true);
    const flights = [];
    const viewer = {
      scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
      camera: { flyTo: (options) => flights.push(options) },
    };
    const result = await searchAndFlyTo(viewer, query, {
      placeSearch,
      recoverNearView: () =>
        assert.fail(
          'An exact destination must not be replaced by a nearby POI',
        ),
    });
    assert.equal(result.label, label);
    assert.equal(result.navigationMode, mode);
    assert.equal(flights.length, 1);
    assert.ok(flights[0].destination instanceof Cesium.Rectangle);
    const rectangle = flights[0].destination;
    assert.ok(
      Cesium.Rectangle.contains(
        rectangle,
        Cesium.Cartographic.fromDegrees(lng, lat),
      ),
    );
    assert.ok(
      Cesium.Math.toDegrees(rectangle.width) < 1,
      'Do not frame a country or the globe',
    );
    assert.equal(requests, 0);
  });
}

test('qualified, ambiguous and unknown names continue to the configured network provider', async () => {
  const queries = [
    'Oslo Airport',
    'Port of Oslo Hotel',
    'Oslo, Minnesota',
    'Copenhagen, New York',
    'Port of Copenhagen Sweden',
    'Bergen',
  ];
  const calls = [];
  const placeSearch = createDefaultPlaceSearch({
    resolveApiKey: () => 'test-key',
    fetchImpl: async (url) => {
      calls.push(new URL(url).searchParams.get('address'));
      return new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              formatted_address: 'Configured result',
              geometry: { location: { lat: 1, lng: 2 } },
            },
          ],
        }),
      );
    },
  });
  for (const query of queries)
    assert.equal(
      (await placeSearch.geocode(query)).place.label,
      'Configured result',
    );
  assert.deepEqual(calls, queries);
});

test('maritime lookups preserve cancellation and navigation authority', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createMaritimeGeocoder().geocode('Oslo', { signal: controller.signal }),
    { name: 'AbortError' },
  );
  const result = await searchAndFlyTo(
    { camera: { flyTo: () => assert.fail('Newer camera owner must win') } },
    'Oslo, Norway',
    {
      placeSearch: createDefaultPlaceSearch(),
      beforeFly: () => false,
    },
  );
  assert.equal(result, CANCELLED_SEARCH);
});
