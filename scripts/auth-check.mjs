// Read-only operator checks. Never print credentials, tokens or provider bodies.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

if (existsSync('.env')) process.loadEnvFile('.env');
const owner = process.env.AUTH_ADMIN_EMAIL || 'ulfhwy@gmail.com';
// Plesk's npm runner can have a different environment from Passenger. Inspect
// the configured persistent location too, without changing or creating files.
const paths = [
  process.env.AUTH_DB_PATH,
  '../auth-data/auth.sqlite',
  '.norsaga-auth/auth.sqlite',
]
  .filter(Boolean)
  .map((path) => resolve(path));
const databasePath = [...new Set(paths)].find((path) => existsSync(path));
console.log(
  JSON.stringify({
    authSecretInRunner: !!process.env.AUTH_SECRET,
    mailjetCredentialsInRunner:
      !!process.env.MAILJET_API_KEY && !!process.env.MAILJET_SECRET_KEY,
    databaseExists: !!databasePath,
    databasePath,
  }),
);
if (databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const user = db
      .prepare(
        "SELECT id,emailVerified,active FROM user WHERE email = ? AND role = 'admin'",
      )
      .get(owner);
    const passkeys = user
      ? db
          .prepare('SELECT COUNT(*) AS count FROM passkey WHERE userId = ?')
          .get(user.id).count
      : 0;
    const email = db
      .prepare(
        "SELECT event,time FROM access_audit WHERE target = ? AND event IN ('login_email_accepted','login_email_failed') ORDER BY time DESC LIMIT 1",
      )
      .get(owner);
    console.log(
      JSON.stringify({
        ownerExists: !!user,
        ownerActive: !!user?.active,
        ownerEmailVerified: !!user?.emailVerified,
        ownerPasskeys: passkeys,
        lastOwnerEmail: email || null,
      }),
    );
  } finally {
    db.close();
  }
}
if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
  try {
    const response = await fetch(
      'https://api.mailjet.com/v3/REST/sender?Limit=100',
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = await response.json().catch(() => null);
    const sender = data?.Data?.find(
      (item) => item.Email?.toLowerCase() === 'no-reply@norsaga.com',
    );
    console.log(
      JSON.stringify({
        mailjetHttp: response.status,
        requestedSenderPresent: !!sender,
        senderStatus: sender?.Status,
      }),
    );
  } catch {
    console.log(JSON.stringify({ mailjetCheck: 'unavailable' }));
  }
}
