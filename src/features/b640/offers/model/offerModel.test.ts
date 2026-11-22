import { describe, expect, it } from 'vitest';
import type { B640OfferView } from '../../../../../shared/b640Offers';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import { application } from '../../responses/model/testApplication';
import {
  buildOfferCards,
  compareLine,
  conditionRows,
  formatDay,
  formatMoney,
  leadTitle,
  payText,
  type OfferCard,
} from './offerModel';

const RATES: CurrencyRates = { date: '2026-11-10', rubPerUnit: { USD: 90.8, EUR: 98.4 } };

function view(overrides: Partial<B640OfferView> = {}): B640OfferView {
  return {
    applicationId: 'a1',
    gross: { amount: 520_000, period: 'month', currency: 'RUB' },
    taxPercent: 0,
    net: 520_000,
    respondBy: '2026-11-14',
    daysLeft: 4,
    deadline: 'later',
    decision: null,
    decidedAt: null,
    ...overrides,
  };
}

function card(overrides: Partial<OfferCard> = {}): OfferCard {
  return {
    applicationId: 'a1',
    company: 'Вектор Банк',
    title: 'Руководитель разработки',
    terms: { baseSalary: 520_000, salaryPeriod: 'month', currency: 'RUB' },
    respondBy: '2026-11-14',
    view: view(),
    ...overrides,
  };
}

const greencode = card({
  applicationId: 'a2',
  company: 'Гринкод',
  title: 'Head of Engineering',
  terms: { baseSalary: 6_500, salaryPeriod: 'month', currency: 'USD', format: 'remote' },
  respondBy: '2026-11-18',
  view: view({
    applicationId: 'a2',
    gross: { amount: 6_500, period: 'month', currency: 'USD' },
    taxPercent: null,
    net: null,
    respondBy: '2026-11-18',
  }),
});

describe('formatMoney', () => {
  it('writes thousands and millions the way the mockup does', () => {
    expect(formatMoney(520_000, 'RUB')).toBe('520 тыс. ₽');
    expect(formatMoney(6_500, 'USD')).toBe('6,5 тыс. $');
    expect(formatMoney(589_160, 'RUB')).toBe('589 тыс. ₽');
    expect(formatMoney(1_250_000, 'EUR')).toBe('1,25 млн €');
    expect(formatMoney(900, 'RUR')).toBe('900 ₽');
    expect(formatMoney(4_000, 'KZT')).toBe('4 тыс. KZT');
  });
});

describe('buildOfferCards', () => {
  it('joins the offer with its response and orders by the reply deadline', () => {
    const cards = buildOfferCards(
      [
        application({
          id: 'a1',
          vacancy: {
            title: 'Руководитель разработки',
            company: 'Вектор Банк',
            url: '',
            source: 'hh',
          },
        }),
        application({
          id: 'a2',
          vacancy: { title: 'Head of Engineering', company: 'Гринкод', url: '', source: 'other' },
        }),
      ],
      [
        {
          applicationId: 'a2',
          terms: { baseSalary: 6_500 },
          respondBy: '2026-11-18',
          createdAt: '',
          updatedAt: '',
        },
        {
          applicationId: 'a1',
          terms: { baseSalary: 520_000 },
          respondBy: '2026-11-14',
          createdAt: '',
          updatedAt: '',
        },
      ],
      [view({ applicationId: 'a2', respondBy: '2026-11-18' }), view({ applicationId: 'a1' })],
    );
    expect(cards.map((item) => item.company)).toEqual(['Вектор Банк', 'Гринкод']);
    expect(cards[1]).toMatchObject({ title: 'Head of Engineering', terms: { baseSalary: 6_500 } });
  });

  it('keeps an offer whose response is not in the list, without inventing a name', () => {
    const cards = buildOfferCards([], [], [view({ respondBy: null })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ company: 'Компания не указана', title: '', terms: {} });
  });
});

describe('payText', () => {
  it('shows take-home pay as is in its own currency', () => {
    expect(payText(card(), 'RUB', RATES)).toEqual({ text: '520 тыс. ₽', needsTax: false });
  });

  it('converts a foreign gross salary and asks for the tax', () => {
    expect(payText(greencode, 'RUB', RATES)).toEqual({
      text: '6,5 тыс. $ ≈ 590 тыс. ₽ до налога',
      needsTax: true,
    });
    expect(payText(greencode, 'ORIG', RATES).text).toBe('6,5 тыс. $ до налога');
    expect(payText(greencode, 'RUB', null).text).toBe('6,5 тыс. $ до налога');
  });

  it('turns a yearly salary into a month', () => {
    const yearly = card({
      view: view({ gross: { amount: 6_000_000, period: 'year', currency: 'RUB' }, net: 6_000_000 }),
    });
    expect(payText(yearly, 'RUB', RATES).text).toBe('500 тыс. ₽');
  });

  it('says plainly when the salary is not entered', () => {
    const empty = card({
      view: view({ gross: { amount: null, period: null, currency: null }, net: null }),
    });
    expect(payText(empty, 'RUB', RATES)).toEqual({ text: 'не указан', needsTax: false });
  });
});

