import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type { CandidateStore } from '../data/candidateStore';
import type {
  AdminAuditPage,
  AdminUserPage,
  AdminUserQuery,
  AdminUserRecord,
  AdminUserUpdateInput,
  AuthPrincipal,
  SubscriptionStatus,
  SubscriptionTier,
  UserRole,
} from './authTypes';

const scrypt = promisify(scryptCallback);

interface AdminUserRow {
  id: string;
  username: string;
  role: UserRole;
  is_test: number;
  candidate_id: string | null;
  email: string | null;
  display_name: string | null;
  headline: string | null;
  location: string | null;
  work_mode: string | null;
  blocked_at: string | null;
  subscription_tier: SubscriptionTier | null;
  subscription_status: SubscriptionStatus | null;
  subscription_expires_at: string | null;
  subscription_notes: string | null;
  created_at: string;
  active_sessions: number;
  last_seen_at: string | null;
}

interface AuditRow {
  id: string;
  actor_user_id: string;
  actor_username: string;
  action: string;
  subject_user_id: string | null;
  subject_username: string | null;
  detail: string | null;
  created_at: string;
}

const DIRECTORY_FILTER_COUNT = `WHERE users.username LIKE ?1 ESCAPE '\\'
     OR IFNULL(users.email, '') LIKE ?1 ESCAPE '\\'
     OR IFNULL(users.display_name, '') LIKE ?1 ESCAPE '\\'`;

const DIRECTORY_FILTER_SELECT = `WHERE users.username LIKE ?4 ESCAPE '\\'
     OR IFNULL(users.email, '') LIKE ?4 ESCAPE '\\'
     OR IFNULL(users.display_name, '') LIKE ?4 ESCAPE '\\'`;

function likePattern(needle: string): string {
  return `%${needle.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

function toAdminUserRecord(row: AdminUserRow): AdminUserRecord {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isTest: row.is_test === 1,
    email: row.email,
    displayName: row.display_name,
    headline: row.headline,
    location: row.location,
    workMode: row.work_mode,
    candidateId: row.candidate_id,
    blockedAt: row.blocked_at,
    subscriptionTier: row.subscription_tier ?? 'free',
    subscriptionStatus: row.subscription_status ?? 'active',
    subscriptionExpiresAt: row.subscription_expires_at,
    subscriptionNotes: row.subscription_notes,
    createdAt: row.created_at,
    activeSessions: row.active_sessions,
    lastSeenAt: row.last_seen_at,
  };
}

export function recordAdminAudit(
  database: DatabaseSync,
  entry: {
    actorUserId: string;
    actorUsername: string;
    action: string;
    subjectUserId?: string | null;
    subjectUsername?: string | null;
    detail?: string | null;
  },
): void {
  database
    .prepare(
      `INSERT INTO admin_audit (id, actor_user_id, actor_username, action, subject_user_id, subject_username, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      entry.actorUserId,
      entry.actorUsername,
      entry.action,
      entry.subjectUserId ?? null,
      entry.subjectUsername ?? null,
      entry.detail ?? null,
      new Date().toISOString(),
    );
}

export function listUsers(database: DatabaseSync, input: AdminUserQuery): AdminUserPage {
  const needle = input.query?.trim();
  const filterCountClause = needle ? DIRECTORY_FILTER_COUNT : '';
  const filterSelectClause = needle ? DIRECTORY_FILTER_SELECT : '';
  const now = new Date().toISOString();

  const countSql = `SELECT COUNT(*) AS total FROM users ${filterCountClause};`;
  const countStmt = database.prepare(countSql);
  const countRow = (
    needle ? countStmt.get(likePattern(needle)) : countStmt.get()
  ) as { total: number };

  const selectSql = `
    SELECT
      users.id,
      users.username,
      users.role,
      users.is_test,
      users.candidate_id,
      users.email,
      users.display_name,
      users.headline,
      users.location,
      users.work_mode,
      users.blocked_at,
      users.subscription_tier,
      users.subscription_status,
      users.subscription_expires_at,
      users.subscription_notes,
      users.created_at,
      COUNT(sessions.token_hash) AS active_sessions,
      MAX(sessions.last_seen_at) AS last_seen_at
    FROM users
    LEFT JOIN sessions
      ON sessions.user_id = users.id
     AND sessions.expires_at > ?1
    ${filterSelectClause}
    GROUP BY users.id
    ORDER BY users.created_at DESC
    LIMIT ?2 OFFSET ?3;
  `;

  const rows = (
    needle
      ? database.prepare(selectSql).all(now, input.limit, input.offset, likePattern(needle))
      : database.prepare(selectSql).all(now, input.limit, input.offset)
  ) as unknown as AdminUserRow[];

  return {
    total: countRow.total,
    users: rows.map(toAdminUserRecord),
  };
}

