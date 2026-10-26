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

describe('wave 1 countries: one official reference point each', () => {
  it('United Kingdom: allowance taper and two NI rates', () => {
    // gov.uk «Income Tax rates and allowances» 2026–27; «Rates and thresholds for employers 2026 to 2027».
    const payroll = calculateAnnualPayroll('GB', 60_000);
    expect(payroll.incomeTax.amount).toBe(11_432);
    expect(payroll.employeeContributions.total).toBe(3_210.6);
    expect(calculateAnnualPayroll('GB', 120_000).incomeTax.amount).toBe(39_432);
  });

  it('Kazakhstan: contributions and 30 MRP a month come off the base, 15 % above 8 500 MRP', () => {
    // Tax Code K2500000214 art. 363, 402, 403; budget law Z2500000239 art. 7 (MRP 4 325, MZP 85 000);
    // Social Code art. 249 (10 %, ≤ 50 MZP); OSMS law art. 28 (2 %, ≤ 20 MZP).
    const middle = calculateAnnualPayroll('KZ', 12_000_000);
    expect(middle.employeeContributions.total).toBe(1_440_000);
    expect(middle.incomeTax.amount).toBe(900_300);
    const high = calculateAnnualPayroll('KZ', 60_000_000);
    expect(high.employeeContributions.total).toBe(5_508_000);
    expect(high.incomeTax.amount).toBe(6_102_125);
  });

  it('Armenia: 20 %, funded pension 5 % / 10 % − 25 000, stamp fee by salary band', () => {
    // Tax Code art. 150 (arlis 230455); funded pensions law art. 6 (arlis 224823);
    // minimum wage 75 000 (arlis 172160); stamp fee art. 12 (arlis 230046).
    const middle = calculateAnnualPayroll('AM', 6_000_000);
    expect(middle.incomeTax.amount).toBe(1_200_000);
    expect(middle.employeeContributions.total).toBe(312_000);
    const high = calculateAnnualPayroll('AM', 24_000_000);
    expect(high.employeeContributions.total).toBe(1_230_000);
  });

  it('Türkiye: SGK 15 % off the base, minimum-wage part exempt from tax and stamp duty', () => {
    // GİB «Gelir Vergisi Tarifesi 2026», «Ücret Geliri» 2026 (GVK 23/18, 63); SGK 2026 ceiling 297 270;
    // Damga Vergisi Kanunu (1) tablo IV-1-b binde 7,59 and (2) tablo IV-34.
    const payroll = calculateAnnualPayroll('TR', 1_200_000);
    expect(payroll.taxableAnnualIncome).toBe(1_020_000);
    expect(payroll.incomeTax.amount).toBe(180_018.8);
    expect(payroll.employeeContributions.total).toBe(186_099.63);
    expect(calculateAnnualPayroll('TR', 396_360).incomeTax.amount).toBe(0);
  });

  it('Uzbekistan: a flat 12 % with the pension contribution inside the tax', () => {
    // Tax Code art. 381, 385 (lex.uz 4674893).
    const payroll = calculateAnnualPayroll('UZ', 120_000_000);
    expect(payroll.incomeTax.amount).toBe(14_400_000);
    expect(payroll.employeeContributions.total).toBe(0);
  });

  it('Belarus: 13 %, 25 % above 350 000 BYN, 1 % pension contribution', () => {
    // Tax Code (special part) art. 214, 209 (pravo.by hk0900071); FSZN contributions law art. 5.
    expect(calculateAnnualPayroll('BY', 120_000).incomeTax.amount).toBe(15_600);
    const high = calculateAnnualPayroll('BY', 500_000);
    expect(high.incomeTax.amount).toBe(83_000);
    // FSZN ceiling: five average wages, 5 × 3 135,9 BYN (Belstat, August 2026, via BelTA).
    expect(high.employeeContributions.total).toBe(1_881.54);
  });

  it('Montenegro: 0 / 9 / 15 % monthly bands on gross pay, 10 % + 0,5 % contributions', () => {
    // Sl. list CG 160/2025 (ZPDFL čl. 10, from 01.01.2026); 94/2024 (PIO 10 %); 2025 PIO ceiling 75 453 €.
    const payroll = calculateAnnualPayroll('ME', 24_000);
    expect(payroll.incomeTax.amount).toBe(2_124);
    // Podgorica prirez: 15 % of the tax (Sl. list CG — opštinski propisi 31/2019).
    expect(payroll.solidaritySurcharge).toBe(318.6);
    expect(payroll.employeeContributions.total).toBe(2_520);
    expect(calculateAnnualPayroll('ME', 120_000).employeeContributions.total).toBe(8_145.3);
  });
});
