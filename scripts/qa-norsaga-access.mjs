/** QA uses a real pre-authenticated session; there is no password/backdoor. */
export async function unlockNorSaga(page) {
  if (!new URL(page.url()).pathname.endsWith('/login.html')) return;
  if (!process.env.QA_SESSION_COOKIE)
    throw new Error('Browser QA requires QA_SESSION_COOKIE from a real login');
  const origin = new URL(page.url()).origin;
  const [name, ...value] = process.env.QA_SESSION_COOKIE.split('=');
  await page.setCookie({
    name,
    value: value.join('='),
    url: origin,
    httpOnly: true,
    secure: origin.startsWith('https:'),
  });
  await page.goto(`${origin}/?welcome=0`, { waitUntil: 'domcontentloaded' });
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
