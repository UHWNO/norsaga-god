import * as Cesium from 'cesium';
import { getRegion } from './profile.js';

function cameraOptions(id) {
  const region = getRegion(id);
  return {
    destination: Cesium.Cartesian3.fromDegrees(
      region.longitude,
      region.latitude,
      region.height,
    ),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  };
}

/** No delayed flight: a returning shared view must never be overwritten later. */
export function startMaritimeCamera(viewer) {
  viewer.camera.setView(cameraOptions('global'));
  viewer.scene?.requestRender();
  return () => {};
}

/** Use the existing ownership handoff, rather than competing with tracking. */
export function navigateRegion(styleManager, viewer, id) {
  const options = cameraOptions(id);
  if (typeof styleManager._runExplicitNavigation !== 'function')
    throw new Error('The application navigation handoff is unavailable');
  return styleManager._runExplicitNavigation(
    'operating area',
    () => {
      viewer.camera.flyTo({
        ...options,
        duration: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
          .matches
          ? 0
          : 1.2,
        complete: () => viewer.scene.requestRender(),
      });
      return true;
    },
    { preserveVesselSelection: false },
  );
}
