import { resolve } from 'node:path';

export const IDLE_MS = 30 * 60 * 1000;
export const SESSION_SECONDS = 8 * 60 * 60;
export const ADMIN_FRESH_MS = 15 * 60 * 1000;

export function normalizeEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ugyldig e-postadresse');
  }
  return email;
}

export function readAuthConfig(env = process.env) {
  const url = new URL(env.AUTH_BASE_URL || 'https://godseye.norsaga.com');
  const local = env.AUTH_LOCAL_DEV === '1';
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('AUTH_BASE_URL must be an origin without a path');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.protocol !== 'https:' &&
    !(local && loopback && url.protocol === 'http:')
  ) {
    throw new Error(
      'Authentication requires HTTPS (loopback development is explicit)',
    );
  }
  if (local && !loopback)
    throw new Error('AUTH_LOCAL_DEV only permits a loopback origin');
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 43) {
    throw new Error(
      'Set a persistent random AUTH_SECRET using npm run auth:setup',
    );
  }
  if (!local && (!env.MAILJET_API_KEY || !env.MAILJET_SECRET_KEY)) {
    throw new Error(
      'Production login requires Mailjet credentials and a verified AUTH_MAIL_FROM',
    );
  }
  return {
    origin: url.origin,
    rpID: url.hostname,
    local,
    secret: env.AUTH_SECRET,
    adminEmail: normalizeEmail(env.AUTH_ADMIN_EMAIL || 'ulfhwy@gmail.com'),
    databasePath: resolve(env.AUTH_DB_PATH || '.norsaga-auth/auth.sqlite'),
    trustProxy: env.AUTH_TRUST_PROXY === '1',
    mailjetKey: env.MAILJET_API_KEY,
    mailjetSecret: env.MAILJET_SECRET_KEY,
    mailFrom: normalizeEmail(env.AUTH_MAIL_FROM || 'no-reply@norsaga.com'),
    mailFromName: env.AUTH_MAIL_FROM_NAME || 'NorSaga God´s Eye Access',
  };
}
