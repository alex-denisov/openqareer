import { describe, expect, it } from 'vitest';
import {
  emptyOfferForm,
  formFromCard,
  parseOfferForm,
  previewTerms,
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
