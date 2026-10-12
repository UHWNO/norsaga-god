import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readAuthConfig } from '../server/auth/config.js';
import { OWNER_PASSKEY_TRIGGER } from '../server/auth/passkey-policy.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = readAuthConfig();
if (
  process.argv[2] !== '--reset-owner-passkeys' ||
  process.argv[3] !== config.adminEmail
) {
  throw new Error(
    'Server-only recovery: node scripts/auth-recover.mjs --reset-owner-passkeys <AUTH_ADMIN_EMAIL>. This removes owner passkeys and sessions.',
  );
}
if (!existsSync(config.databasePath))
  throw new Error('Authentication database not found');
const db = new DatabaseSync(config.databasePath);
const user = db
  .prepare("SELECT * FROM user WHERE email = ? AND role = 'admin'")
  .get(config.adminEmail);
if (!user)
  throw new Error(
    'Configured owner not found. Do not create a second admin during recovery.',
  );
db.exec('BEGIN IMMEDIATE');
try {
  // Other writers never observe the trigger disabled outside this transaction.
  db.exec('DROP TRIGGER IF EXISTS protect_owner_last_passkey');
  if (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_access'",
      )
      .get()
  ) {
    db.prepare(
      "UPDATE user_access SET endedAt = ?, endReason = 'revoked' WHERE userId = ? AND endedAt IS NULL",
    ).run(Date.now(), user.id);
  }
  db.prepare('DELETE FROM session WHERE userId = ?').run(user.id);
  db.prepare('DELETE FROM passkey WHERE userId = ?').run(user.id);
  db.exec('DELETE FROM verification');
  db.exec(OWNER_PASSKEY_TRIGGER);
  db.prepare('INSERT INTO access_audit VALUES (?,?,?,?,?)').run(
    randomUUID(),
    Date.now(),
    'owner_recovery',
    'server_operator',
    user.email,
  );
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.close();
console.log(
  'Owner sessions and passkeys revoked. Request a new email login, enroll a passkey, then authenticate with it.',
);
