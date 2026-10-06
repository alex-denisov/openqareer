import { describe, expect, it } from 'vitest';
import {
  calculateOfferCompensation,
  compareOffers,
  type OfferTermsInput,
} from './offerCompensation';

describe('offerCompensation', () => {
  it('calculates total annual compensation from monthly base and bonus using formula', () => {
    const offer: OfferTermsInput = {
      baseSalary: 300_000,
      salaryPeriod: 'month',
      bonus: 600_000,
      currency: 'RUB',
    };

    const breakdown = calculateOfferCompensation(offer);

    expect(breakdown.annualBase).toBe(3_600_000);
    expect(breakdown.annualBonus).toBe(600_000);
    expect(breakdown.totalAnnualCompensation).toBe(4_200_000);
    expect(breakdown.monthlyAverage).toBe(350_000);
    expect(breakdown.sourceLabel).toBe('со слов кандидата');
  });

  it('prorates compensation with probation period salary differences', () => {
    const offer: OfferTermsInput = {
      baseSalary: 300_000,
      salaryPeriod: 'month',
      probationPeriodMonths: 3,
      probationSalary: 250_000,
      bonus: 0,
      currency: 'RUB',
    };

    const breakdown = calculateOfferCompensation(offer);

    // 3 * 250_000 + 9 * 300_000 = 750_000 + 2_700_000 = 3_450_000
    expect(breakdown.annualBase).toBe(3_450_000);
    expect(breakdown.totalAnnualCompensation).toBe(3_450_000);
    expect(breakdown.monthlyAverage).toBe(Math.round(3_450_000 / 12));
    expect(breakdown.hasProbationDiff).toBe(true);
  });

  it('handles annual salary period without multiplying by 12', () => {
    const offer: OfferTermsInput = {
      baseSalary: 120_000,
      salaryPeriod: 'year',
      bonus: 20_000,
      currency: 'USD',
    };

    const breakdown = calculateOfferCompensation(offer);

    expect(breakdown.annualBase).toBe(120_000);
    expect(breakdown.annualBonus).toBe(20_000);
    expect(breakdown.totalAnnualCompensation).toBe(140_000);
    expect(breakdown.monthlyAverage).toBe(Math.round(140_000 / 12));
  });

  it('marks explicit source note when provided, otherwise defaults to "со слов кандидата"', () => {
    const unverified: OfferTermsInput = { baseSalary: 200_000 };
    expect(calculateOfferCompensation(unverified).sourceLabel).toBe('со слов кандидата');

    const documented: OfferTermsInput = {
      baseSalary: 200_000,
      sourceNote: 'из документа оффера',
    };
    expect(calculateOfferCompensation(documented).sourceLabel).toBe('из документа оффера');
  });

  it('compares up to four offers and sorts by total annual compensation', () => {
    const offerA: OfferTermsInput = {
      id: 'offer-1',
      title: 'Старший разработчик',
      company: 'Компания А',
      baseSalary: 300_000,
      bonus: 300_000,
      format: 'remote',
      benefits: ['ДМС', 'Обучение'],
      risks: [],
    };
    const offerB: OfferTermsInput = {
      id: 'offer-2',
      title: 'Тимлид',
      company: 'Компания Б',
      baseSalary: 400_000,
      bonus: 600_000,
      format: 'hybrid',
      benefits: ['ДМС со стоматологией', 'Техника'],
      risks: ['Серая премия'],
    };
    const offerC: OfferTermsInput = {
      id: 'offer-3',
      title: 'Архитектор',
      company: 'Компания В',
      baseSalary: 350_000,
      bonus: 100_000,
      format: 'office',
      benefits: ['ДМС'],
      risks: ['Штрафы за опоздание'],
    };

    const comparison = compareOffers([offerA, offerB, offerC]);

    expect(comparison.offers.length).toBe(3);
    expect(comparison.highestCompensationOfferId).toBe('offer-2');
    expect(comparison.offers[0].offer.id).toBe('offer-2');
    expect(comparison.offers[0].breakdown.totalAnnualCompensation).toBe(5_400_000);
    expect(comparison.offers[1].offer.id).toBe('offer-3');
    expect(comparison.offers[1].breakdown.totalAnnualCompensation).toBe(4_300_000);
    expect(comparison.offers[2].offer.id).toBe('offer-1');
    expect(comparison.offers[2].breakdown.totalAnnualCompensation).toBe(3_900_000);
  });

  it('caps comparison to maximum 4 offers', () => {
    const list: OfferTermsInput[] = [
      { id: '1', baseSalary: 100 },
      { id: '2', baseSalary: 200 },
      { id: '3', baseSalary: 300 },
      { id: '4', baseSalary: 400 },
      { id: '5', baseSalary: 500 },
    ];
    const comparison = compareOffers(list);
    expect(comparison.offers.length).toBe(4);
  });
});
