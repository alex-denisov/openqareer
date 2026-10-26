import { DatabaseSync } from 'node:sqlite';
import { hasActiveProTrial, readProTrial, type ProTrialState } from './proTrial';
import { randomUUID } from 'node:crypto';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { BILLING_PLANS } from './billingPlans';
import type { PaidPlanId } from './robokassaGateway';

export interface BillingInvoice {
  invoiceId: number;
  userId: string | null;
  planId: PaidPlanId;
  amountKopecks: number;
  idempotencyKey: string;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  autoRenewOptIn: boolean;
  paymentUrl: string | null;
  paymentMethod: string | null;
  testMode: boolean;
  recurringParentInvoiceId: number | null;
  renewalPeriodEnd: string | null;
  receiptUrl: string | null;
  receiptStatus: string | null;
  fiscalDocumentNumber: string | null;
  fiscalDate: string | null;
  createdAt: string;
  paidAt: string | null;
  updatedAt: string;
}

export interface BillingSubscription {
  userId: string;
  planId: PaidPlanId;
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  currentPeriodStartedAt: string;
  currentPeriodEndsAt: string;
  nextChargeAt: string | null;
  autoRenew: boolean;
  parentInvoiceId: number;
  lastInvoiceId: number;
  lastFailureCode: string | null;
  cancellationEventId: string | null;
}

export interface BillingRenewalReminder {
  userId: string;
  email: string;
  timezone: string | null;
  planId: PaidPlanId;
  periodEnd: string;
  amountKopecks: number;
}

export type ReserveCheckoutResult =
  | { kind: 'created'; invoice: BillingInvoice }
  | { kind: 'existing'; invoice: BillingInvoice }
  | { kind: 'in_progress'; invoice: BillingInvoice }
  | { kind: 'conflict' };

export type ApplyPaymentResult = 'applied' | 'duplicate' | 'not_pending' | 'not_found';
export type ReserveRenewalResult =
  | { kind: 'created'; invoice: BillingInvoice }
  | { kind: 'already_reserved' }
  | { kind: 'not_due' };

interface InvoiceRow {
  invoice_id: number; user_id: string | null; plan_id: PaidPlanId; amount_kopecks: number;
  idempotency_key: string; status: BillingInvoice['status']; auto_renew_opt_in: number;
  payment_url: string | null;
  payment_method: string | null; test_mode: number; recurring_parent_invoice_id: number | null;
  renewal_period_end: string | null; receipt_url: string | null; receipt_status: string | null;
  fiscal_document_number: string | null; fiscal_date: string | null; created_at: string;
  paid_at: string | null; updated_at: string;
}

interface SubscriptionRow {
  user_id: string; plan_id: PaidPlanId; status: BillingSubscription['status'];
  current_period_started_at: string; current_period_ends_at: string; next_charge_at: string | null;
  auto_renew: number; parent_invoice_id: number; last_invoice_id: number; last_failure_code: string | null;
  cancellation_event_id: string | null;
}

interface ReminderRow {
  user_id: string;
  email: string;
  timezone: string | null;
  plan_id: PaidPlanId;
  period_end: string;
}

export class SqliteBillingRepository {
  private readonly database: DatabaseSync;

