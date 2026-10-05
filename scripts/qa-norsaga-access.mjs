import { NORSAGA_ACCESS_PASSWORD } from '../src/passwordGateCore.js';

/** Enter the existing client access gate through its normal form, if present. */
export async function unlockNorSaga(page) {
  const gated = await page.evaluate(() => {
    const form = document.getElementById('access-gate-form');
    return !!form && !form.hidden;
  });
  if (!gated) return;
  await page.type('#access-gate-password', NORSAGA_ACCESS_PASSWORD);
  await page.click('#access-gate-form button[type="submit"]');
}

/** Keep provider query credentials out of browser QA diagnostics. */
export function redactQaUrl(text) {
  return String(text).replace(/https?:\/\/[^\s"'<>\]]+/g, (url) => {
    try {
      const value = new URL(url);
      return value.origin + value.pathname;
    } catch {
      return '[url]';
    }
  });
}
