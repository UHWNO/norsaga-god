// A database guard prevents simultaneous requests deleting the final owner key.
export const OWNER_PASSKEY_TRIGGER = `
CREATE TRIGGER IF NOT EXISTS protect_owner_last_passkey
BEFORE DELETE ON passkey
WHEN EXISTS (SELECT 1 FROM user WHERE id = OLD.userId AND role = 'admin')
  AND (SELECT COUNT(*) FROM passkey WHERE userId = OLD.userId) <= 1
BEGIN SELECT RAISE(ABORT, 'Keep at least one administrator passkey'); END;
`;