  constructor(options: { databasePath: string }) {
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000, enableForeignKeyConstraints: true, defensive: true,
    });
    applySqliteBusyTimeout(this.database);
  }

  reserveCheckout(input: {
    userId: string; planId: PaidPlanId; amountKopecks: number; idempotencyKey: string;
    autoRenewOptIn: boolean; testMode: boolean; now: string;
  }): ReserveCheckoutResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database.prepare(
        'SELECT * FROM billing_invoices WHERE user_id = ? AND idempotency_key = ?',
      ).get(input.userId, input.idempotencyKey) as InvoiceRow | undefined;
      if (existing) {
        const invoice = toInvoice(existing);
        this.database.exec('COMMIT');
        if (invoice.planId !== input.planId || invoice.amountKopecks !== input.amountKopecks
          || invoice.autoRenewOptIn !== input.autoRenewOptIn) {
          return { kind: 'conflict' };
        }
        return invoice.paymentUrl || invoice.status !== 'pending'
          ? { kind: 'existing', invoice }
          : { kind: 'in_progress', invoice };
      }
      const result = this.database.prepare(
        `INSERT INTO billing_invoices (
           user_id, plan_id, amount_kopecks, idempotency_key, status, auto_renew_opt_in,
           test_mode, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      ).run(input.userId, input.planId, input.amountKopecks, input.idempotencyKey,
        input.autoRenewOptIn ? 1 : 0,
        input.testMode ? 1 : 0, input.now, input.now);
      const invoice = this.getInvoice(Number(result.lastInsertRowid));
      if (!invoice) throw new Error('billing_invoice_insert_failed');
      this.database.exec('COMMIT');
      return { kind: 'created', invoice };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  setCheckoutUrl(invoiceId: number, paymentUrl: string, now: string): void {
    this.database.prepare(
      `UPDATE billing_invoices SET payment_url = ?, updated_at = ?
       WHERE invoice_id = ? AND status = 'pending' AND payment_url IS NULL`,
    ).run(paymentUrl, now, invoiceId);
  }

  markCheckoutFailed(invoiceId: number, now: string): void {
    this.database.prepare(
      `UPDATE billing_invoices SET status = 'failed', updated_at = ?
       WHERE invoice_id = ? AND status = 'pending'`,
    ).run(now, invoiceId);
  }

  getInvoice(invoiceId: number): BillingInvoice | null {
    const row = this.database.prepare(
      'SELECT * FROM billing_invoices WHERE invoice_id = ?',
    ).get(invoiceId) as InvoiceRow | undefined;
    return row ? toInvoice(row) : null;
  }

  getInvoiceForUser(userId: string, invoiceId: number): BillingInvoice | null {
    const row = this.database.prepare(
      'SELECT * FROM billing_invoices WHERE user_id = ? AND invoice_id = ?',
    ).get(userId, invoiceId) as InvoiceRow | undefined;
    return row ? toInvoice(row) : null;
  }

  hasCheckoutForIdempotencyKey(userId: string, idempotencyKey: string): boolean {
    return this.database.prepare(
      'SELECT 1 FROM billing_invoices WHERE user_id = ? AND idempotency_key = ? LIMIT 1',
    ).get(userId, idempotencyKey) !== undefined;
  }

  getEffectivePlan(userId: string, now: string): 'free' | 'basic' | 'pro' | 'max' {
    return this.getSubscription(userId, now)?.planId ?? this.getLegacyPaidPlan(userId, now)
      ?? (hasActiveProTrial(this.database, userId, now) ? 'pro' : 'free');
  }

  getProTrial(userId: string, now: string): ProTrialState {
    const paid = this.getSubscription(userId, now) !== null || this.getLegacyPaidPlan(userId, now) !== null;
    return readProTrial(this.database, userId, now, paid);
  }

  getSubscription(userId: string, now: string): BillingSubscription | null {
    const row = this.database.prepare(
      `SELECT * FROM billing_subscriptions
       WHERE user_id = ? AND status != 'expired'
         AND (current_period_ends_at > ? OR EXISTS (
           SELECT 1 FROM billing_invoices AS i
           WHERE i.user_id = billing_subscriptions.user_id
             AND i.recurring_parent_invoice_id IS NOT NULL AND i.status = 'processing'
             AND i.created_at >= ?
         ))`,
    ).get(userId, now, new Date(Date.parse(now) - 48 * 60 * 60 * 1_000).toISOString()) as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  getLegacyPaidPlan(userId: string, now: string): 'pro' | 'max' | null {
    const row = this.database.prepare(
      `SELECT users.subscription_tier, users.subscription_status, users.subscription_expires_at
       FROM users
       WHERE users.id = ?
         AND NOT EXISTS (SELECT 1 FROM billing_subscriptions WHERE user_id = users.id)`,
    ).get(userId) as {
      subscription_tier: string;
      subscription_status: string;
      subscription_expires_at: string | null;
    } | undefined;
    if (!row || (row.subscription_status !== 'active' && row.subscription_status !== 'trialing')) return null;
    if (row.subscription_expires_at && row.subscription_expires_at <= now) return null;
    if (row.subscription_tier === 'pro') return 'pro';
    if (row.subscription_tier === 'enterprise' || row.subscription_tier === 'executive') return 'max';
    return null;
  }

  canCandidateUseLlm(candidateId: string, now: string): boolean {
    const trialUser = this.database.prepare('SELECT id FROM users WHERE candidate_id = ?').get(candidateId) as { id: string } | undefined;
    if (trialUser && hasActiveProTrial(this.database, trialUser.id, now)) return true;
    const row = this.database.prepare(
      `SELECT users.subscription_tier, users.subscription_status,
              users.subscription_expires_at, billing_subscriptions.status AS billing_status,
              billing_subscriptions.current_period_ends_at
       FROM users LEFT JOIN billing_subscriptions ON billing_subscriptions.user_id = users.id
       WHERE users.candidate_id = ?`,
    ).get(candidateId) as {
      subscription_tier: string;
      subscription_status: string;
      subscription_expires_at: string | null;
      billing_status: string | null;
      current_period_ends_at: string | null;
    } | undefined;
    if (!row) return false;
    if (row.billing_status !== null) {
      if (row.current_period_ends_at !== null && row.current_period_ends_at > now
        && row.billing_status !== 'expired') return true;
      return this.database.prepare(
        `SELECT 1 FROM billing_invoices
         WHERE user_id = (SELECT id FROM users WHERE candidate_id = ?)
           AND recurring_parent_invoice_id IS NOT NULL AND status = 'processing'
           AND created_at >= ? LIMIT 1`,
      ).get(candidateId, new Date(Date.parse(now) - 48 * 60 * 60 * 1_000).toISOString()) !== undefined;
    }
    return row.subscription_tier !== 'free'
      && (row.subscription_status === 'active' || row.subscription_status === 'trialing')
      && (row.subscription_expires_at === null || row.subscription_expires_at > now);
  }

  cancelRenewal(userId: string, now: string): BillingSubscription | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare(
        `SELECT * FROM billing_subscriptions
         WHERE user_id = ? AND current_period_ends_at > ? AND status != 'expired'`,
      ).get(userId, now) as SubscriptionRow | undefined;
      if (!row) { this.database.exec('COMMIT'); return null; }
      if (row.auto_renew === 1) {
        const eventId = randomUUID();
        this.database.prepare(
          `INSERT INTO billing_events (
             event_id, user_id, actor_user_id, event_type, occurred_at, detail_code
           ) VALUES (?, ?, ?, 'subscription.auto_renew_disabled', ?, 'candidate_request')`,
        ).run(eventId, userId, userId, now);
        this.database.prepare(
          `UPDATE billing_subscriptions
           SET auto_renew = 0, next_charge_at = NULL, cancellation_event_id = ?, updated_at = ?
           WHERE user_id = ? AND auto_renew = 1`,
        ).run(eventId, now, userId);
      }
      const updated = this.database.prepare(
        `SELECT * FROM billing_subscriptions WHERE user_id = ? AND current_period_ends_at > ?`,
      ).get(userId, now) as SubscriptionRow | undefined;
      this.database.exec('COMMIT');
      return updated ? toSubscription(updated) : null;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  hasUnresolvedPayment(userId: string): boolean {
    return this.database.prepare(
      `SELECT 1 FROM billing_invoices
       WHERE user_id = ? AND status IN ('pending', 'processing') LIMIT 1`,
    ).get(userId) !== undefined;
  }

  listReceipts(userId: string, input: { cursor?: number; limit: number }): BillingInvoice[] {
    const rows = this.database.prepare(
      `SELECT * FROM billing_invoices
       WHERE user_id = ? AND status = 'paid' AND (? IS NULL OR invoice_id < ?)
       ORDER BY invoice_id DESC LIMIT ?`,
    ).all(userId, input.cursor ?? null, input.cursor ?? null, input.limit) as unknown as InvoiceRow[];
    return rows.map(toInvoice);
  }

  listDueSubscriptions(now: string, limit: number): BillingSubscription[] {
    const rows = this.database.prepare(
      `SELECT s.* FROM billing_subscriptions AS s
       WHERE s.status = 'active' AND s.auto_renew = 1
         AND s.next_charge_at IS NOT NULL AND s.next_charge_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM billing_invoices AS i
           WHERE i.user_id = s.user_id AND i.renewal_period_end = s.current_period_ends_at
             AND i.status IN ('pending', 'processing')
         )
       ORDER BY s.next_charge_at, s.user_id LIMIT ?`,
    ).all(now, limit) as unknown as SubscriptionRow[];
    return rows.map(toSubscription);
  }

  listProcessingRenewals(updatedBefore: string, limit: number): BillingInvoice[] {
    const rows = this.database.prepare(
      `SELECT * FROM billing_invoices
       WHERE recurring_parent_invoice_id IS NOT NULL AND status = 'processing'
         AND updated_at <= ?
       ORDER BY updated_at, invoice_id LIMIT ?`,
    ).all(updatedBefore, limit) as unknown as InvoiceRow[];
    return rows.map(toInvoice);
  }

  markRenewalStatusChecked(invoiceId: number, now: string): void {
    this.database.prepare(
      `UPDATE billing_invoices SET updated_at = ?
       WHERE invoice_id = ? AND status = 'processing'`,
    ).run(now, invoiceId);
  }

  claimDueRenewalReminders(input: {
    now: string;
    dueBefore: string;
    limit: number;
    emailVerificationRequired: boolean;
  }): BillingRenewalReminder[] {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const rows = dueReminderRows(this.database, input);
      const claimed: BillingRenewalReminder[] = [];
      const leaseUntil = new Date(Date.parse(input.now) + 5 * 60_000).toISOString();
      for (const row of rows) {
        if (!claimBillingReminder(this.database, row, leaseUntil, input.now)) continue;
        claimed.push({
          userId: row.user_id,
          email: row.email,
          timezone: row.timezone,
          planId: row.plan_id,
          periodEnd: row.period_end,
          amountKopecks: BILLING_PLANS[row.plan_id].amountKopecks,
        });
      }
      this.database.exec('COMMIT');
      return claimed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  finishRenewalReminder(input: {
    userId: string; periodEnd: string; success: boolean; errorCode?: string; now: string;
  }): void {
    this.database.prepare(
      `UPDATE billing_reminders
       SET status = ?, lease_until = NULL, last_error_code = ?, updated_at = ?
       WHERE user_id = ? AND period_end = ? AND status = 'sending'`,
    ).run(input.success ? 'sent' : 'failed', input.success ? null : input.errorCode ?? 'delivery_failed',
      input.now, input.userId, input.periodEnd);
  }

  reserveRenewal(input: {
    userId: string; planId: PaidPlanId; amountKopecks: number; parentInvoiceId: number;
    periodEnd: string; testMode: boolean; now: string;
  }): ReserveRenewalResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const subscription = this.database.prepare(
        `SELECT * FROM billing_subscriptions
         WHERE user_id = ? AND plan_id = ? AND parent_invoice_id = ?
           AND current_period_ends_at = ? AND next_charge_at <= ? AND auto_renew = 1 AND status = 'active'`,
      ).get(input.userId, input.planId, input.parentInvoiceId, input.periodEnd, input.now) as SubscriptionRow | undefined;
      if (!subscription) {
        this.database.exec('COMMIT');
        return { kind: 'not_due' };
      }
      const idempotencyKey = `renewal:${input.periodEnd}`;
      const existing = this.database.prepare(
        'SELECT invoice_id FROM billing_invoices WHERE user_id = ? AND idempotency_key = ?',
      ).get(input.userId, idempotencyKey) as { invoice_id: number } | undefined;
      if (existing) {
        this.database.exec('COMMIT');
        return { kind: 'already_reserved' };
      }
      const inserted = this.database.prepare(
        `INSERT INTO billing_invoices (
           user_id, plan_id, amount_kopecks, idempotency_key, status, auto_renew_opt_in, test_mode,
           recurring_parent_invoice_id, renewal_period_end, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?)`,
      ).run(input.userId, input.planId, input.amountKopecks, idempotencyKey,
        input.testMode ? 1 : 0, input.parentInvoiceId, input.periodEnd, input.now, input.now);
      const invoice = this.getInvoice(Number(inserted.lastInsertRowid));
      if (!invoice) throw new Error('billing_renewal_invoice_insert_failed');
      this.database.exec('COMMIT');
      return { kind: 'created', invoice };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  markRenewalFailed(invoiceId: number, failureCode: string, now: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const invoice = this.getInvoice(invoiceId);
      if (!invoice || !invoice.recurringParentInvoiceId || !invoice.userId) {
        this.database.exec('COMMIT');
        return;
      }
      if (invoice.status !== 'pending' && invoice.status !== 'processing') {
        this.database.exec('COMMIT');
        return;
      }
      const failed = this.database.prepare(
        `UPDATE billing_invoices SET status = 'failed', updated_at = ?
         WHERE invoice_id = ? AND status IN ('pending', 'processing')`,
      ).run(now, invoiceId).changes;
      if (failed !== 1) {
        this.database.exec('COMMIT');
        return;
      }
      this.database.prepare(
        `UPDATE billing_subscriptions
         SET status = 'past_due', last_failure_code = ?, updated_at = ?
         WHERE user_id = ? AND last_invoice_id != ?`,
      ).run(failureCode.slice(0, 80), now, invoice.userId, invoiceId);
      this.database.prepare(
        `INSERT INTO billing_events (
           event_id, user_id, actor_user_id, event_type, invoice_id, occurred_at, detail_code
         ) VALUES (?, ?, NULL, 'renewal.rejected', ?, ?, ?)`,
      ).run(randomUUID(), invoice.userId, invoiceId, now, failureCode.slice(0, 80));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  markRenewalProcessing(invoiceId: number, detailCode: string, now: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const invoice = this.getInvoice(invoiceId);
      if (!invoice || !invoice.recurringParentInvoiceId || !invoice.userId) {
        this.database.exec('COMMIT');
        return;
      }
      const changed = this.database.prepare(
        `UPDATE billing_invoices SET status = 'processing', updated_at = ?
         WHERE invoice_id = ? AND status IN ('pending', 'processing')`,
      ).run(now, invoiceId).changes;
      if (changed === 1) {
        const eventType = detailCode === 'provider_outcome_unknown'
          ? 'renewal.outcome_unknown'
          : 'renewal.initiated';
        this.database.prepare(
          `INSERT INTO billing_events (
             event_id, user_id, actor_user_id, event_type, invoice_id, occurred_at, detail_code
           ) VALUES (?, ?, NULL, ?, ?, ?, ?)`,
        ).run(randomUUID(), invoice.userId, eventType, invoiceId, now, detailCode);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  applySuccessfulInvoice(input: {
    invoiceId: number; paymentMethod: string | null; paidAt: string;
  }): ApplyPaymentResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const invoice = this.getInvoice(input.invoiceId);
      if (!invoice) { this.database.exec('COMMIT'); return 'not_found'; }
      if (invoice.status === 'paid') { this.database.exec('COMMIT'); return 'duplicate'; }
      if ((invoice.status !== 'pending' && invoice.status !== 'processing') || invoice.userId === null) {
        this.database.exec('COMMIT');
        return 'not_pending';
      }
      const subscription = this.database.prepare(
        'SELECT * FROM billing_subscriptions WHERE user_id = ?',
      ).get(invoice.userId) as SubscriptionRow | undefined;
      const periodStart = invoice.renewalPeriodEnd
        ? new Date(Math.max(Date.parse(invoice.renewalPeriodEnd), Date.parse(input.paidAt))).toISOString()
        : input.paidAt;
      const periodEnd = addCalendarMonth(periodStart);
      this.database.prepare(
        `UPDATE billing_invoices
         SET status = 'paid', payment_method = ?, paid_at = ?, updated_at = ?
         WHERE invoice_id = ? AND status IN ('pending', 'processing')`,
      ).run(input.paymentMethod, input.paidAt, input.paidAt, invoice.invoiceId);
      this.database.prepare(
        `INSERT INTO billing_events (
           event_id, user_id, actor_user_id, event_type, invoice_id, occurred_at, detail_code
         ) VALUES (?, ?, NULL, 'payment.confirmed', ?, ?, ?)`
      ).run(randomUUID(), invoice.userId, invoice.invoiceId, input.paidAt,
        invoice.recurringParentInvoiceId === null ? 'initial_payment' : 'renewal_payment');
      savePaidSubscription(this.database, invoice, subscription, input, periodStart, periodEnd);
      this.database.exec('COMMIT');
      return 'applied';
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void { this.database.close(); }
}

function dueReminderRows(
  database: DatabaseSync,
  input: { now: string; dueBefore: string; limit: number; emailVerificationRequired: boolean },
): ReminderRow[] {
  const verificationJoin = input.emailVerificationRequired
    ? 'LEFT JOIN email_verifications AS v ON v.candidate_id = users.candidate_id'
    : '';
  const verificationFilter = input.emailVerificationRequired ? 'AND v.verified_at IS NOT NULL' : '';
  return database.prepare(
    `SELECT s.user_id, users.email, users.timezone, s.plan_id,
            s.current_period_ends_at AS period_end
     FROM billing_subscriptions AS s
     JOIN users ON users.id = s.user_id
     ${verificationJoin}
     WHERE s.status = 'active' AND s.auto_renew = 1
       AND s.next_charge_at > ? AND s.next_charge_at <= ?
       AND users.email IS NOT NULL AND length(trim(users.email)) > 0
       ${verificationFilter}
       AND NOT EXISTS (
         SELECT 1 FROM billing_reminders AS r
         WHERE r.user_id = s.user_id AND r.period_end = s.current_period_ends_at
           AND (r.status = 'sent' OR r.attempts >= 3
                OR (r.status = 'sending' AND r.lease_until > ?))
       )
     ORDER BY s.next_charge_at, s.user_id LIMIT ?`,
  ).all(input.now, input.dueBefore, input.now, input.limit) as unknown as ReminderRow[];
}

function toInvoice(row: InvoiceRow): BillingInvoice {
  return {
    invoiceId: row.invoice_id, userId: row.user_id, planId: row.plan_id,
    amountKopecks: row.amount_kopecks, idempotencyKey: row.idempotency_key,
    status: row.status, autoRenewOptIn: row.auto_renew_opt_in === 1,
    paymentUrl: row.payment_url, paymentMethod: row.payment_method,
    testMode: row.test_mode === 1, recurringParentInvoiceId: row.recurring_parent_invoice_id,
    renewalPeriodEnd: row.renewal_period_end, receiptUrl: row.receipt_url,
    receiptStatus: row.receipt_status, fiscalDocumentNumber: row.fiscal_document_number,
    fiscalDate: row.fiscal_date, createdAt: row.created_at, paidAt: row.paid_at,
    updatedAt: row.updated_at,
  };
}

function claimBillingReminder(
  database: DatabaseSync,
  reminder: ReminderRow,
  leaseUntil: string,
  now: string,
): boolean {
  const result = database.prepare(
    `INSERT INTO billing_reminders (
       user_id, period_end, status, attempts, lease_until, created_at, updated_at
     ) VALUES (?, ?, 'sending', 1, ?, ?, ?)
     ON CONFLICT(user_id, period_end) DO UPDATE SET
       status = 'sending', attempts = billing_reminders.attempts + 1,
       lease_until = excluded.lease_until, last_error_code = NULL,
       updated_at = excluded.updated_at
     WHERE billing_reminders.status != 'sent' AND billing_reminders.attempts < 3
       AND (billing_reminders.status != 'sending' OR billing_reminders.lease_until <= ?)`,
  ).run(reminder.user_id, reminder.period_end, leaseUntil, now, now, now);
  return result.changes === 1;
}

function savePaidSubscription(
  database: DatabaseSync,
  invoice: BillingInvoice,
  subscription: SubscriptionRow | undefined,
  input: { paidAt: string },
  periodStart: string,
  periodEnd: string,
): void {
  if (invoice.userId === null) throw new Error('billing_invoice_user_missing');
  if (subscription) {
    const isRenewal = invoice.recurringParentInvoiceId !== null;
    const rolloverBase = Math.max(
      Date.parse(input.paidAt),
      isRenewal ? Date.parse(invoice.renewalPeriodEnd ?? input.paidAt)
        : Date.parse(subscription.current_period_ends_at),
    );
    const nextPeriodStart = isRenewal
      ? new Date(rolloverBase).toISOString()
      : input.paidAt;
    const nextPeriodEnd = addCalendarMonth(new Date(rolloverBase).toISOString());
    const autoRenew = isRenewal ? subscription.auto_renew === 1 : invoice.autoRenewOptIn;
    database.prepare(
      `UPDATE billing_subscriptions
       SET plan_id = ?, status = 'active', current_period_started_at = ?,
           current_period_ends_at = ?, next_charge_at = ?, auto_renew = ?,
           parent_invoice_id = ?, last_invoice_id = ?, last_failure_code = NULL,
           cancellation_event_id = NULL, updated_at = ?
       WHERE user_id = ?`,
    ).run(invoice.planId, nextPeriodStart, nextPeriodEnd,
      autoRenew ? nextPeriodEnd : null, autoRenew ? 1 : 0,
      isRenewal ? subscription.parent_invoice_id : invoice.invoiceId,
      invoice.invoiceId, input.paidAt, invoice.userId);
    return;
  }
  database.prepare(
    `INSERT INTO billing_subscriptions (
       user_id, plan_id, status, current_period_started_at, current_period_ends_at,
       next_charge_at, auto_renew, parent_invoice_id, last_invoice_id, created_at, updated_at
     ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(invoice.userId, invoice.planId, input.paidAt, periodEnd,
    invoice.autoRenewOptIn ? periodEnd : null,
    invoice.autoRenewOptIn ? 1 : 0, invoice.invoiceId, invoice.invoiceId, input.paidAt, input.paidAt);
}

function toSubscription(row: SubscriptionRow): BillingSubscription {
  return {
    userId: row.user_id, planId: row.plan_id, status: row.status,
    currentPeriodStartedAt: row.current_period_started_at,
    currentPeriodEndsAt: row.current_period_ends_at, nextChargeAt: row.next_charge_at,
    autoRenew: row.auto_renew === 1, parentInvoiceId: row.parent_invoice_id,
    lastInvoiceId: row.last_invoice_id, lastFailureCode: row.last_failure_code,
    cancellationEventId: row.cancellation_event_id,
  };
}

function addCalendarMonth(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}
