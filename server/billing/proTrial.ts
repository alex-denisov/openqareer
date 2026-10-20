import type { DatabaseSync } from 'node:sqlite';
import type { AdminUserRecord } from '../auth/authTypes';

export interface ProTrialState {
  status: 'eligible' | 'active' | 'expired' | 'unavailable';
  startedAt: string | null;
  expiresAt: string | null;
  serverNow: string;
}

export function withEffectiveProTrial(
  database: DatabaseSync,
  user: AdminUserRecord,
  now: string,
): AdminUserRecord {
  const hasPaidAccess =
    user.subscriptionTier !== 'free' &&
    (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'trialing') &&
    (user.subscriptionExpiresAt === null || user.subscriptionExpiresAt > now);
  const hasBillingTable = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_subscriptions'")
    .get();
  const hasPaidBilling =
    hasBillingTable &&
    database
      .prepare(
        "SELECT 1 FROM billing_subscriptions WHERE user_id = ? AND status != 'expired' AND current_period_ends_at > ?",
      )
      .get(user.id, now);
  if (!hasPaidAccess && !hasPaidBilling && hasActiveProTrial(database, user.id, now)) {
    const row = database
      .prepare('SELECT expires_at FROM billing_pro_trials WHERE user_id = ?')
      .get(user.id) as { expires_at: string };
    return {
      ...user,
      subscriptionTier: 'pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: row.expires_at,
    };
  }
  return user;
}

interface TrialRow {
  started_at: string;
  expires_at: string;
}
const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

export function hasActiveProTrial(database: DatabaseSync, userId: string, now: string): boolean {
  if (
    !database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_pro_trials'")
      .get()
  )
    return false;
  return (
    database
      .prepare(
        'SELECT 1 FROM billing_pro_trials WHERE user_id = ? AND started_at <= ? AND expires_at > ?',
      )
      .get(userId, now, now) !== undefined
  );
}

export function readProTrial(
  database: DatabaseSync,
  userId: string,
  now: string,
  paid: boolean,
): ProTrialState {
  const row = database
    .prepare('SELECT started_at, expires_at FROM billing_pro_trials WHERE user_id = ?')
    .get(userId) as TrialRow | undefined;
  return {
    status: paid
      ? 'unavailable'
      : row
        ? row.started_at <= now && row.expires_at > now
          ? 'active'
          : 'expired'
        : 'eligible',
    startedAt: row?.started_at ?? null,
    expiresAt: row?.expires_at ?? null,
    serverNow: now,
  };
}

/** Caller holds a BEGIN IMMEDIATE transaction across paid-plan eligibility and insertion. */
export function insertProTrial(database: DatabaseSync, userId: string, now: string): boolean {
  return (
    database
      .prepare(
        'INSERT INTO billing_pro_trials (user_id, started_at, expires_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING',
      )
      .run(userId, now, new Date(Date.parse(now) + TRIAL_DURATION_MS).toISOString()).changes === 1
  );
}
