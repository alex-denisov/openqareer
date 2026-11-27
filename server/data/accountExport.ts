import type { DatabaseSync } from 'node:sqlite';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import { type CandidateStatusChange, SqliteCandidateStatusRepository } from '../candidate/sqliteCandidateStatusRepository';
import { SqliteTelegramUsernameStore } from '../notifications/telegramUsernameStore';
import { tableExists } from './exportTableReader';
import { SealedText } from './sealedText';

/**
 * B738 · 7: учётная запись и кабинет. В выгрузке то, что полезно кандидату: логин, история оплат
 * (сумма, тариф, даты, чек), подписка и пробный период, настройки, согласия, статусы и решения.
 * Не выгружаются: соль и хеш пароля, хеш кода смены почты, ключ идемпотентности и ссылка оплаты
 * у провайдера, служебные коды ошибок и очередь напоминаний.
 */
export type AccountExportStore = { getCandidateWorkspace(candidateId: string): CandidateWorkspaceState | null };

export interface AccountExportSources {
  readonly store: AccountExportStore;
  readonly database: DatabaseSync;
  readonly encryptionKey: Buffer;
}

type Row = Record<string, unknown>;

/** Смены статуса без отменённых, как в истории на экране; предел выше любой реальной истории. */
const STATUS_EXPORT_LIMIT = 10_000;

export interface AccountExport {
  readonly user: Row | null;
  readonly payments: {
    readonly invoices: readonly Row[];
    readonly events: readonly Row[];
    readonly subscription: Row | null;
    readonly proTrial: Row | null;
    readonly planRequests: readonly Row[];
  };
  readonly workspace: CandidateWorkspaceState | null;
  readonly lastVisit: Row | null;
  readonly pendingEmailChange: Row | null;
  readonly appPreferences: Row | null;
  /** B779: «Подборку в своей роли — раз в неделю»: включена ли и когда менялась. */
  readonly weeklySelection: Row | null;
  readonly telegramUsername: string | null;
  readonly searchConsent: Row | null;
  readonly statusChanges: readonly CandidateStatusChange[];
  readonly statusSignalAnswers: readonly Row[];
  readonly offerChoices: readonly Row[];
}

function rows(database: DatabaseSync, table: string, sql: string, key: string): Row[] {
  if (!tableExists(database, table)) return [];
  return database.prepare(sql).all(key) as Row[];
}

const one = (database: DatabaseSync, table: string, sql: string, key: string): Row | null =>
  rows(database, table, sql, key)[0] ?? null;

function readPayments(database: DatabaseSync, userId: string | null): Omit<AccountExport['payments'], 'planRequests'> {
  if (!userId) return { invoices: [], events: [], subscription: null, proTrial: null };
  return {
    invoices: rows(
      database,
      'billing_invoices',
      `SELECT invoice_id AS invoiceId, plan_id AS planId, amount_kopecks AS amountKopecks, status,
         auto_renew_opt_in AS autoRenewOptIn, payment_method AS paymentMethod, renewal_period_end AS renewalPeriodEnd,
         receipt_url AS receiptUrl, receipt_status AS receiptStatus, fiscal_document_number AS fiscalDocumentNumber,
         fiscal_date AS fiscalDate, test_mode AS testMode, created_at AS createdAt, paid_at AS paidAt
       FROM billing_invoices WHERE user_id = ? ORDER BY created_at, invoice_id`,
      userId,
    ),
    events: rows(
      database,
      'billing_events',
      `SELECT event_type AS eventType, invoice_id AS invoiceId, occurred_at AS occurredAt
       FROM billing_events WHERE user_id = ? ORDER BY occurred_at, event_id`,
      userId,
    ),
    subscription: one(
      database,
      'billing_subscriptions',
      `SELECT plan_id AS planId, status, current_period_started_at AS currentPeriodStartedAt,
         current_period_ends_at AS currentPeriodEndsAt, next_charge_at AS nextChargeAt, auto_renew AS autoRenew,
         created_at AS createdAt, updated_at AS updatedAt
       FROM billing_subscriptions WHERE user_id = ?`,
      userId,
    ),
    proTrial: one(
      database,
      'billing_pro_trials',
      'SELECT started_at AS startedAt, expires_at AS expiresAt FROM billing_pro_trials WHERE user_id = ?',
      userId,
    ),
  };
}

