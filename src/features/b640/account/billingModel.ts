import type {
  CandidateBillingPlanId,
  CandidateBillingReceipt,
  CandidateBillingSummary,
  CandidateCurrentPlanId,
} from '../../shell/candidateBillingApi';
import { buildNodePath } from '../routes';

/** Тариф в сетке макета T1. Квоты — месячные, утверждены 28.10 (B437, B579). */
export interface TariffTier {
  readonly id: CandidateCurrentPlanId;
  readonly name: string;
  /** Одна строка под названием. */
  readonly line: string;
  readonly applications: string;
  readonly coachTurns: string;
  /** `null` — в тариф не входит. */
  readonly interviews: string | null;
  readonly posts: string | null;
}

export const TARIFF_TIERS: readonly TariffTier[] = [
  { id: 'free', name: 'Free', line: 'Начало поиска без оплаты', applications: '20', coachTurns: '30', interviews: null, posts: null },
  { id: 'basic', name: 'Basic', line: 'Больше писем под вакансии и пробные интервью', applications: '100', coachTurns: '300', interviews: '10', posts: null },
  { id: 'pro', name: 'Pro', line: 'Отправляет одобренные вами отклики сам', applications: '500 · часть — автоотклики', coachTurns: '1\u00a0000', interviews: '30', posts: '90' },
  { id: 'max', name: 'Max', line: 'Для активного поиска сразу в нескольких ролях', applications: '2\u00a0000 · часть — автоотклики', coachTurns: '3\u00a0000', interviews: '100', posts: '210' },
];

/** Что входит в каждый тариф, начиная с Free (в макете — галочки). */
export const TARIFF_INCLUDED: readonly string[] = [
  'Вакансии',
  'Процент совпадения',
  'Резюме под вакансию',
  'Вопросы к интервью',
  'Подготовка ответов',
];

const MONTHLY_APPLICATIONS: Readonly<Record<CandidateCurrentPlanId, number>> = {
  free: 20,
  basic: 100,
  pro: 500,
  max: 2000,
};

export function tierOf(id: CandidateCurrentPlanId): TariffTier {
  return TARIFF_TIERS.find((tier) => tier.id === id) ?? TARIFF_TIERS[0];
}

export function isPaidPlan(value: string | null): value is CandidateBillingPlanId {
  return value === 'basic' || value === 'pro' || value === 'max';
}

const NUMBER = new Intl.NumberFormat('ru-RU');
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

export function rubles(kopecks: number): string {
  return `${NUMBER.format(Math.round(kopecks / 100))} ₽`;
}

function day(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY_MONTH.format(date);
}

/** Цена тарифа из ответа сервера; `null` — сервер её не отдал. */
export function planPrice(summary: CandidateBillingSummary, id: CandidateCurrentPlanId): string | null {
  if (id === 'free') return rubles(0);
  const plan = summary.plans.find((item) => item.id === id);
  return plan ? rubles(plan.amountKopecks) : null;
}

function applicationsLine(id: CandidateCurrentPlanId): string {
  return `${NUMBER.format(MONTHLY_APPLICATIONS[id])} откликов в месяц`;
}

/** Подпись под названием тарифа в «Подписке». */
export function subscriptionLine(summary: CandidateBillingSummary): string {
  const { currentPlan, subscription } = summary;
  const price = planPrice(summary, currentPlan);
  if (currentPlan === 'free') return applicationsLine(currentPlan);
  // Платный тариф без подписки подключён вручную: строка говорит, откуда он.
  if (!subscription) return `${applicationsLine(currentPlan)} · подключён без оплаты`;
  if (!price) return applicationsLine(currentPlan);
  const until = day(subscription.currentPeriodEndsAt);
  return until ? `${price} в месяц · до ${until}` : `${price} в месяц`;
}

/** Подпись под «Автопродлением»: следующее списание или срок действия тарифа. */
export function renewalLine(summary: CandidateBillingSummary): string | null {
  const { subscription, currentPlan } = summary;
  if (!subscription) return null;
  const next = subscription.autoRenew ? day(subscription.nextChargeAt) : null;
  if (next) return `Следующее списание ${next}`;
  const until = day(subscription.currentPeriodEndsAt);
  return until ? `${tierOf(currentPlan).name} действует до ${until}` : null;
}

export function receiptLine(
  receipt: Pick<CandidateBillingReceipt, 'planId' | 'amountKopecks' | 'paidAt'>,
): { title: string; value: string } {
  const paid = day(receipt.paidAt);
  const amount = rubles(receipt.amountKopecks);
  return { title: tierOf(receipt.planId).name, value: paid ? `${paid} · ${amount}` : amount };
}

/** Строки «Перейти к оплате» (макет T3b): тариф, сумма, период. */
export function checkoutLines(
  summary: CandidateBillingSummary,
  planId: CandidateBillingPlanId,
): ReadonlyArray<readonly [string, string]> {
  return [
    ['Тариф', `${tierOf(planId).name} · ${applicationsLine(planId)}`],
    ['Сумма', planPrice(summary, planId) ?? ''],
    ['Период', '30 дней от даты оплаты'],
  ];
}

export const PAY_PARAM = 'pay';

/** Адрес подтверждения перед оплатой: деньги списываются только после него, на странице банка. */
export function payUrl(planId: CandidateBillingPlanId): string {
  return `${buildNodePath('t03')}?${PAY_PARAM}=${planId}`;
}

const PAYMENT_HOST = 'auth.robokassa.ru';

/** Ссылка на платёжную страницу из ответа сервера: только известный адрес по https. */
export function safePaymentUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const known = url.protocol === 'https:' && url.hostname === PAYMENT_HOST;
    return known && url.port === '' && url.username === '' && url.password === '' ? url.href : null;
  } catch {
    return null;
  }
}
