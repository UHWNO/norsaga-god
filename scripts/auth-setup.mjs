import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, chmodSync } from 'node:fs';

const filename = '.env';
const existing = existsSync(filename) ? readFileSync(filename, 'utf8') : '';
if (!/^AUTH_SECRET=.+/m.test(existing)) {
  appendFileSync(
    filename,
    `\n# Persistent authentication signing secret; never commit this file.\nAUTH_SECRET=${randomBytes(48).toString('base64url')}\n`,
    { mode: 0o600 },
  );
  chmodSync(filename, 0o600);
  console.log(
    'Persistent AUTH_SECRET generated in .env (value not displayed).',
  );
} else console.log('Existing AUTH_SECRET preserved.');
console.log(
  'Configure AUTH_BASE_URL, AUTH_DB_PATH, AUTH_ADMIN_EMAIL, AUTH_MAIL_FROM and Mailjet credentials before starting. See docs/AUTHENTICATION.md.',
);
