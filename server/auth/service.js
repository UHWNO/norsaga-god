import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import {
  ADMIN_FRESH_MS,
  IDLE_MS,
  SESSION_SECONDS,
  normalizeEmail,
} from './config.js';
import { createMailjetSender } from './mailjet.js';
import { createAccessHistory } from './access-history.js';
import { OWNER_PASSKEY_TRIGGER } from './passkey-policy.js';

export async function createAccessService(config, { sendMail } = {}) {
  mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.databasePath);
  chmodSync(config.databasePath, 0o600);
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;',
  );
  db.exec(`CREATE TABLE IF NOT EXISTS access_audit (
    id TEXT PRIMARY KEY, time INTEGER NOT NULL, event TEXT NOT NULL, actor TEXT, target TEXT
  ); CREATE TABLE IF NOT EXISTS access_limit (
    key TEXT PRIMARY KEY, started INTEGER NOT NULL, count INTEGER NOT NULL
  );`);
  const accessHistory = createAccessHistory(db);
  const audit = (event, actor = null, target = null) => {
    db.prepare('INSERT INTO access_audit VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(),
      Date.now(),
      event,
      actor,
      target,
    );
    db.prepare('DELETE FROM access_audit WHERE time < ?').run(
      Date.now() - 90 * 86400_000,
    );
  };
  const userByEmail = (email) =>
    db.prepare('SELECT * FROM user WHERE email = ?').get(email);
  const userById = (id) =>
    db.prepare('SELECT * FROM user WHERE id = ?').get(id);
  const passkeyCount = (userId) =>
    db
      .prepare('SELECT COUNT(*) AS count FROM passkey WHERE userId = ?')
      .get(userId).count;
  const pendingMail = new Set();
  const deliver = sendMail || createMailjetSender(config);
  const queueMail = (message) => {
    // Keep response timing independent of whether the address is approved.
    // Tokens remain in memory only while delivering; failures require a new link.
    const task = Promise.resolve()
      .then(() => deliver(message))
      .then(
        () => audit('login_email_accepted', null, message.email),
        () => audit('login_email_failed', null, message.email),
      )
      .finally(() => pendingMail.delete(task));
    pendingMail.add(task);
  };
  const auth = betterAuth({
    appName: 'NorSaga God’s Eye',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    database: db,
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: false },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
      additionalFields: {
        role: { type: 'string', defaultValue: 'user', input: false },
        active: { type: 'boolean', defaultValue: false, input: false },
      },
    },
    session: {
      expiresIn: SESSION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      freshAge: 15 * 60,
      additionalFields: {
        passkeyVerified: { type: 'boolean', defaultValue: false, input: false },
        lastActivity: { type: 'number', input: false },
      },
    },
    account: { accountLinking: { enabled: false } },
    advanced: {
      cookiePrefix: 'norsaga',
      useSecureCookies: !config.local,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: !config.local,
        path: '/',
      },
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    logger: { disabled: true },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/magic-link': { window: 60, max: 5 },
        '/passkey/verify-authentication': { window: 60, max: 10 },
      },
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: 600,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, token }) => {
          const user = userByEmail(normalizeEmail(email));
          if (user?.active) queueMail({ email: user.email, token });
        },
      }),
      passkey({
        rpID: config.rpID,
        rpName: 'NorSaga God’s Eye',
        origin: config.origin,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        authentication: {
          // The library defaults to requireUserVerification:false. Enforce the
          // verified, signed authenticator result before it can create a session.
          afterVerification: async ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw new APIError('UNAUTHORIZED', {
                message: 'Biometric or PIN verification required',
              });
            }
          },
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          !ctx.path.startsWith('/passkey/') ||
          ctx.path.endsWith('/generate-authenticate-options') ||
          ctx.path.endsWith('/verify-authentication')
        )
          return;
        const session = await getSession(ctx.headers);
        if (!session)
          throw new APIError('UNAUTHORIZED', { message: 'Login required' });
        const count = passkeyCount(session.user.id);
        const isAdmin = session.user.role === 'admin';
        if (isAdmin && count > 0 && !isFreshAdmin(session)) {
          throw new APIError('FORBIDDEN', {
            message: 'Log in with your existing passkey first',
          });
        }
        if (
          isAdmin &&
          count === 0 &&
          Date.now() - new Date(session.session.createdAt).getTime() > 600_000
        ) {
          throw new APIError('FORBIDDEN', {
            message: 'Request a new email link to set up your first passkey',
          });
        }
        if (isAdmin && ctx.path === '/passkey/delete-passkey' && count <= 1) {
          throw new APIError('FORBIDDEN', {
            message: 'Keep at least one administrator passkey',
          });
        }
      }),
    },
    databaseHooks: {
      user: { create: { before: async () => false } },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = userById(session.userId);
            if (!user?.active)
              throw new APIError('UNAUTHORIZED', {
                message: 'Access unavailable',
              });
            return {
              data: {
                ...session,
                lastActivity: Date.now(),
                passkeyVerified: ctx?.path === '/passkey/verify-authentication',
              },
            };
          },
          after: async (session) => {
            audit('login', session.userId);
            accessHistory.record(session, userById(session.userId));
          },
        },
        delete: {
          after: async (session) =>
            accessHistory.end(
              session.id,
              new Date(session.expiresAt).getTime() <= Date.now() ||
                Date.now() - session.lastActivity >= IDLE_MS
                ? 'expired'
                : 'ended',
            ),
        },
      },
    },
  });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  accessHistory.backfill();
  db.exec(OWNER_PASSKEY_TRIGGER);
  // Only the configured owner is bootstrapped. Contacts and previous email
  // recipients do not acquire application access automatically.
  const owner = db
    .prepare("SELECT email FROM user WHERE role = 'admin' LIMIT 1")
    .get();
  if (owner && owner.email !== config.adminEmail) {
    db.close();
    throw new Error(
      'AUTH_ADMIN_EMAIL does not match the existing owner; explicit server migration required',
    );
  }
  if (!owner) {
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role, active)
      VALUES (?, ?, ?, 0, ?, ?, 'admin', 1)`,
    ).run(randomUUID(), 'Ulf', config.adminEmail, Date.now(), Date.now());
    audit('admin_bootstrapped', null, config.adminEmail);
  }
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(config.databasePath + suffix))
      chmodSync(config.databasePath + suffix, 0o600);
  }

  async function getSession(headers) {
    const current = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    if (!current) return null;
    const user = userById(current.user.id);
    const record = db
      .prepare('SELECT * FROM session WHERE id = ?')
      .get(current.session.id);
    if (
      !user?.active ||
      !user.emailVerified ||
      !record ||
      Date.now() - record.lastActivity >= IDLE_MS ||
      record.expiresAt <= Date.now()
    ) {
      if (record) {
        accessHistory.end(record.id, !user?.active ? 'revoked' : 'expired');
        db.prepare('DELETE FROM session WHERE id = ?').run(record.id);
      }
      return null;
    }
    return {
      ...current,
      user: { ...current.user, active: !!user.active, role: user.role },
      session: {
        ...current.session,
        passkeyVerified: !!record.passkeyVerified,
        lastActivity: record.lastActivity,
      },
    };
  }
  function isFreshAdmin(current) {
    return (
      current?.user.role === 'admin' &&
      current.session.passkeyVerified &&
      Date.now() - new Date(current.session.createdAt).getTime() <
        ADMIN_FRESH_MS
    );
  }
  function consumeLimit(key, max, windowMs) {
    const hashedKey = createHash('sha256').update(key).digest('hex');
    const now = Date.now();
    db.prepare('DELETE FROM access_limit WHERE started < ?').run(
      now - 86400_000,
    );
    db.prepare(
      `INSERT INTO access_limit VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN started <= ? THEN 1 ELSE count + 1 END,
      started = CASE WHEN started <= ? THEN excluded.started ELSE started END`,
    ).run(hashedKey, now, now - windowMs, now - windowMs);
    return (
      db.prepare('SELECT count FROM access_limit WHERE key = ?').get(hashedKey)
        .count <= max
    );
  }
  function setUser(actor, body) {
    if (body.active !== undefined && typeof body.active !== 'boolean')
      throw new Error('Status must be a boolean');
    const email = normalizeEmail(body.email);
    const name = String(body.name || email)
      .trim()
      .slice(0, 100);
    const active = body.active !== false;
    const existing = userByEmail(email);
    if (existing?.role === 'admin')
      throw new Error('Administrator is managed through server configuration');
    if (existing) {
      db.prepare(
        'UPDATE user SET name = ?, active = ?, updatedAt = ? WHERE id = ?',
      ).run(name, Number(active), Date.now(), existing.id);
      // Revoke on every membership change, including deactivate/reactivate.
      accessHistory.revoke(existing.id);
      db.prepare('DELETE FROM session WHERE userId = ?').run(existing.id);
      db.prepare(
        "DELETE FROM verification WHERE CASE WHEN json_valid(value) THEN json_extract(value, '$.email') END = ?",
      ).run(email);
    } else {
      db.prepare(
        `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,role,active)
        VALUES (?,?,?,0,?,?,'user',?)`,
      ).run(randomUUID(), name, email, Date.now(), Date.now(), Number(active));
    }
    audit(active ? 'user_approved' : 'user_disabled', actor, email);
  }
  return {
    config,
    auth,
    db,
    audit,
    accessHistory,
    getSession,
    isFreshAdmin,
    passkeyCount,
    consumeLimit,
    setUser,
    users: () =>
      db
        .prepare(
          'SELECT id,name,email,role,active FROM user ORDER BY role,email',
        )
        .all(),
    events: () =>
      db
        .prepare(
          'SELECT time,event,actor,target FROM access_audit ORDER BY time DESC LIMIT 100',
        )
        .all(),
    waitForMail: () => Promise.all([...pendingMail]),
    close: async () => {
      await Promise.all([...pendingMail]);
      db.close();
    },
  };
}
