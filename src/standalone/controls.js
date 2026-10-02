import { createApplicationControls } from '../app/controls.js';
import { getStandaloneCatalog } from './catalog.js';
import { startMaritimeCamera } from '../norsaga/camera.js';

export function createStandaloneControls(options) {
  return createApplicationControls({
    catalog: options?.catalog ?? getStandaloneCatalog(),
    startCamera: startMaritimeCamera,
    initialCameraLabel: 'Opening the NorSaga maritime overview...',
    ...options,
  });
}
