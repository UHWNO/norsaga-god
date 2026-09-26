// This is an intentionally lightweight client-side gate, not authentication.
// Anyone with access to the built JavaScript can discover this value.
export const NORSAGA_ACCESS_PASSWORD = '2026Oslo*';

export function isPasswordAccepted(candidate) {
  return candidate === NORSAGA_ACCESS_PASSWORD;
}