function readSealed(sources: AccountExportSources, candidateId: string) {
  const { database, encryptionKey } = sources;
  return {
    telegramUsername: tableExists(database, 'candidate_telegram_usernames')
      ? new SqliteTelegramUsernameStore(database, new SealedText(encryptionKey)).get(candidateId)
      : null,
    statusChanges: tableExists(database, 'candidate_status_changes')
      ? new SqliteCandidateStatusRepository(database, encryptionKey).history(candidateId, STATUS_EXPORT_LIMIT)
      : [],
  };
}

function readSettings(database: DatabaseSync, candidateId: string) {
  return {
    lastVisit: one(
      database,
      'candidate_visits',
      'SELECT last_visited_at AS lastVisitedAt, previous_visited_at AS previousVisitedAt FROM candidate_visits WHERE candidate_id = ?',
      candidateId,
    ),
    pendingEmailChange: one(
      database,
      'account_email_change_requests',
      `SELECT current_email AS currentEmail, new_email AS newEmail, expires_at AS expiresAt, last_sent_at AS lastSentAt
       FROM account_email_change_requests WHERE candidate_id = ?`,
      candidateId,
    ),
    appPreferences: one(
      database,
      'candidate_app_preferences',
      'SELECT theme, money_currency AS moneyCurrency, updated_at AS updatedAt FROM candidate_app_preferences WHERE candidate_id = ?',
      candidateId,
    ),
    weeklySelection: one(
      database,
      'candidate_weekly_selection',
      'SELECT enabled, updated_at AS updatedAt FROM candidate_weekly_selection WHERE candidate_id = ?',
      candidateId,
    ),
    searchConsent: one(
      database,
      'search_consents',
      'SELECT granted, policy_version AS policyVersion, updated_at AS updatedAt FROM search_consents WHERE candidate_id = ?',
      candidateId,
    ),
  };
}

export function exportAccount(sources: AccountExportSources, candidateId: string): AccountExport {
  const { database } = sources;
  const user = one(
    database,
    'users',
    'SELECT id, username, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE candidate_id = ?',
    candidateId,
  );
  const userId = typeof user?.id === 'string' ? user.id : null;
  const { id: _id, ...shownUser } = user ?? {};
  const payments = readPayments(database, userId);
  return {
    user: user ? shownUser : null,
    payments: {
      ...payments,
      planRequests: rows(
        database,
        'plan_requests',
        'SELECT plan_id AS planId, note, created_at AS createdAt FROM plan_requests WHERE candidate_id = ? ORDER BY created_at, id',
        candidateId,
      ),
    },
    workspace: sources.store.getCandidateWorkspace(candidateId),
    ...readSettings(database, candidateId),
    ...readSealed(sources, candidateId),
    statusSignalAnswers: rows(
      database,
      'candidate_status_signal_answers',
      `SELECT kind, answer, created_at AS createdAt, undo_until AS undoUntil, undone_at AS undoneAt
       FROM candidate_status_signal_answers WHERE candidate_id = ? ORDER BY created_at, id`,
      candidateId,
    ),
    offerChoices: rows(
      database,
      'b640_offer_choices',
      `SELECT application_id AS applicationId, decision, decided_at AS decidedAt, tax_percent AS taxPercent, updated_at AS updatedAt
       FROM b640_offer_choices WHERE candidate_id = ? ORDER BY updated_at, application_id`,
      candidateId,
    ),
  };
}
