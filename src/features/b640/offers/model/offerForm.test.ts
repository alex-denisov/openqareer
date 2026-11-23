import { describe, expect, it } from 'vitest';
import {
  emptyOfferForm,
  formFromCard,
  parseOfferForm,
  previewTerms,
  typedOfferValue,
  leftFieldError,
  type OfferForm,
} from './offerForm';
import type { OfferCard } from './offerModel';

const vector: OfferCard = {
  applicationId: 'a1',
  company: 'Вектор Банк',
  title: 'Руководитель разработки',
  terms: {
    baseSalary: 520_000,
    salaryPeriod: 'month',
    currency: 'RUB',
    bonus: 520_000,
    format: 'hybrid',
    probationPeriodMonths: 3,
    probationSalary: 500_000,
    benefits: ['ДМС со стоматологией', 'оплата спорта'],
    risks: ['Премия не гарантирована'],
    sourceNote: 'с ваших слов',
  },
  respondBy: '2026-11-14',
  view: {
    applicationId: 'a1',
    gross: { amount: 520_000, period: 'month', currency: 'RUB' },
    taxPercent: 13,
    net: 452_400,
    respondBy: '2026-11-14',
    daysLeft: 4,
    deadline: 'later',
    decision: null,
    decidedAt: null,
  },
};

function form(overrides: Partial<OfferForm>): OfferForm {
  return { ...emptyOfferForm(), ...overrides };
}

describe('formFromCard', () => {
  it('fills the fields the way the mockup shows them', () => {
    expect(formFromCard(vector)).toMatchObject({
      base: '520 000',
      period: 'month',
      currency: 'RUB',
      bonus: '520 000',
      format: 'hybrid',
      respondBy: '14.11.2026',
      probationMonths: '3',
      probationSalary: '500 000',
      tax: '13',
      benefits: 'ДМС со стоматологией, оплата спорта',
      risks: 'Премия не гарантирована',
      source: 'с ваших слов',
    });
  });

  it('turns a typed format into its list option, so the list shows no extra «гибрид» (B645 o06a)', () => {
    const typed = (format: string) =>
      formFromCard({ ...vector, terms: { ...vector.terms, format } });
    expect(typed('гибрид').format).toBe('hybrid');
    expect(typed(' Удалённо ').format).toBe('remote');
    expect(typed('в офисе').format).toBe('office');
    expect(typed('Гибрид, 2 дня в офисе').format).toBe('Гибрид, 2 дня в офисе');
  });
});

describe('parseOfferForm', () => {
  it('turns the form back into the stored terms', () => {
    const parsed = parseOfferForm(formFromCard(vector), false);
    expect(parsed).toEqual({
      ok: true,
      company: '',
      title: '',
      respondBy: '2026-11-14',
      tax: 13,
      terms: vector.terms,
    });
  });

  it('leaves empty fields out instead of storing zeros', () => {
    const parsed = parseOfferForm(form({ base: '300000' }), false);
    expect(parsed).toMatchObject({
      ok: true,
      respondBy: null,
      tax: null,
      terms: { baseSalary: 300_000 },
    });
    expect(parsed.ok && 'bonus' in parsed.terms).toBe(false);
  });

  it('points at each wrong field and keeps the rest', () => {
    const parsed = parseOfferForm(
      form({ base: '52о000', respondBy: '31.02.2026', tax: '70' }),
      false,
    );
    expect(parsed).toEqual({
      ok: false,
      errors: {
        base: 'Введите число',
        respondBy: 'Дата в виде дд.мм.гггг',
        tax: 'Налог от 0 до 60 %',
      },
    });
  });

  it('asks for the company and the role of a new offer', () => {
    expect(parseOfferForm(form({}), true)).toEqual({
      ok: false,
      errors: { company: 'Укажите компанию', title: 'Укажите должность' },
    });
    expect(
      parseOfferForm(form({ company: ' Гринкод ', title: 'Head of Engineering' }), true),
    ).toMatchObject({
      ok: true,
      company: 'Гринкод',
      title: 'Head of Engineering',
    });
  });
});

describe('previewTerms', () => {
  it('counts what is valid while a field is being fixed', () => {
    expect(previewTerms(form({ base: '520 000', bonus: '5о' }))).toEqual({
      baseSalary: 520_000,
      salaryPeriod: 'month',
      currency: 'RUB',
    });
  });
});

describe('typedOfferValue (B733)', () => {
  it('«Срок ответа» набирается как общее поле даты: точки ставятся сами', () => {
    expect(typedOfferValue('respondBy', '25122026')).toBe('25.12.2026');
    expect(typedOfferValue('respondBy', '2512')).toBe('25.12');
  });

  it('остальные поля — как набраны', () => {
    expect(typedOfferValue('base', '250000')).toBe('250000');
  });
});

describe('leftFieldError (B733): ошибка при уходе с поля, как в общем поле даты', () => {
  it('невозможная дата «Срока ответа» — ошибка формата', () => {
    expect(leftFieldError('respondBy', '31.02.2026')).toBe('Дата в виде дд.мм.гггг');
    expect(leftFieldError('respondBy', '25.12')).toBe('Дата в виде дд.мм.гггг');
  });

  it('верная, пустая дата и другие поля — без ошибки', () => {
    expect(leftFieldError('respondBy', '25.12.2026')).toBeUndefined();
    expect(leftFieldError('respondBy', '')).toBeUndefined();
    expect(leftFieldError('base', 'abc')).toBeUndefined();
  });
});
