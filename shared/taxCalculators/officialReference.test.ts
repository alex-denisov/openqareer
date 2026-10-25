import { describe, expect, it } from 'vitest';
import { calculateAnnualPayroll } from './index';

/**
 * Germany, tax class I, no church tax, statutory health insurance with the average 2.9 % top-up,
 * childless. Reference: BMF external interface, PAP 2026
 * https://www.bmf-steuerrechner.de/interface/2026Version1.xhtml?code=LSt2026ext&LZZ=1&STKL=1&KVZ=2.90&PVZ=1&PKV=0&KRV=0&ALV=0&af=0&PVS=0&R=0&RE4=<gross in cents>
 * (LSTLZZ, SOLZLZZ; retrieved 2026-10-25).
 */
describe('Germany payroll matches the BMF calculator', () => {
  it.each([
    [15_000, 0, 0],
    [18_000, 111, 0],
    [25_000, 1_251, 0],
    [60_000, 9_389, 0],
    [100_000, 23_248, 344.86],
    [140_000, 39_993, 2_199.61],
  ] as const)('gross %s € → wage tax %s €, solidarity surcharge %s €', (gross, wageTax, soli) => {
    const payroll = calculateAnnualPayroll('DE', gross);
    expect(payroll.incomeTax.amount).toBe(wageTax);
    expect(payroll.solidaritySurcharge).toBe(soli);
  });

  it('keeps taxes and contributions at 140 000 € between 42 and 44 %', () => {
    const payroll = calculateAnnualPayroll('DE', 140_000);
    expect(payroll.employeeContributions.total).toBe(18_525.53);
    expect(payroll.netAnnualIncome).toBe(79_281.86);
    expect(1 - payroll.netAnnualIncome / 140_000).toBeCloseTo(0.4337, 4);
    expect(payroll.assumptionSummary).toBe(
      'I налоговый класс, без церковного налога, государственная медстраховка со средней надбавкой 2,9%, без детей',
    );
  });

  it('drops the childless care surcharge when the scenario has children', () => {
    const payroll = calculateAnnualPayroll('DE', 140_000, { germanyChildless: false });
    expect(payroll.employeeContributions.total).toBe(18_107.03);
    expect(payroll.assumptionSummary).toMatch(/есть дети$/);
  });
});

describe('one official reference point per country', () => {
  it('Cyprus deducts social insurance from the base before the 2026 bands', () => {
    // Bands: gov.cy/mof-tax «Φορολογικές Κλίμακες Από Φορολογικό Έτος 2026» (cumulative 13 500 € at 72 000 €).
    // Deduction: Οδηγός Συμπλήρωσης Δήλωσης Εισοδήματος Ατόμου 2025, ΜΕΡΟΣ 5 — fund contributions up to 1/5 of income, GeSY excluded.
    const payroll = calculateAnnualPayroll('CY', 100_000);
    expect(payroll.taxableAnnualIncome).toBe(93_936.45);
    expect(payroll.incomeTax.amount).toBe(21_177.76);
  });

  it('Serbia taxes salary above 34 221 RSD a month at 10 %', () => {
    // PURS tax bulletin (April 2026): 10 % tax, 14 % + 5.15 % + 0.75 % employee contributions;
    // Sl. glasnik 109/2025: non-taxable 34 221 RSD; PIO (Sl. glasnik 112/2025): bases 51 297–732 820 RSD.
    const payroll = calculateAnnualPayroll('RS', 2_400_000);
    expect(payroll.incomeTax.amount).toBe(198_934.8);
    expect(payroll.employeeContributions.total).toBe(477_600);
  });

  it('the UAE levies no income tax on individuals', () => {
    // u.ae: «The UAE does not levy income tax on individuals.»
    expect(calculateAnnualPayroll('AE', 600_000).netAnnualIncome).toBe(600_000);
  });

  it('Georgia taxes salary at a flat 20 %', () => {
    // Tax Code of Georgia, Article 81(1), matsne.gov.ge document 1043717.
    expect(calculateAnnualPayroll('GE', 120_000).incomeTax.amount).toBe(24_000);
  });

  it('Russia: the FNS worked example for 3 000 000 ₽', () => {
    // nalog.gov.ru/rn26/news/activities_fts/16653428: 312 000 + 90 000 = 402 000 ₽.
    expect(calculateAnnualPayroll('RU', 3_000_000).incomeTax.amount).toBe(402_000);
  });
});
