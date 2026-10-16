import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { initNorSagaExperience } from '../norsaga/experience.js';

/** Remove the development-only credential surface without making a request. */
export function removeLocalKeySetup({
  documentRef = globalThis.document,
} = {}) {
  documentRef?.getElementById?.('key-setup-chip')?.remove?.();
  documentRef?.getElementById?.('key-setup')?.remove?.();
  return null;
}

export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings:
      options.enableLocalKeySetup === false
        ? removeLocalKeySetup
        : initKeySetup,
    initializeWelcome: (context) =>
      initNorSagaExperience({
        ...context,
        viewer: options.viewer,
        signal: options.signal,
      }),
    ...options,
  });
}
