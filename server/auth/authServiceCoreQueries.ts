export interface SessionRow {
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
  device_id_hash: string | null;
}

export const USER_SELECT = `
  SELECT users.id, users.username, COALESCE(users.role_override, users.role) AS role, users.password_salt,
         users.password_hash, users.is_test, users.candidate_id,
         users.email, users.display_name, users.headline, users.location,
         users.work_mode, users.timezone, users.blocked_at, users.profile_updated_at,
         users.created_at AS user_created_at,
         candidates.data_class, candidates.locale,
         candidates.created_at AS candidate_created_at
  FROM users
  LEFT JOIN candidates ON candidates.id = users.candidate_id
`;

/**
 * Collapse legacy sessions without device ids into one visible session while
 * preserving the current session when possible.
 */
export function collapseLegacySessions(
  sessions: readonly SessionRow[],
  currentTokenHash: string,
): SessionRow[] {
  const known = sessions.filter((session) => session.device_id_hash);
  const legacy = sessions.filter((session) => !session.device_id_hash);
  if (legacy.length <= 1) return [...sessions];
  const kept = legacy.find((session) => session.token_hash === currentTokenHash) ?? legacy[0]!;
  return [...known, kept].sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1));
}
