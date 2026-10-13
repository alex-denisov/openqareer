import type { DatabaseSync } from 'node:sqlite';

export function revokeAccountSessionForUser(
  database: DatabaseSync,
  userId: string,
  currentTokenHash: string,
  sessionId: string,
): 'revoked' | 'current' | 'not_found' {
  const match = database
    .prepare(
      `SELECT token_hash, device_id_hash
       FROM sessions
       WHERE user_id = ? AND expires_at > ? AND substr(token_hash, 1, 16) = ?`,
    )
    .all(userId, new Date().toISOString(), sessionId) as Array<{
    token_hash: string;
    device_id_hash: string | null;
  }>;
  if (match.length !== 1) return 'not_found';
  const target = match[0]!;
  if (target.token_hash === currentTokenHash) return 'current';
  if (target.device_id_hash) {
    database.prepare('DELETE FROM sessions WHERE user_id = ? AND device_id_hash = ?')
      .run(userId, target.device_id_hash);
  } else {
    database.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash = ?')
      .run(userId, target.token_hash);
  }
  return 'revoked';
}
