export const MIGRATION_BILLING = `
CREATE TABLE billing_invoices (
  invoice_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('basic', 'pro', 'max')),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  auto_renew_opt_in INTEGER NOT NULL CHECK (auto_renew_opt_in IN (0, 1)),
  payment_url TEXT,
  payment_method TEXT,
  test_mode INTEGER NOT NULL CHECK (test_mode IN (0, 1)),
  recurring_parent_invoice_id INTEGER,
  renewal_period_end TEXT,
  receipt_url TEXT,
  receipt_status TEXT,
  fiscal_document_number TEXT,
  fiscal_date TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key),
  UNIQUE (invoice_id, renewal_period_end)
) STRICT;

CREATE INDEX billing_invoices_user_created
  ON billing_invoices(user_id, created_at DESC, invoice_id DESC);
CREATE INDEX billing_invoices_pending
  ON billing_invoices(status, created_at);

CREATE TABLE billing_subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('basic', 'pro', 'max')),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'expired')),
  current_period_started_at TEXT NOT NULL,
  current_period_ends_at TEXT NOT NULL,
  next_charge_at TEXT,
  auto_renew INTEGER NOT NULL CHECK (auto_renew IN (0, 1)),
  parent_invoice_id INTEGER NOT NULL REFERENCES billing_invoices(invoice_id),
  last_invoice_id INTEGER NOT NULL REFERENCES billing_invoices(invoice_id),
  last_failure_code TEXT,
  cancellation_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX billing_subscriptions_due
  ON billing_subscriptions(status, auto_renew, next_charge_at);

CREATE TABLE billing_reminders (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  lease_until TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, period_end)
) STRICT;

CREATE TABLE billing_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'subscription.auto_renew_disabled', 'payment.confirmed', 'renewal.initiated',
    'renewal.rejected', 'renewal.outcome_unknown'
  )),
  invoice_id INTEGER REFERENCES billing_invoices(invoice_id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL,
  detail_code TEXT
) STRICT;

CREATE INDEX billing_events_user_occurred
  ON billing_events(user_id, occurred_at DESC, event_id DESC);

CREATE TRIGGER billing_events_immutable_update
BEFORE UPDATE ON billing_events
WHEN NEW.event_id != OLD.event_id
  OR NEW.event_type != OLD.event_type
  OR NEW.occurred_at != OLD.occurred_at
  OR NEW.detail_code IS NOT OLD.detail_code
  OR (NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id)
  OR (NEW.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NOT OLD.actor_user_id)
  OR (NEW.invoice_id IS NOT NULL AND NEW.invoice_id IS NOT OLD.invoice_id)
BEGIN
  SELECT RAISE(ABORT, 'billing_events_are_immutable');
END;

CREATE TRIGGER billing_events_immutable_delete
BEFORE DELETE ON billing_events
BEGIN
  SELECT RAISE(ABORT, 'billing_events_are_immutable');
END;
`;
