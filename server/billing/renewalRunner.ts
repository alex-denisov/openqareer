import type { SqliteBillingRepository, BillingSubscription } from './sqliteBillingRepository';
import type { RobokassaGateway } from './robokassaGateway';
import { BILLING_PLANS } from './billingPlans';

export interface RenewalReminderSenderInput {
  readonly email: string;
  readonly timezone: string | null;
  readonly planId: 'basic' | 'pro' | 'max';
  readonly periodEnd: string;
  readonly amountKopecks: number;
}

interface RenewalRunInput {
  repository: SqliteBillingRepository;
  gateway: RobokassaGateway;
  now?: string;
  limit?: number;
  emailVerificationRequired?: boolean;
  sendReminder?: (input: RenewalReminderSenderInput) => Promise<void>;
}

interface RenewalRunReport {
  scanned: number;
  initiated: number;
  failed: number;
  outcomeUnknown: number;
  reconciled: number;
  remindersSent: number;
  reminderFailures: number;
}

export async function runDueBillingRenewals(input: RenewalRunInput): Promise<RenewalRunReport> {
  const now = input.now ?? new Date().toISOString();
  const reminders = input.sendReminder ? await sendDueReminders(input, now) : { sent: 0, failed: 0 };
  const reconciliation = await reconcileProcessingRenewals(input.repository, input.gateway, now, input.limit ?? 100);
  const charges = await startDueRenewals(input, now);
  return {
    ...charges,
    outcomeUnknown: charges.outcomeUnknown + reconciliation.unknown,
    reconciled: reconciliation.reconciled,
    remindersSent: reminders.sent,
    reminderFailures: reminders.failed,
  };
}

async function reconcileProcessingRenewals(
  repository: SqliteBillingRepository,
  gateway: RobokassaGateway,
  now: string,
  limit: number,
): Promise<{ reconciled: number; unknown: number }> {
  const updatedBefore = new Date(Date.parse(now) - 5 * 60_000).toISOString();
  const invoices = repository.listProcessingRenewals(updatedBefore, limit);
  let reconciled = 0;
  let unknown = 0;
  for (const invoice of invoices) {
    try {
      const status = await gateway.getRecurringChargeStatus({
        invoiceId: invoice.invoiceId,
        testMode: invoice.testMode,
      });
      if (status.state === 'paid') {
        if (status.amountKopecks !== invoice.amountKopecks) {
          repository.markRenewalFailed(invoice.invoiceId, 'provider_amount_mismatch', now);
          reconciled += 1;
          continue;
        }
        repository.applySuccessfulInvoice({
          invoiceId: invoice.invoiceId,
          paymentMethod: status.paymentMethod,
          paidAt: now,
        });
        reconciled += 1;
      } else if (status.state === 'failed') {
        repository.markRenewalFailed(invoice.invoiceId, 'provider_charge_failed', now);
        reconciled += 1;
      } else if (status.state === 'unknown') {
        unknown += 1;
        repository.markRenewalStatusChecked(invoice.invoiceId, now);
      } else {
        repository.markRenewalStatusChecked(invoice.invoiceId, now);
      }
    } catch {
      unknown += 1;
      repository.markRenewalStatusChecked(invoice.invoiceId, now);
    }
  }
  return { reconciled, unknown };
}

async function sendDueReminders(
  input: RenewalRunInput,
  now: string,
): Promise<{ sent: number; failed: number }> {
  const reminders = input.repository.claimDueRenewalReminders({
    now,
    dueBefore: new Date(Date.parse(now) + 2 * 24 * 60 * 60 * 1_000).toISOString(),
    limit: input.limit ?? 100,
    emailVerificationRequired: input.emailVerificationRequired ?? false,
  });
  let sent = 0;
  let failed = 0;
  for (const reminder of reminders) {
    const success = await deliverReminder(input, reminder);
    input.repository.finishRenewalReminder({
      userId: reminder.userId,
      periodEnd: reminder.periodEnd,
      success,
      ...(success ? {} : { errorCode: 'delivery_failed' }),
      now: new Date().toISOString(),
    });
    if (success) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

async function deliverReminder(
  input: RenewalRunInput,
  reminder: RenewalReminderSenderInput & { userId: string },
): Promise<boolean> {
  try {
    await input.sendReminder?.(reminder);
    return true;
  } catch {
    return false;
  }
}

async function startDueRenewals(input: RenewalRunInput, now: string): Promise<{
  scanned: number;
  initiated: number;
  failed: number;
  outcomeUnknown: number;
}> {
  const subscriptions = input.repository.listDueSubscriptions(now, input.limit ?? 100);
  let initiated = 0;
  let failed = 0;
  let outcomeUnknown = 0;
  for (const subscription of subscriptions) {
    const outcome = await startOneRenewal(input.repository, input.gateway, subscription, now);
    if (outcome === 'initiated') initiated += 1;
    if (outcome === 'failed') failed += 1;
    if (outcome === 'outcome_unknown') outcomeUnknown += 1;
  }
  return { scanned: subscriptions.length, initiated, failed, outcomeUnknown };
}

async function startOneRenewal(
  repository: SqliteBillingRepository,
  gateway: RobokassaGateway,
  subscription: BillingSubscription,
  now: string,
): Promise<'initiated' | 'failed' | 'outcome_unknown' | 'skipped'> {
  const plan = BILLING_PLANS[subscription.planId];
  const reserved = repository.reserveRenewal({
    userId: subscription.userId,
    planId: subscription.planId,
    amountKopecks: plan.amountKopecks,
    parentInvoiceId: subscription.parentInvoiceId,
    periodEnd: subscription.currentPeriodEndsAt,
    testMode: gateway.testMode,
    now,
  });
  if (reserved.kind !== 'created') return 'skipped';
  try {
    const response = await gateway.createRecurringCharge({
      invoiceId: reserved.invoice.invoiceId,
      previousInvoiceId: subscription.parentInvoiceId,
      userId: subscription.userId,
      planId: subscription.planId,
      amountKopecks: reserved.invoice.amountKopecks,
    });
    if (!response.accepted) {
      repository.markRenewalFailed(
        reserved.invoice.invoiceId, 'provider_rejected', new Date().toISOString(),
      );
      return 'failed';
    }
    if (response.invoiceId !== reserved.invoice.invoiceId) {
      repository.markRenewalProcessing(
        reserved.invoice.invoiceId, 'provider_outcome_unknown', new Date().toISOString(),
      );
      return 'outcome_unknown';
    }
    repository.markRenewalProcessing(
      reserved.invoice.invoiceId, 'provider_operation_created', new Date().toISOString(),
    );
    return 'initiated';
  } catch {
    repository.markRenewalProcessing(
      reserved.invoice.invoiceId, 'provider_outcome_unknown', new Date().toISOString(),
    );
    return 'outcome_unknown';
  }
}
