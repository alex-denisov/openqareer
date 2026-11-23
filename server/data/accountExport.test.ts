import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateStatusRepository } from '../candidate/sqliteCandidateStatusRepository';
import { STATUS_SIGNAL_SCHEMA } from '../candidate/sqliteStatusSignalRepository';
import { SqliteTelegramUsernameStore } from '../notifications/telegramUsernameStore';
import { MIGRATION_40 } from './emailVerificationSchema';
import { forbiddenExportKeys } from './exportForbiddenKeys';
import { SealedText } from './sealedText';
import { MIGRATION_36 } from './searchConsentSchema';
import { B640_OFFER_CHOICES_SCHEMA } from './sqliteB640OfferChoiceRepository';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const AT = '2026-11-23T10:00:00.000Z';
const LATER = '2026-12-23T10:00:00.000Z';
const KEY = Buffer.alloc(32, 4);

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-account-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

function seedBilling(database: DatabaseSync, userId: string, tag: string, invoiceId: number) {
  database.prepare(`INSERT INTO billing_invoices(invoice_id,user_id,plan_id,amount_kopecks,idempotency_key,status,auto_renew_opt_in,
      payment_url,test_mode,receipt_url,created_at,paid_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(invoiceId, userId, 'pro', 99000, `idem-secret-${tag}`, 'paid', 1, `https://pay.provider.test/${tag}`, 0, `https://receipt.test/${tag}`, AT, AT, AT);
  database.prepare(`INSERT INTO billing_events(event_id,user_id,actor_user_id,event_type,invoice_id,occurred_at,detail_code)
    VALUES (?,?,?,?,?,?,?)`).run(`event-${tag}`, userId, userId, 'payment.confirmed', invoiceId, AT, `internal-code-${tag}`);
  database.prepare(`INSERT INTO billing_subscriptions(user_id,plan_id,status,current_period_started_at,current_period_ends_at,next_charge_at,
      auto_renew,parent_invoice_id,last_invoice_id,last_failure_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, 'pro', 'active', AT, AT, AT, 1, invoiceId, invoiceId, `failure-${tag}`, AT, AT);
  database.prepare('INSERT INTO billing_pro_trials VALUES (?,?,?)').run(userId, AT, LATER);
}

function seed(database: DatabaseSync, candidateId: string, tag: string, invoiceId: number) {
  const userId = `user-${tag}`;
  database.prepare(`INSERT INTO users(id,username,role,password_salt,password_hash,candidate_id,is_test,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(userId, `${tag}@example.test`, 'candidate', `salt-${tag}`, `hash-${tag}`, candidateId, 1, AT, AT);
  seedBilling(database, userId, tag, invoiceId);
  database.prepare('INSERT INTO plan_requests VALUES (?,?,?,?,?)').run(`plan-${tag}`, candidateId, 'max', `Заметка ${tag}`, AT);
  database.prepare('INSERT INTO candidate_visits VALUES (?,?,?)').run(candidateId, AT, null);
  database.exec(MIGRATION_40 + MIGRATION_36 + STATUS_SIGNAL_SCHEMA + B640_OFFER_CHOICES_SCHEMA);
  database.prepare(`INSERT INTO account_email_change_requests(candidate_id,user_id,current_email,new_email,code_hash,expires_at,last_sent_at)
    VALUES (?,?,?,?,?,?,?)`).run(candidateId, userId, `${tag}@example.test`, `new-${tag}@example.test`, `code-${tag}`, AT, AT);
  database.prepare('INSERT INTO search_consents VALUES (?,?,?,?)').run(candidateId, 1, 'v1', AT);
  database.prepare('INSERT INTO candidate_status_signal_answers(id,candidate_id,kind,answer,created_at,undo_until) VALUES (?,?,?,?,?,?)')
    .run(`signal-${tag}`, candidateId, 'started_search', 'yes', AT, AT);
  database.prepare('INSERT INTO b640_offer_choices(application_id,candidate_id,decision,decided_at,updated_at) VALUES (?,?,?,?,?)')
    .run(`application-${tag}`, candidateId, 'accepted', AT, AT);
  new SqliteTelegramUsernameStore(database, new SealedText(KEY)).save(candidateId, `tg_${tag}`, AT);
  new SqliteCandidateStatusRepository(database, KEY).record({
    id: `status-${tag}`, candidateId, status: 'job_search', targetProfession: `Профессия ${tag}`, previousStatus: 'looking',
    previousTargetProfession: null, applied: { autoApplyPause: null }, createdAt: AT, revertUntil: AT,
  });
}

describe('B738 · 7: учётная запись и кабинет в выгрузке', () => {
  it('логин, оплаты, подписка, настройки и статусы — без паролей, кодов и ключей провайдера, без чужого', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const database = new DatabaseSync(databasePath);
    seed(database, own.id, 'own', 1);
    seed(database, other.id, 'other', 2);
    database.close();

    const account = store.exportCandidate(own.id).account;
    expect(account.user).toEqual({ username: 'own@example.test', createdAt: AT, updatedAt: AT });
    expect(account.payments.invoices).toEqual([expect.objectContaining({ invoiceId: 1, planId: 'pro', amountKopecks: 99000, status: 'paid', receiptUrl: 'https://receipt.test/own' })]);
    expect(account.payments.events).toEqual([{ eventType: 'payment.confirmed', invoiceId: 1, occurredAt: AT }]);
    expect(account.payments.subscription).toMatchObject({ planId: 'pro', status: 'active', autoRenew: 1 });
    expect(account.payments.proTrial).toEqual({ startedAt: AT, expiresAt: LATER });
    expect(account.payments.planRequests).toEqual([{ planId: 'max', note: 'Заметка own', createdAt: AT }]);
    expect(account.lastVisit).toEqual({ lastVisitedAt: AT, previousVisitedAt: null });
    expect(account.pendingEmailChange).toEqual({ currentEmail: 'own@example.test', newEmail: 'new-own@example.test', expiresAt: AT, lastSentAt: AT });
    expect(account.searchConsent).toEqual({ granted: 1, policyVersion: 'v1', updatedAt: AT });
    expect(account.telegramUsername).toBe('tg_own');
    expect(account.statusChanges).toEqual([expect.objectContaining({ id: 'status-own', status: 'job_search', targetProfession: 'Профессия own' })]);
    expect(account.statusSignalAnswers).toEqual([expect.objectContaining({ kind: 'started_search', answer: 'yes' })]);
    expect(account.offerChoices).toEqual([expect.objectContaining({ applicationId: 'application-own', decision: 'accepted' })]);
    const text = JSON.stringify(account);
    for (const leak of ['salt-own', 'hash-own', 'code-own', 'idem-secret', 'pay.provider.test', 'internal-code', 'failure-own', 'user-own', 'other']) {
      expect(text).not.toContain(leak);
    }
    expect(Object.keys(account.payments.invoices[0]!).sort()).toEqual([
      'amountKopecks', 'autoRenewOptIn', 'createdAt', 'fiscalDate', 'fiscalDocumentNumber', 'invoiceId', 'paidAt',
      'paymentMethod', 'planId', 'receiptStatus', 'receiptUrl', 'renewalPeriodEnd', 'status', 'testMode',
    ]);
    expect(forbiddenExportKeys(account)).toEqual([]);
  });

  it('без учётной записи и таблиц раздел пустой и схема не меняется', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const tables = () => new DatabaseSync(databasePath).prepare("SELECT group_concat(name) AS names FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name)").get();
    const before = tables();
    const account = store.exportCandidate(own.id).account;
    expect(account).toMatchObject({ user: null, payments: { invoices: [], events: [], subscription: null, proTrial: null, planRequests: [] }, telegramUsername: null, statusChanges: [] });
    expect(tables()).toEqual(before);
  });
});
