import type { RenewalReminderSenderInput } from './renewalRunner';
import type { ServerConfig } from '../config';
import { isValidTimezone } from '../../shared/timezoneUtils';

const PLAN_NAMES = { basic: 'Basic', pro: 'Pro', max: 'Max' } as const;

export async function sendBillingRenewalReminder(
  emailConfig: NonNullable<ServerConfig['accountEmail']>,
  reminder: RenewalReminderSenderInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: isValidTimezone(reminder.timezone) ? reminder.timezone! : 'UTC',
  });
  const chargeAt = formatter.format(new Date(reminder.periodEnd));
  const amount = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(reminder.amountKopecks / 100);
  const plan = PLAN_NAMES[reminder.planId];
  const text = [
    'Здравствуйте.',
    '',
    `Списание за тариф ${plan} запланировано на ${chargeAt}. Сумма — ${amount}.`,
    'Автопродление можно отключить в OpenQareer в разделе «Тарифы». При отмене доступ останется до конца оплаченного периода.',
  ].join('\n');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${emailConfig.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: emailConfig.from,
      to: [reminder.email],
      subject: `Списание за тариф ${plan} ${chargeAt}`,
      text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('billing_reminder_delivery_failed');
}
