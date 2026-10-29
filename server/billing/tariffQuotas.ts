import type { DatabaseSync } from 'node:sqlite';

/**
 * B579 (решение владельца 28.10): месячные квоты тарифов — рычаг перехода между
 * тарифами и потолок себестоимости. Это не ограничение частоты (B557): квота
 * считает работу за период подписки, а не запросы в минуту.
 */
export type QuotaPlanId = 'free' | 'basic' | 'pro' | 'max';

export const QUOTA_KEYS = [
  'applications',
  'auto_applications',
  'coach_turns',
  'interview_trainings',
  'linkedin_drafts',
] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];

const PLAN_ORDER: readonly QuotaPlanId[] = ['free', 'basic', 'pro', 'max'];

/** 0 — квоты на тарифе нет. Автоотклики — часть откликов с резюме и письмом. */
export const TARIFF_QUOTAS: Readonly<Record<QuotaPlanId, Readonly<Record<QuotaKey, number>>>> = {
  free: {
    applications: 20,
    auto_applications: 0,
    coach_turns: 30,
    interview_trainings: 0,
    linkedin_drafts: 0,
  },
  basic: {
    applications: 100,
    auto_applications: 0,
    coach_turns: 300,
    interview_trainings: 10,
    linkedin_drafts: 0,
  },
  pro: {
    applications: 500,
    auto_applications: 500,
    coach_turns: 1_000,
    interview_trainings: 30,
    linkedin_drafts: 90,
  },
  max: {
    applications: 2_000,
    auto_applications: 2_000,
    coach_turns: 3_000,
    interview_trainings: 100,
    linkedin_drafts: 210,
  },
};

export const QUOTA_LABELS: Readonly<Record<QuotaKey, string>> = {
  applications: 'Отклики с резюме и письмом',
  auto_applications: 'Автоотклики',
  coach_turns: 'Ходы консультанта',
  interview_trainings: 'Тренировки интервью',
  linkedin_drafts: 'Черновики LinkedIn',
};

const PLAN_NAMES: Readonly<Record<QuotaPlanId, string>> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  max: 'Max',
};

/** Тестовые аккаунты работают без квот (B435), кроме аккаунта приёмки квот. */
export const QUOTA_ENFORCED_TEST_USERNAMES: ReadonlySet<string> = new Set(['adenisov.test']);

export interface QuotaPeriod {
  readonly startedAt: string;
  readonly endsAt: string;
}

export interface QuotaStatus {
  readonly key: QuotaKey;
  readonly label: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly upgradePlan: QuotaPlanId | null;
}

export interface QuotaSummary {
  readonly plan: QuotaPlanId;
  readonly unlimited: boolean;
  readonly period: QuotaPeriod;
  readonly quotas: readonly QuotaStatus[];
}

export type QuotaConsumeResult =
  | { readonly kind: 'allowed'; readonly status: QuotaStatus | null }
  | { readonly kind: 'exhausted'; readonly status: QuotaStatus; readonly plan: QuotaPlanId };

/** Первый тариф выше текущего, где этой квоты больше. */
export function upgradePlanFor(plan: QuotaPlanId, key: QuotaKey): QuotaPlanId | null {
  const current = TARIFF_QUOTAS[plan][key];
  return (
    PLAN_ORDER.slice(PLAN_ORDER.indexOf(plan) + 1).find(
      (next) => TARIFF_QUOTAS[next][key] > current,
    ) ?? null
  );
}

/** Календарный месяц UTC: период Free и старых тарифов без подписки. */
export function calendarMonthPeriod(now: string): QuotaPeriod {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { startedAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

/** Сообщение 402: название квоты и тариф, где её больше. */
export function quotaExhaustedMessage(status: QuotaStatus): string {
  const base =
    status.limit === 0
      ? `${status.label} не входят в ваш тариф.`
      : `${status.label}: квота месяца исчерпана (${status.limit}).`;
  return status.upgradePlan
    ? `${base} Больше — на тарифе ${PLAN_NAMES[status.upgradePlan]}.`
    : base;
}

interface QuotaAccount {
  readonly plan: QuotaPlanId;
  readonly unlimited: boolean;
  readonly period: QuotaPeriod;
}

export function countQuotaUse(
  database: DatabaseSync,
  candidateId: string,
  key: QuotaKey,
  period: QuotaPeriod,
): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS used FROM billing_quota_events
     WHERE candidate_id = ? AND quota_key = ? AND period_started_at = ?`,
    )
    .get(candidateId, key, period.startedAt) as { used: number };
  return row.used;
}

function statusOf(
  database: DatabaseSync,
  candidateId: string,
  account: QuotaAccount,
  key: QuotaKey,
): QuotaStatus {
  const limit = TARIFF_QUOTAS[account.plan][key];
  const used = countQuotaUse(database, candidateId, key, account.period);
  return {
    key,
    label: QUOTA_LABELS[key],
    limit,
    used,
    remaining: Math.max(0, limit - used),
    upgradePlan: upgradePlanFor(account.plan, key),
  };
}

export function readQuotaSummary(
  database: DatabaseSync,
  candidateId: string,
  account: QuotaAccount,
): QuotaSummary {
  return {
    plan: account.plan,
    unlimited: account.unlimited,
    period: account.period,
    quotas: QUOTA_KEYS.map((key) => statusOf(database, candidateId, account, key)),
  };
}

/**
 * Списывает единицу квоты до вызова модели. Повтор той же единицы (тот же ход
 * по ключу идемпотентности, то же письмо к вакансии) не списывается второй раз.
 */
export function consumeQuotaUnit(
  database: DatabaseSync,
  candidateId: string,
  account: QuotaAccount,
  key: QuotaKey,
  unitKey: string,
  now: string,
): QuotaConsumeResult {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = consumeInTransaction(database, candidateId, account, key, unitKey, now);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function consumeInTransaction(
  database: DatabaseSync,
  candidateId: string,
  account: QuotaAccount,
  key: QuotaKey,
  unitKey: string,
  now: string,
): QuotaConsumeResult {
  const counted = database
    .prepare(
      `SELECT 1 FROM billing_quota_events
     WHERE candidate_id = ? AND quota_key = ? AND period_started_at = ? AND unit_key = ?`,
    )
    .get(candidateId, key, account.period.startedAt, unitKey);
  if (counted || account.unlimited) {
    if (!counted) insertQuotaEvent(database, candidateId, account.period, key, unitKey, now);
    return { kind: 'allowed', status: null };
  }
  const status = statusOf(database, candidateId, account, key);
  if (status.remaining <= 0) return { kind: 'exhausted', status, plan: account.plan };
  insertQuotaEvent(database, candidateId, account.period, key, unitKey, now);
  return {
    kind: 'allowed',
    status: { ...status, used: status.used + 1, remaining: status.remaining - 1 },
  };
}

/** Возвращает единицу, если работа не состоялась (модель не ответила). */
export function releaseQuotaUnit(
  database: DatabaseSync,
  candidateId: string,
  key: QuotaKey,
  unitKey: string,
): void {
  database
    .prepare('DELETE FROM billing_quota_events WHERE candidate_id = ? AND quota_key = ? AND unit_key = ?')
    .run(candidateId, key, unitKey);
}

function insertQuotaEvent(
  database: DatabaseSync,
  candidateId: string,
  period: QuotaPeriod,
  key: QuotaKey,
  unitKey: string,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO billing_quota_events (candidate_id, quota_key, period_started_at, unit_key, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    )
    .run(candidateId, key, period.startedAt, unitKey, now);
}