describe('compareLine', () => {
  it('puts each company with its pay in the chosen currency', () => {
    expect(compareLine([card(), greencode], 'RUB', RATES)).toBe(
      'Вектор Банк 520 тыс. ₽ · Гринкод ≈ 590 тыс. ₽',
    );
  });

  it('with one offer keeps only the pay: the company is already in the title (B645 o06)', () => {
    expect(compareLine([card()], 'RUB', RATES)).toBe('520 тыс. ₽');
    expect(compareLine([greencode], 'RUB', RATES)).toBe('≈ 590 тыс. ₽');
  });
});

describe('formatDay', () => {
  const now = new Date('2026-11-22T10:00:00Z');

  it('writes a typed dd.mm.yyyy date in words, with the year only when it is not this year', () => {
    expect(formatDay('01.02.2027', now)).toBe('1 февраля 2027');
    expect(formatDay('15.12.2026', now)).toBe('15 декабря');
    expect(formatDay('1.2.2027', now)).toBe('1 февраля 2027');
  });

  it('keeps ISO dates as before and other text as it is', () => {
    expect(formatDay('2026-12-01', now)).toBe('1 декабря');
    expect(formatDay('с понедельника', now)).toBe('с понедельника');
    expect(formatDay('31.02.2027', now)).toBe('31.02.2027');
  });
});

describe('conditionRows', () => {
  it('lists the five conditions after the salary, in the mockup order', () => {
    const vector = card({
      terms: {
        baseSalary: 520_000,
        salaryPeriod: 'month',
        bonus: 1_040_000,
        format: 'Гибрид, 2 дня в офисе',
        startDate: '2026-12-01',
        probationPeriodMonths: 3,
      },
    });
    const rows = conditionRows([vector, greencode]);
    expect(rows.map((row) => row.label)).toEqual([
      'Бонус',
      'Формат',
      'Выход',
      'Риски',
      'Ответить до',
    ]);
    expect(rows.map((row) => row.cells[0])).toEqual([
      '2 оклада в год',
      'Гибрид, 2 дня в офисе',
      '1 декабря',
      'Испытательный срок 3 месяца',
      '14 ноября',
    ]);
    expect(rows.map((row) => row.cells[1])).toEqual([
      'не указан',
      'Удалённо',
      'не указан',
      'нет',
      '18 ноября',
    ]);
  });

  it('writes a bonus that is not a whole number of salaries as money', () => {
    const rows = conditionRows([
      card({ terms: { baseSalary: 520_000, bonus: 300_000, risks: ['Премия не гарантирована'] } }),
    ]);
    expect(rows[0].cells[0]).toBe('300 тыс. ₽ в год');
    expect(rows[3].cells[0]).toBe('Премия не гарантирована');
    expect(conditionRows([card({ terms: { bonus: 0 } })])[0].cells[0]).toBe('нет');
  });

  it('writes a typed format the way the list does: «Гибрид», not «гибрид» (B645 o06)', () => {
    const format = (value: string) =>
      conditionRows([card({ terms: { format: value } })]).find((row) => row.label === 'Формат')
        ?.cells[0];
    expect(format('гибрид')).toBe('Гибрид');
    expect(format('гибрид, 2 дня в офисе')).toBe('Гибрид, 2 дня в офисе');
  });
});

describe('leadTitle', () => {
  const floor = { amount: 400_000, currency: 'RUB' };

  it('says both are above the floor, as in the mockup', () => {
    expect(leadTitle([card(), greencode], floor, RATES)).toBe('Оба выше вашей планки');
    expect(leadTitle([card(), greencode, card({ applicationId: 'a3' })], floor, RATES)).toBe(
      'Все 3 выше вашей планки',
    );
    expect(leadTitle([card()], floor, RATES)).toBe('Выше вашей планки');
  });

  it('names the offer below the floor', () => {
    expect(leadTitle([card(), greencode], { amount: 560_000, currency: 'RUB' }, RATES)).toBe(
      'Вектор Банк ниже вашей планки',
    );
  });

  it('without a floor names who pays more', () => {
    expect(leadTitle([card(), greencode], null, RATES)).toBe('Гринкод платит больше');
    expect(leadTitle([card(), greencode], null, null)).toBe('Сравните офферы');
    expect(leadTitle([card()], null, RATES)).toBe('Оффер: Вектор Банк');
  });
});