export function getUser(database: DatabaseSync, userId: string): AdminUserRecord | null {
  const now = new Date().toISOString();
  const row = database
    .prepare(
      `SELECT
        users.id,
        users.username,
        users.role,
        users.is_test,
        users.candidate_id,
        users.email,
        users.display_name,
        users.headline,
        users.location,
        users.work_mode,
        users.blocked_at,
        users.subscription_tier,
        users.subscription_status,
        users.subscription_expires_at,
        users.subscription_notes,
        users.created_at,
        COUNT(sessions.token_hash) AS active_sessions,
        MAX(sessions.last_seen_at) AS last_seen_at
      FROM users
      LEFT JOIN sessions
        ON sessions.user_id = users.id
       AND sessions.expires_at > ?2
      WHERE users.id = ?1
      GROUP BY users.id`,
    )
    .get(userId, now) as unknown as AdminUserRow | undefined;

  return row ? toAdminUserRecord(row) : null;
}

export function setUserRole(
  database: DatabaseSync,
  candidateStore: CandidateStore,
  targetUserId: string,
  newRole: UserRole,
  actorPrincipal?: AuthPrincipal,
): AdminUserRecord {
  const user = getUser(database, targetUserId);
  if (!user) throw new Error('Пользователь не найден.');
  if (user.role === newRole) return user;

  if (newRole === 'admin') {
    database
      .prepare(`UPDATE users SET role = 'admin', candidate_id = NULL, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), targetUserId);
  } else {
    const candidate = candidateStore.createCandidate({
      dataClass: 'personal',
      locale: 'ru-RU',
    });
    database
      .prepare(`UPDATE users SET role = 'candidate', candidate_id = ?, updated_at = ? WHERE id = ?`)
      .run(candidate.id, new Date().toISOString(), targetUserId);
  }

  if (actorPrincipal) {
    recordAdminAudit(database, {
      actorUserId: actorPrincipal.userId,
      actorUsername: actorPrincipal.username,
      action: 'change_user_role',
      subjectUserId: user.id,
      subjectUsername: user.username,
      detail: `Role changed from ${user.role} to ${newRole}`,
    });
  }

  return getUser(database, targetUserId)!;
}

export function setUserBlocked(
  database: DatabaseSync,
  targetUserId: string,
  blocked: boolean,
  actorPrincipal?: AuthPrincipal,
): AdminUserRecord {
  const user = getUser(database, targetUserId);
  if (!user) throw new Error('Пользователь не найден.');
  if (actorPrincipal && actorPrincipal.userId === targetUserId && blocked) {
    throw new Error('Администратор не может заблокировать сам себя.');
  }

  const blockedAt = blocked ? new Date().toISOString() : null;
  database
    .prepare(`UPDATE users SET blocked_at = ?, updated_at = ? WHERE id = ?`)
    .run(blockedAt, new Date().toISOString(), targetUserId);

  if (blocked) {
    database.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetUserId);
  }

  if (actorPrincipal) {
    recordAdminAudit(database, {
      actorUserId: actorPrincipal.userId,
      actorUsername: actorPrincipal.username,
      action: blocked ? 'block_user' : 'unblock_user',
      subjectUserId: user.id,
      subjectUsername: user.username,
      detail: blocked ? 'Account blocked and sessions revoked' : 'Account unblocked',
    });
  }

  return getUser(database, targetUserId)!;
}

export function updateUserByAdmin(
  database: DatabaseSync,
  targetUserId: string,
  input: AdminUserUpdateInput,
  actorPrincipal?: AuthPrincipal,
): AdminUserRecord {
  const user = getUser(database, targetUserId);
  if (!user) throw new Error('Пользователь не найден.');

  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE users
       SET email = COALESCE(?, email),
           display_name = COALESCE(?, display_name),
           headline = COALESCE(?, headline),
           location = COALESCE(?, location),
           work_mode = COALESCE(?, work_mode),
           subscription_tier = COALESCE(?, subscription_tier),
           subscription_status = COALESCE(?, subscription_status),
           subscription_expires_at = ?,
           subscription_notes = COALESCE(?, subscription_notes),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.email !== undefined ? input.email : null,
      input.displayName !== undefined ? input.displayName : null,
      input.headline !== undefined ? input.headline : null,
      input.location !== undefined ? input.location : null,
      input.workMode !== undefined ? input.workMode : null,
      input.subscriptionTier !== undefined ? input.subscriptionTier : null,
      input.subscriptionStatus !== undefined ? input.subscriptionStatus : null,
      input.subscriptionExpiresAt !== undefined ? input.subscriptionExpiresAt : user.subscriptionExpiresAt,
      input.subscriptionNotes !== undefined ? input.subscriptionNotes : null,
      now,
      targetUserId,
    );

  if (actorPrincipal) {
    recordAdminAudit(database, {
      actorUserId: actorPrincipal.userId,
      actorUsername: actorPrincipal.username,
      action: 'update_user_profile',
      subjectUserId: user.id,
      subjectUsername: user.username,
      detail: JSON.stringify(input),
    });
  }

  return getUser(database, targetUserId)!;
}

export async function adminSetUserPassword(
  database: DatabaseSync,
  targetUserId: string,
  newPassword: string,
  actorPrincipal?: AuthPrincipal,
): Promise<void> {
  const user = getUser(database, targetUserId);
  if (!user) throw new Error('Пользователь не найден.');
  if (newPassword.length < 8) throw new Error('Пароль должен быть не менее 8 символов.');

  const salt = randomBytes(16);
  const derived = (await scrypt(newPassword, salt, 64)) as Buffer;
  const passwordHash = derived.toString('hex');
  const passwordSalt = salt.toString('hex');

  database
    .prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`)
    .run(passwordHash, passwordSalt, new Date().toISOString(), targetUserId);

  database.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetUserId);

  if (actorPrincipal) {
    recordAdminAudit(database, {
      actorUserId: actorPrincipal.userId,
      actorUsername: actorPrincipal.username,
      action: 'reset_user_password',
      subjectUserId: user.id,
      subjectUsername: user.username,
      detail: 'Password reset by admin; active sessions revoked',
    });
  }
}

