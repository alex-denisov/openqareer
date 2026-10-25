/**
 * German wage tax for tax class I, as the BMF Programmablaufplan 2026 computes it:
 * taxable base = gross − Werbungskosten-Pauschbetrag − Sonderausgaben-Pauschbetrag − Vorsorgepauschale,
 * then the § 32a EStG tariff and the solidarity surcharge (SolZG § 3, § 4).
 * Checked against the BMF external interface (bmf-steuerrechner.de, PAP 2026, LZZ=1, STKL=1, KVZ=2.90).
 */

const WERBUNGSKOSTEN_PAUSCHBETRAG = 1_230;
const SONDERAUSGABEN_PAUSCHBETRAG = 36;
const PENSION_CEILING = 101_400;
const HEALTH_CEILING = 69_750;
const PENSION_EMPLOYEE_RATE = 0.093;
const UNEMPLOYMENT_EMPLOYEE_RATE = 0.013;
/** Half of the reduced 14.0 % rate (no sick-pay share) plus half of the average 2.9 % top-up. */
const HEALTH_EMPLOYEE_RATE_FOR_TAX = 0.07 + 0.0145;
const CARE_EMPLOYEE_RATE = 0.018;
const CARE_CHILDLESS_SURCHARGE = 0.006;
/** Health, care and unemployment together count up to this sum unless health and care alone are higher. */
const OTHER_PROVISIONS_CAP = 1_900;
const SOLI_RATE = 0.055;
const SOLI_EXEMPTION_LIMIT = 20_350;
const SOLI_PHASE_IN_RATE = 0.119;

export function calculateGermanIncomeTax(taxableIncome: number): number {
  const income = Math.floor(taxableIncome);
  if (income <= 12_348) return 0;
  if (income <= 17_799) {
    const y = (income - 12_348) / 10_000;
    return Math.floor((914.51 * y + 1_400) * y);
  }
  if (income <= 69_878) {
    const z = (income - 17_799) / 10_000;
    return Math.floor((173.1 * z + 2_397) * z + 1_034.87);
  }
  if (income <= 277_825) return Math.floor(0.42 * income - 11_135.63);
  return Math.floor(0.45 * income - 19_470.38);
}

function vorsorgepauschale(grossAnnualIncome: number, childless: boolean): number {
  const pensionBase = Math.min(grossAnnualIncome, PENSION_CEILING);
  const healthBase = Math.min(grossAnnualIncome, HEALTH_CEILING);
  const careRate = CARE_EMPLOYEE_RATE + (childless ? CARE_CHILDLESS_SURCHARGE : 0);
  const healthAndCare = healthBase * (HEALTH_EMPLOYEE_RATE_FOR_TAX + careRate);
  const withUnemployment = healthAndCare + pensionBase * UNEMPLOYMENT_EMPLOYEE_RATE;
  return (
    pensionBase * PENSION_EMPLOYEE_RATE +
    Math.max(healthAndCare, Math.min(withUnemployment, OTHER_PROVISIONS_CAP))
  );
}

/** Taxable base of an employee in tax class I with no individual allowances on the wage tax card. */
export function germanWageTaxBase(grossAnnualIncome: number, childless: boolean): number {
  const deductions =
    WERBUNGSKOSTEN_PAUSCHBETRAG +
    SONDERAUSGABEN_PAUSCHBETRAG +
    vorsorgepauschale(grossAnnualIncome, childless);
  return Math.max(0, Math.floor(grossAnnualIncome - deductions));
}

/** 5.5 % of the income tax, nothing up to the exemption limit and at most 11.9 % of the excess above it. */
export function germanSolidaritySurcharge(incomeTax: number): number {
  if (incomeTax <= SOLI_EXEMPTION_LIMIT) return 0;
  const surcharge = Math.min(
    incomeTax * SOLI_RATE,
    (incomeTax - SOLI_EXEMPTION_LIMIT) * SOLI_PHASE_IN_RATE,
  );
  return Math.floor(surcharge * 100) / 100;
}
