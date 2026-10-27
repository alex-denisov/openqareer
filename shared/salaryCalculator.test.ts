import { describe, expect, it } from 'vitest';
import {
  calcCatalogHref,
  calculateSalary,
  grossFromNet,
  parseCalcQuery,
} from './salaryCalculator';

describe('salary calculator', () => {
  it('matches the mockup figures for 300 000 RUB', () => {
    const result = calculateSalary('RU', 300000, 'gross');
    expect(result.netMonthly).toBe(259000);
    expect(result.annualTax).toBe(492000);
    expect(result.raisedFrom).toBe('Сентябрь');
    expect(result.months).toHaveLength(12);
    expect(result.months[7].rate).toBe(13);
    expect(result.months[8].rate).toBe(15);
  });

  it('keeps 13 % below the threshold', () => {
    const result = calculateSalary('RU', 150000, 'gross');
    expect(result.netMonthly).toBe(130500);
    expect(result.raisedFrom).toBeUndefined();
  });

  it('inverts net to gross', () => {
    expect(grossFromNet('RU', 130500)).toBe(150000);
    expect(calculateSalary('RU', 259000, 'net').gross).toBe(300000);
  });

  it('computes other countries through the shared tax data', () => {
    const de = calculateSalary('DE', 5000, 'gross');
    expect(de.months).toHaveLength(0);
    expect(de.netMonthly).toBeGreaterThan(3000);
    expect(de.netMonthly).toBeLessThan(3300);
    expect(calculateSalary('AE', 25000, 'gross').netMonthly).toBe(25000);
  });

  it('links the result to the open catalog', () => {
    expect(calcCatalogHref(calculateSalary('RU', 300000, 'gross'))).toBe(
      '/vacancies?salary_from=300000',
    );
    expect(calcCatalogHref(calculateSalary('DE', 5000, 'gross'))).toBe(
      '/vacancies?salary_from=5000&country=DE',
    );
  });

  it('parses only valid query values', () => {
    expect(parseCalcQuery('?country=DE&amount=4000&mode=net')).toEqual({
      country: 'DE',
      amount: 4000,
      mode: 'net',
    });
    expect(parseCalcQuery('?country=XX&amount=-1&mode=z')).toEqual({});
  });
});
