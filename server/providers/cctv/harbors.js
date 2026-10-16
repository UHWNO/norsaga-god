/** Operator-published harbor images and video. Riga and Hamburg checked 16 October 2026.
 * Site anchors are approximate; camera mounts and viewing directions are not surveyed.
 * Stale, unavailable, and player-only candidates are deliberately excluded.
 */
import { fallbackHeadingFromId } from './normalize.js';

const make = (
  id,
  name,
  city,
  provider,
  point,
  url,
  sourcePageUrl,
  interval = 60_000,
) => ({
  id,
  name,
  city,
  provider,
  lat: point[0],
  lon: point[1],
  url,
  snapshotUrl: url,
  feedType: 'image',
  sourceKind: 'public-harbor',
  headingConfidence: 'low',
  headingDeg: fallbackHeadingFromId(id),
  mountHeightM: 20,
  pitchDeg: -17,
  fovDeg: 74,
  rangeM: 500,
  groundElevationM: 0,
  sourcePageUrl,
  refreshIntervalMs: interval,
  snapshotMaxAgeMs: 30 * 60_000,
  locationNote:
    'Approximate map location. Camera position and viewing direction are not calibrated.',
  credit: provider,
  license:
    'Public webcam published by the camera operator; ownership remains with the operator. No open reuse license verified.',
});
const trondheimPage = 'https://trondheimhavn.no/webkamera/';
const alesundPage = 'https://alesund.havn.no/skipstrafikk/webkamera/';
const hortenPage = 'https://www.hortenhavn.no/vaer-og-vind-webkamera/';
// Gazetteer site anchors from Kartverket SSR, supplemented by approximate quay locations.
export const HARBOR_CAMERAS = Object.freeze(
  [
    make(
      'hamburg-port-teufelsbrueck',
      'Hamburg Harbor – Teufelsbrueck / Container Terminals',
      'Hamburg',
      'Port of Hamburg Marketing',
      [53.548, 9.862],
      'https://cdn.blkknt.net/blankenese.jpg',
      'https://www.hafen-hamburg.de/en/experience/webcam-teufelsbrueck/',
      15_000,
    ),
    // Approximate named harbor-area anchors, not surveyed camera mounts.
    // Only the fixed operator-published manifests are registered. The existing
    // demand-owned HLS relay retains its origin, byte and concurrent-session limits.
    ...[
      ['panorama', 'Port Panorama', 1, [57.054, 24.078]],
      ['krievu-island', 'Krievu Island', 2, [57.016, 24.071]],
      ['sea-gate', 'Sea Gate', 3, [57.065, 24.031]],
      ['vts-center', 'Vessel Traffic Service Center', 4, [57.054, 24.078]],
      ['daugavgriva-lighthouse', 'Daugavgriva Lighthouse', 5, [57.066, 24.025]],
      [
        'krievu-fishing-port',
        'Krievu Island / Fishing Port',
        6,
        [57.016, 24.071],
      ],
      ['kundzinsala-bay', 'Kundzinsala / Bay View', 7, [57.007, 24.11]],
      [
        'kundzinsala-downtown',
        'Kundzinsala / Downtown View',
        8,
        [57.007, 24.11],
      ],
    ].map(([id, name, number, point]) => ({
      ...make(
        `riga-port-${id}`,
        `Riga Harbor – ${name}`,
        'Riga',
        'Freeport of Riga Authority',
        point,
        `https://rop.lv/hls/cam${number}.m3u8`,
        'https://rop.lv/en/port-webcams',
      ),
      feedType: 'hls',
      snapshotUrl: '',
    })),
    ...[
      ['cruise-quay', 'Cruise Quay', [63.44297, 10.40498], 'cam157_9_1.jpg'],
      [
        'pir-ii-south',
        'Pir II South',
        [63.44055, 10.41015],
        'cam145_3_image.jpg',
      ],
      [
        'ladehammer-quay',
        'Ladehammer Quay',
        [63.44381, 10.42216],
        'cam54_1.jpg',
      ],
      ['ila', 'Ila Quay', [63.4315, 10.3687], 'cam58_ila.jpg'],
      ['skansen', 'Skansen / Ila', [63.43154, 10.37746], 'cam63_1.jpg'],
      [
        'trolla-hovringen',
        'Trolla / Høvringen',
        [63.44628, 10.33816],
        'cam145_6_image.jpg',
      ],
      [
        'munkholmen-boat',
        'Munkholmen Boat Quay',
        [63.437, 10.395],
        'cam145_12_image.jpg',
      ],
    ].map(([id, name, point, file]) =>
      make(
        `trondheim-port-${id}`,
        `Trondheim Harbor – ${name}`,
        'Trondheim',
        'Trondheim Havn',
        point,
        `https://tsftp.no/Trondheim/${file}`,
        trondheimPage,
      ),
    ),
    make(
      'verdal-port-industrial-quay',
      'Verdal Harbor – Industrial Quay',
      'Verdal',
      'Trondheim Havn',
      [63.79406, 11.4486],
      'https://tsftp.no/Trondheim/verdal225.jpg',
      `${trondheimPage}?h=verdal`,
    ),
    ...[
      ['cargo-quay', 'Cargo Quay', 30],
      ['waterfront', 'Town Waterfront', 31],
    ].map(([id, name, number]) =>
      make(
        `namsos-port-${id}`,
        `Namsos Harbor – ${name}`,
        'Namsos',
        'Trondheim Havn',
        [64.46558, 11.49784],
        `https://tsftp.no/Trondheim/k13_${number}.jpg`,
        `${trondheimPage}?h=namsos`,
      ),
    ),
    ...[
      ['north', 'North Harbor', [62.47541, 6.15476], 'K12_1.jpg'],
      ['south', 'South Harbor', [62.4699, 6.15], 'K4_5.jpg'],
      [
        'brosundet',
        'Brosundet Lift Bridge',
        [62.4709, 6.1501],
        'K17_42_Crop.jpg',
      ],
      ['southern-quays', 'Southern Quays', [62.4689, 6.157], 'K27.jpg'],
    ].map(([id, name, point, file]) =>
      make(
        `alesund-port-${id}`,
        `Ålesund Harbor – ${name}`,
        'Ålesund',
        'Port of Ålesund',
        point,
        `https://tsftp.no/alesund/${file}`,
        alesundPage,
        300_000,
      ),
    ),
    ...[
      ['south', 'South View', 'farleds'],
      ['north', 'North View', 'farledn'],
    ].map(([id, name, file]) =>
      make(
        `stavanger-port-tjuvholmen-${id}`,
        `Stavanger Harbor – Tjuvholmen ${name}`,
        'Stavanger',
        'Port of Stavanger',
        [58.98199, 5.72148],
        `https://tsftp.no/stavangerhavn/${file}.jpg`,
        'https://www.stavangerhavn.no/om/webkamera/',
        300_000,
      ),
    ),
    make(
      'kristiansand-guest-harbor',
      'Kristiansand Guest Harbor – Inner Harbor',
      'Kristiansand',
      'Kristiansand Guest Harbor',
      [58.1408, 8.0037],
      'https://bilder.krsgjestehavn.no/oversikt.jpg',
      'https://www.krsgjestehavn.no/webkamera',
    ),
    ...[
      ['harbor', 'Harbor', 'hortenHavn', [59.41721, 10.48344]],
      ['inner-harbor', 'Inner Harbor', 'hortenIndreHavn', [59.427, 10.481]],
    ].map(([id, name, key, point]) =>
      make(
        `horten-port-${id}`,
        `Horten – ${name}`,
        'Horten',
        'Horten Havn / CID',
        point,
        `https://nettkamera.cid.no/${key}/max.jpg`,
        hortenPage,
      ),
    ),
    ...[
      ['east', 'East View', 'asgardHavnOst'],
      ['west', 'West View', 'asgardHavnVest'],
    ].map(([id, name, key]) =>
      make(
        `asgardstrand-port-${id}`,
        `Åsgårdstrand Harbor – ${name}`,
        'Åsgårdstrand',
        'Horten Havn / CID',
        [59.34938, 10.46948],
        `https://nettkamera.cid.no/${key}/max.jpg`,
        hortenPage,
      ),
    ),
    // The operator's timestamp is burned into this image; no HTTP capture timestamp is supplied.
    make(
      'stockholm-harbor-slussen',
      'Stockholm Harbor – Slussen / Stadsgården',
      'Stockholm',
      'WebcamCollections / Webbkameror.se',
      [59.319972, 18.073218],
      'https://proxy-3.webbkameror.se/current/kcTVa7ImVvg/1696780027483.jpg',
      'https://webcamcollections.com/countries/sweden/stockholm/slussen/stockholm-slussen-stadsgarden-stockholms-inlopp',
    ),
  ].map((camera) => Object.freeze(camera)),
);

export function loadHarborSources() {
  return HARBOR_CAMERAS.map((camera) => ({ ...camera }));
}
