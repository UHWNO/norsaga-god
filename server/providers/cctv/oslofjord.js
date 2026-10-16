/** Public harbor views published by the three operators' webcam pages.
 * Map anchors are approximate site locations, not surveyed camera mounts.
 * No calibrated pose or open reuse license is asserted.
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
  refreshIntervalMs,
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
  refreshIntervalMs,
  snapshotMaxAgeMs: 30 * 60_000,
  locationNote:
    'Approximate map location. Camera position and viewing direction are not calibrated.',
  credit: provider,
  license:
    'Public webcam published by the camera operator; ownership remains with the operator. No open reuse license verified.',
});
const osloPage = 'https://www.oslohavn.no/no/meny/webkamera/';
const drammenPage = 'https://drammenhavn.no/en/web-camera/';
const oscarsborgPage = 'https://oscarsborggjestehavn.no/?page_id=12';
// Gazetteer site anchors: Kartverket SSR, queried 12 October 2026.
const holmen = [59.73617, 10.22798];
// Marina site location; individual mounts have not been surveyed.
const oscarsborg = [59.677667, 10.604167];
export const OSLOFJORD_CAMERAS = Object.freeze(
  [
    make(
      'oslo-port-city-hall',
      'Oslo Harbor – City Hall Quay',
      'Oslo',
      'Port of Oslo',
      [59.91199, 10.7336],
      'https://www.oslohavn.no/webcam/raadhusintranett.jpg',
      osloPage,
      60_000,
    ),
    make(
      'oslo-port-kavringen',
      'Oslo Harbor – Kavringen',
      'Oslo',
      'Port of Oslo',
      [59.89979, 10.72206],
      'https://www.oslohavn.no/webcam/kavringen.jpg',
      osloPage,
      60_000,
    ),
    make(
      'oslo-port-vippetangen',
      'Oslo Harbor – Vippetangen',
      'Oslo',
      'Port of Oslo',
      [59.9025, 10.74124],
      'https://www.oslohavn.no/webcam/vippetangen.jpg',
      osloPage,
      60_000,
    ),
    ...[
      ['stromso', 'Strømsø', 14],
      ['lierstranda', 'Lierstranda', 12],
      ['aass', 'Aass Brewery', 15],
      ['tangen', 'Tangen', 16],
      ['tollbukaia', 'Tollbukaia', 17],
      ['kattegat', 'Kattegat Quay', 20],
      ['risgarden', 'Risgarden Quay', 11],
      ['holmen-south', 'Holmen South Quay', 13],
    ].map(([id, name, position]) =>
      make(
        `drammen-port-${id}`,
        `Drammen Harbor – ${name}`,
        'Drammen',
        'Port of Drammen',
        holmen,
        `https://tsftp.no/drammen/k1/snapshot_Pos${position}.jpg`,
        drammenPage,
        60_000,
      ),
    ),
    ...[1, 2, 3].map((number) =>
      make(
        `oscarsborg-marina-${number}`,
        `Oscarsborg Marina – Camera ${number}`,
        'Drøbak',
        'Oscarsborg Guest Harbor',
        oscarsborg,
        `https://oscarsborggjestehavn.no/images/kamera${number}.jpg`,
        oscarsborgPage,
        600_000,
      ),
    ),
  ].map((camera) => Object.freeze(camera)),
);

export function loadOslofjordSources() {
  return OSLOFJORD_CAMERAS.map((camera) => ({ ...camera }));
}
