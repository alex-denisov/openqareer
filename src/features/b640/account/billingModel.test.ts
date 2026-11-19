import { describe, expect, it } from 'vitest';
import type { CandidateBillingSummary } from '../../shell/candidateBillingApi';
import {
  checkoutLines,
  payUrl,
  planPrice,
  receiptLine,
  renewalLine,
  rubles,
  safePaymentUrl,
  subscriptionLine,
  TARIFF_TIERS,
  tierOf,
} from './billingModel';

const plans = [
  { id: 'basic', name: 'Basic', amountKopecks: 399000, currency: 'RUB', interval: 'month' },
  { id: 'pro', name: 'Pro', amountKopecks: 990000, currency: 'RUB', interval: 'month' },
  { id: 'max', name: 'Max', amountKopecks: 3990000, currency: 'RUB', interval: 'month' },
] as const;

function summary(over: Partial<CandidateBillingSummary> = {}): CandidateBillingSummary {
  return {
    currentPlan: 'pro',
    subscription: {
      status: 'active',
      currentPeriodEndsAt: '2026-12-14T12:00:00.000Z',
      nextChargeAt: '2026-12-15T09:00:00.000Z',
      autoRenew: true,
    },
    plans,
    ...over,
  };
}

/** Пробелы тысяч и неразрывные пробелы сравниваются как обычные. */
const n = (value: string | null): string | null => value?.replace(/\s/gu, ' ') ?? null;

describe('тарифы и подписка', () => {
  it('сетка квот утверждена 28.10: Free, Basic, Pro, Max — без суточного Pro и Executive', () => {
    const grid = TARIFF_TIERS.map((tier) => [tier.id, n(tier.applications), n(tier.coachTurns), tier.interviews, tier.posts]);
    expect(grid).toEqual([
      ['free', '20', '30', null, null],
      ['basic', '100', '300', '10', null],
      ['pro', '500 · часть — автоотклики', '1 000', '30', '90'],
      ['max', '2 000 · часть — автоотклики', '3 000', '100', '210'],
    ]);
    expect(tierOf('pro').name).toBe('Pro');
  });

  it('сумма в рублях с неразрывным пробелом тысяч', () => {
    expect(n(rubles(399000))).toBe('3 990 ₽');
    expect(n(rubles(3990000))).toBe('39 900 ₽');
    expect(rubles(0)).toBe('0 ₽');
  });

  it('цена тарифа берётся из ответа сервера; у Free — 0 ₽', () => {
    expect(n(planPrice(summary(), 'basic'))).toBe('3 990 ₽');
    expect(planPrice(summary(), 'free')).toBe('0 ₽');
    expect(planPrice(summary({ plans: [] }), 'max')).toBeNull();
  });

  it('строка подписки: цена и срок; у Free — отклики в месяц', () => {
    expect(n(subscriptionLine(summary()))).toBe('9 900 ₽ в месяц · до 14 декабря');
    expect(subscriptionLine(summary({ currentPlan: 'free', subscription: null }))).toBe(
      '20 откликов в месяц',
    );
    expect(n(subscriptionLine(summary({ currentPlan: 'max', subscription: null })))).toBe(
      '2 000 откликов в месяц · подключён без оплаты',
    );
  });

  it('автопродление: следующее списание или дата, до которой действует тариф', () => {
    expect(n(renewalLine(summary()))).toBe('Следующее списание 15 декабря');
    const off = summary({
      subscription: { status: 'canceled', currentPeriodEndsAt: '2026-12-14T12:00:00.000Z', nextChargeAt: null, autoRenew: false },
    });
    expect(n(renewalLine(off))).toBe('Pro действует до 14 декабря');
  });

  it('строка платежа: тариф, дата и сумма', () => {
    const paid = receiptLine({ planId: 'pro', amountKopecks: 990000, paidAt: '2026-11-15T09:00:00.000Z' });
    expect([paid.title, n(paid.value)]).toEqual(['Pro', '15 ноября · 9 900 ₽']);
    expect(n(receiptLine({ planId: 'basic', amountKopecks: 399000, paidAt: null }).value)).toBe('3 990 ₽');
  });

  it('переход к оплате: тариф, сумма, период', () => {
    expect(checkoutLines(summary(), 'basic').map(([label, value]) => [label, n(value)])).toEqual([
      ['Тариф', 'Basic · 100 откликов в месяц'],
      ['Сумма', '3 990 ₽'],
      ['Период', '30 дней от даты оплаты'],
    ]);
  });

  it('адрес оплаты и ссылка платёжной страницы', () => {
    expect(payUrl('basic')).toBe('/app/account/billing?pay=basic');
    expect(safePaymentUrl('https://auth.robokassa.ru/Merchant/Index?InvoiceID=1')).toBe(
      'https://auth.robokassa.ru/Merchant/Index?InvoiceID=1',
    );
    expect(safePaymentUrl('https://evil.example/pay')).toBeNull();
    expect(safePaymentUrl('https://auth.robokassa.ru@evil.example/pay')).toBeNull();
    expect(safePaymentUrl('https://user@auth.robokassa.ru/pay')).toBeNull();
    expect(safePaymentUrl('https://auth.robokassa.ru:8443/pay')).toBeNull();
    expect(safePaymentUrl('https://pay.auth.robokassa.ru.evil.example/')).toBeNull();
    expect(safePaymentUrl('javascript:alert(1)')).toBeNull();
    expect(safePaymentUrl(null)).toBeNull();
  });
});
