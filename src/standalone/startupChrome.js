import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { initNorSagaExperience } from '../norsaga/experience.js';

export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings: initKeySetup,
    initializeWelcome: (context) =>
      initNorSagaExperience({
        ...context,
        viewer: options.viewer,
        signal: options.signal,
      }),
    ...options,
  });
}