export function deleteUserByAdmin(
  database: DatabaseSync,
  candidateStore: CandidateStore,
  targetUserId: string,
  actorPrincipal?: AuthPrincipal,
): void {
  const user = getUser(database, targetUserId);
  if (!user) throw new Error('Пользователь не найден.');
  if (actorPrincipal && actorPrincipal.userId === targetUserId) {
    throw new Error('Администратор не может удалить собственный аккаунт.');
  }

  if (user.candidateId) {
    candidateStore.deleteCandidate(user.candidateId);
  }

  database.prepare(`DELETE FROM users WHERE id = ?`).run(targetUserId);

  if (actorPrincipal) {
    recordAdminAudit(database, {
      actorUserId: actorPrincipal.userId,
      actorUsername: actorPrincipal.username,
      action: 'delete_user',
      subjectUserId: user.id,
      subjectUsername: user.username,
      detail: 'User account and candidate dossier deleted',
    });
  }
}

export function listAudit(database: DatabaseSync, query?: { limit: number; offset: number }): AdminAuditPage {
  const limit = Math.min(query?.limit ?? 50, 100);
  const offset = query?.offset ?? 0;

  const countRow = database
    .prepare('SELECT COUNT(*) AS total FROM admin_audit')
    .get() as { total: number };

  const rows = database
    .prepare('SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as unknown as AuditRow[];

  return {
    total: countRow.total,
    records: rows.map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id,
      actorUsername: r.actor_username,
      action: r.action,
      subjectUserId: r.subject_user_id,
      subjectUsername: r.subject_username,
      detail: r.detail,
      createdAt: r.created_at,
    })),
  };
}
