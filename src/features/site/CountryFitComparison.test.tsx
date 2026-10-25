import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateAnnualPayroll } from '../../../shared/taxCalculators';
import {
  CountryFitCurrent,
  CountryFitDonut,
  CountryFitModes,
  payrollParts,
} from './CountryFitComparison';

describe('two independent payroll scenarios', () => {
  it('builds labelled chart parts from actual payroll amounts without FX', () => {
    // 140 000 € carries Germany's solidarity surcharge: it is part of «Налог», the parts still sum to gross.
    const payroll = calculateAnnualPayroll('DE', 140000);
    const parts = payrollParts(payroll);
    expect(parts.reduce((sum, part) => sum + part.amount, 0)).toBeCloseTo(
      payroll.grossAnnualIncome,
      2,
    );
    expect(parts.reduce((sum, part) => sum + part.percent, 0)).toBeCloseTo(100);
    expect(parts[2].amount).toBe(payroll.netAnnualIncome);
    const html = renderToStaticMarkup(<CountryFitDonut payroll={payroll} />);
    expect(html).toContain('Налог');
    expect(html).toContain('Чистый доход');
    expect(html).toContain('stroke-dasharray');
  });
  it('keeps zero-income chart finite and has an accessible textual alternative', () => {
    const payroll = calculateAnnualPayroll('AE', 0);
    expect(payrollParts(payroll).every((part) => part.percent === 0)).toBe(true);
    expect(renderToStaticMarkup(<CountryFitDonut payroll={payroll} />)).toContain('Нет суммы');
  });
  it('separates current-country input and sources and keeps unsupported modes disabled', () => {
    const html = renderToStaticMarkup(
      <>
        <CountryFitCurrent />
        <CountryFitModes />
      </>,
    );
    expect(html).toContain('name="current-country"');
    expect(html).toContain('id="cf-current-income"');
    expect(html).toContain('ym-disable-keys');
    expect(html).toContain('Источники и допущения текущего сценария');
    expect(html).toContain('Валюты не конвертируются');
    expect(html.match(/ disabled=""/gu)).toHaveLength(2);
  });
});
