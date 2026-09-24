import { createAssetDirectorySource } from '../director/packs/source.js';
import { createApplicationTools } from '../app/tools.js';
import { startStandaloneChrome } from './startupChrome.js';

export function createStandaloneTools(options) {
  return createApplicationTools({
    startChrome: (context) =>
      startStandaloneChrome({ ...context, viewer: options.scene.viewer }),
    sceneDataPacks: {
      sources: {
        assets: createAssetDirectorySource({
          baseUrl: new URL('/scene-assets/', window.location.href).href,
        }),
      },
    },
    ...options,
  });
}
