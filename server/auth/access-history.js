import { IDLE_MS } from './config.js';

const RETENTION_MS = 90 * 86400_000;

/** One durable record per successful session; never store login tokens/cookies. */
export function createAccessHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_access (
    sessionId TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL,
    email TEXT NOT NULL, method TEXT NOT NULL, signedInAt INTEGER NOT NULL,
    lastSeenAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
    endedAt INTEGER, endReason TEXT
  ); CREATE INDEX IF NOT EXISTS user_access_time ON user_access(signedInAt);`);
  function prune() {
    db.prepare('DELETE FROM user_access WHERE signedInAt < ?').run(
      Date.now() - RETENTION_MS,
    );
  }
  function record(session, user) {
    db.prepare(
      `INSERT OR IGNORE INTO user_access
      (sessionId,userId,name,email,method,signedInAt,lastSeenAt,expiresAt)
      VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      session.id,
      user.id,
      user.name,
      user.email,
      session.passkeyVerified ? 'passkey' : 'email_link',
      new Date(session.createdAt).getTime(),
      session.lastActivity,
      new Date(session.expiresAt).getTime(),
    );
    prune();
  }
  function backfill() {
    // Existing live sessions have trustworthy creation/method metadata. Older
    // sessions that have already ended cannot be reconstructed.
    db.exec(`INSERT OR IGNORE INTO user_access
      (sessionId,userId,name,email,method,signedInAt,lastSeenAt,expiresAt)
      SELECT s.id,u.id,u.name,u.email,
        CASE WHEN s.passkeyVerified THEN 'passkey' ELSE 'email_link' END,
        s.createdAt,s.lastActivity,s.expiresAt FROM session s JOIN user u ON u.id=s.userId`);
    prune();
  }
  function activity(current) {
    const now = Date.now();
    db.prepare('UPDATE session SET lastActivity = ? WHERE id = ?').run(
      now,
      current.session.id,
    );
    db.prepare(
      'UPDATE user_access SET lastSeenAt = ? WHERE sessionId = ? AND endedAt IS NULL',
    ).run(now, current.session.id);
  }
  function end(sessionId, reason) {
    db.prepare(
      `UPDATE user_access SET endedAt = COALESCE(endedAt, ?), endReason = ?,
      lastSeenAt = MAX(lastSeenAt, COALESCE((SELECT lastActivity FROM session WHERE id = ?), lastSeenAt))
      WHERE sessionId = ? AND (endedAt IS NULL OR endReason = 'ended')`,
    ).run(Date.now(), reason, sessionId, sessionId);
  }
  function revoke(userId) {
    for (const session of db
      .prepare('SELECT id FROM session WHERE userId = ?')
      .all(userId))
      end(session.id, 'revoked');
  }
  function entries() {
    prune();
    const now = Date.now();
    return db
      .prepare(
        `SELECT a.name,a.email,a.method,a.signedInAt,a.lastSeenAt,a.endedAt,a.endReason,
      a.expiresAt,s.id AS liveSession,s.lastActivity,u.active
      FROM user_access a LEFT JOIN session s ON s.id=a.sessionId
      LEFT JOIN user u ON u.id=a.userId
      ORDER BY a.signedInAt DESC,a.rowid DESC LIMIT 100`,
      )
      .all()
      .map((row) => ({
        name: row.name,
        email: row.email,
        method: row.method,
        signedInAt: row.signedInAt,
        lastSeenAt: row.lastSeenAt,
        endedAt: row.endedAt,
        status:
          row.endReason ||
          (row.expiresAt <= now ||
          now - (row.lastActivity ?? row.lastSeenAt) >= IDLE_MS
            ? 'expired'
            : !row.active
              ? 'revoked'
              : !row.liveSession
                ? 'ended'
                : 'active'),
      }));
  }
  return { record, backfill, activity, end, revoke, entries };
}
