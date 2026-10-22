import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type { CandidateStore } from '../data/candidateStore';
import { deleteCapabilityConsentsForUser } from './capabilityConsentStore';

import type {
  AdminAuditPage,
  AdminUserPage,
  AdminUserQuery,
  AdminAuditQuery,
  AdminUserRecord,
  AdminUserUpdateInput,
  AuthPrincipal,
  SubscriptionStatus,
  SubscriptionTier,
  UserRole,
} from './authTypes';
import {
  ADMIN_PERMISSION_KEYS,
  DEFAULT_ADMIN_PERMISSIONS,
  resolveAdminPermissions,
  type AdminPermission,
  type AdminPermissionOverrides,
} from '../../shared/roleMatrix';

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
  timezone: string | null;
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
    timezone: row.timezone ?? null,
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

// eslint-disable-next-line max-lines-per-function -- filter, count and ordered page share one SQL contract
export function listUsers(database: DatabaseSync, input: AdminUserQuery): AdminUserPage {
  const needle = input.query?.trim();
  const now = new Date().toISOString();
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (needle) {
    const searchColumns = {
      all: ['users.username', "IFNULL(users.email, '')", "IFNULL(users.display_name, '')"],
      username: ['users.username'],
      email: ["IFNULL(users.email, '')"],
      displayName: ["IFNULL(users.display_name, '')"],
    }[input.searchField ?? 'all'];
    where.push(`(${searchColumns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    const pattern = likePattern(needle);
    params.push(...searchColumns.map(() => pattern));
  }
  if (input.role) {
    where.push('COALESCE(users.role_override, users.role) = ?');
    params.push(input.role);
  }
  if (input.tier) {
    where.push("COALESCE(users.subscription_tier, 'free') = ?");
    params.push(input.tier);
  }
  if (input.blocked !== undefined)
    where.push(input.blocked ? 'users.blocked_at IS NOT NULL' : 'users.blocked_at IS NULL');
  const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = database
    .prepare(`SELECT COUNT(*) AS total FROM users ${condition}`)
    .get(...params) as { total: number };
  const orderColumns = {
    name: 'COALESCE(users.display_name, users.username) COLLATE NOCASE',
    role: 'users.role',
    tier: "COALESCE(users.subscription_tier, 'free')",
    created: 'users.created_at',
    sessions: 'active_sessions',
  } as const;
  const order = orderColumns[input.sortBy ?? 'created'];
  const direction = input.sortDirection === 'asc' ? 'ASC' : 'DESC';

  const selectSql = `
    SELECT
      users.id,
      users.username,
      COALESCE(users.role_override, users.role) AS role,
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
      users.timezone,
      users.created_at,
      COUNT(sessions.token_hash) AS active_sessions,
      MAX(sessions.last_seen_at) AS last_seen_at
    FROM users
    LEFT JOIN sessions
      ON sessions.user_id = users.id
     AND sessions.expires_at > ?1
    ${condition}
    GROUP BY users.id
    ORDER BY ${order} ${direction}, users.id ASC
    LIMIT ? OFFSET ?;
  `;
  const rows = database
    .prepare(selectSql)
    .all(now, ...params, input.limit, input.offset) as unknown as AdminUserRow[];

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
        COALESCE(users.role_override, users.role) AS role,
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
        users.timezone,
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
  if (
    actorPrincipal?.userId === targetUserId &&
    user.role === 'admin' &&
    newRole !== 'admin' &&
    activeAdminCount(database) <= 1
  ) {
    throw new Error('Последний суперадминистратор не может менять свою роль.');
  }

  database
    .prepare(
      'DELETE FROM career_partner_assignments WHERE partner_user_id = ? OR candidate_user_id = ?',
    )
    .run(targetUserId, targetUserId);
  persistRoleChange(database, candidateStore, targetUserId, newRole);

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

function persistRoleChange(
  database: DatabaseSync,
  candidateStore: CandidateStore,
  userId: string,
  newRole: UserRole,
): void {
  const now = new Date().toISOString();
  if (newRole !== 'candidate') {
    database
      .prepare(
        `UPDATE users
      SET role = 'admin', role_override = ?, candidate_id = NULL,
          admin_permissions_json = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(newRole === 'CareerPartner' ? 'CareerPartner' : null, now, userId);
    return;
  }
  const candidate = candidateStore.createCandidate({ dataClass: 'personal', locale: 'ru-RU' });
  database
    .prepare(
      `UPDATE users
    SET role = 'candidate', role_override = NULL, candidate_id = ?,
        admin_permissions_json = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(candidate.id, now, userId);
}

function deniedPermissionOverrides(): AdminPermissionOverrides {
  return {
    can_view_candidates: false,
    can_edit_campaigns: false,
    can_manage_pool: false,
    can_view_audit: false,
  };
}

function parsePermissionOverrides(value: string | null): AdminPermissionOverrides {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return deniedPermissionOverrides();
    }
    const source = parsed as Record<string, unknown>;
    return Object.fromEntries(
      ADMIN_PERMISSION_KEYS.flatMap((key) =>
        typeof source[key] === 'boolean' ? [[key, source[key]]] : [],
      ),
    ) as AdminPermissionOverrides;
  } catch {
    return deniedPermissionOverrides();
  }
}

export function getAdminPermissionSnapshot(database: DatabaseSync, userId: string) {
  const row = database
    .prepare(
      `SELECT COALESCE(role_override, role) AS role, admin_permissions_json
     FROM users WHERE id = ?`,
    )
    .get(userId) as { role: UserRole; admin_permissions_json: string | null } | undefined;
  if (!row) return null;
  const overrides = parsePermissionOverrides(row.admin_permissions_json);
  return { role: row.role, overrides, permissions: resolveAdminPermissions(row.role, overrides) };
}

function activeAdminCount(database: DatabaseSync): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM users
     WHERE role = 'admin' AND role_override IS NULL AND blocked_at IS NULL`,
    )
    .get() as { count: number };
  return row.count;
}

export function setAdminPermission(
  database: DatabaseSync,
  targetUserId: string,
  permission: AdminPermission,
  enabled: boolean,
  actorPrincipal: AuthPrincipal,
) {
  if (actorPrincipal.role !== 'admin') throw new Error('Недостаточно прав.');
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = getAdminPermissionSnapshot(database, targetUserId);
    if (!current) throw new Error('Пользователь не найден.');
    if (current.permissions[permission] === enabled) {
      database.exec('ROLLBACK');
      return current;
    }
    if (actorPrincipal.userId === targetUserId && activeAdminCount(database) <= 1) {
      throw new Error('Последний суперадминистратор не может менять свои права.');
    }
    const overrides: Partial<Record<AdminPermission, boolean>> = { ...current.overrides };
    if (DEFAULT_ADMIN_PERMISSIONS[current.role][permission] === enabled)
      delete overrides[permission];
    else overrides[permission] = enabled;
    database
      .prepare('UPDATE users SET admin_permissions_json = ? WHERE id = ?')
      .run(Object.keys(overrides).length ? JSON.stringify(overrides) : null, targetUserId);
    recordAdminAudit(database, {
      actorUserId: actorPrincipal.userId,
      actorUsername: actorPrincipal.username,
      action: 'change_user_permission',
      subjectUserId: targetUserId,
      subjectUsername: getUser(database, targetUserId)?.username ?? null,
      detail: JSON.stringify({ permission, enabled }),
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return getAdminPermissionSnapshot(database, targetUserId)!;
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

function updateUserValues(input: AdminUserUpdateInput, fallbackExpiresAt: string | null) {
  return [
    input.email ?? null,
    input.displayName ?? null,
    input.headline ?? null,
    input.location ?? null,
    input.workMode ?? null,
    input.subscriptionTier ?? null,
    input.subscriptionStatus ?? null,
    input.subscriptionExpiresAt !== undefined ? input.subscriptionExpiresAt : fallbackExpiresAt,
    input.subscriptionNotes ?? null,
    input.timezone ?? null,
  ];
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
           timezone = COALESCE(?, timezone),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(...updateUserValues(input, user.subscriptionExpiresAt), now, targetUserId);

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

  deleteCapabilityConsentsForUser(database, targetUserId);

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

export function listAudit(database: DatabaseSync, query?: AdminAuditQuery): AdminAuditPage {
  const limit = Math.min(query?.limit ?? 50, 100);
  const offset = query?.offset ?? 0;
  const where: string[] = [];
  const params: string[] = [];
  if (query?.query) {
    const pattern = likePattern(query.query);
    where.push(`(actor_username LIKE ? ESCAPE '\\' OR IFNULL(subject_username, '') LIKE ? ESCAPE '\\'
      OR IFNULL(detail, '') LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern, pattern);
  }
  if (query?.action === 'block_user') {
    where.push('action IN (?, ?)');
    params.push('block_user', 'unblock_user');
  } else if (query?.action) {
    where.push('action = ?');
    params.push(query.action);
  }
  const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const direction = query?.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const countRow = database
    .prepare(`SELECT COUNT(*) AS total FROM admin_audit ${condition}`)
    .get(...params) as { total: number };
  const rows = database
    .prepare(
      `SELECT * FROM admin_audit ${condition} ORDER BY created_at ${direction}, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as AuditRow[];

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
