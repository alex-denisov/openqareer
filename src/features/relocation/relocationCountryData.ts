import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { evaluateCountryFit, getCountryMobilityData } from '../../../shared/countryFit';
import type { MobilityCandidateProfile, MobilityScenarioEvaluation } from '../../../shared/countryFit/types';
import { calculateAnnualIncomeTax, calculateAnnualPayroll, calculateDisposableIncome } from '../../../shared/taxCalculators';
import { getCountryTaxData, supportedCountryCodes } from '../../../shared/taxData';
import type { CountryComparisonCountry, ComparisonEvidence, CountryComparisonFact } from '../../../shared/countryFit/countryComparison';
import type { TaxDataSource } from '../../../shared/taxData/types';

const RELOCATION_COUNTRY_CODES = [
  'AE', 'AM', 'BY', 'CA', 'CY', 'DE', 'ES', 'GB', 'GE', 'KG', 'KZ', 'PT', 'RS', 'RU', 'SG', 'TR', 'US',
] as const;

export interface RelocationCountry {
  readonly countryCode: (typeof RELOCATION_COUNTRY_CODES)[number];
  readonly name: string;
  readonly mobility: ReturnType<typeof getCountryMobilityData>;
  readonly taxSupported: boolean;
}

export type RelocationEconomy =
  | {
      readonly status: 'available';
      readonly payroll: ReturnType<typeof calculateAnnualPayroll>;
      readonly disposableIncome: ReturnType<typeof calculateDisposableIncome>;
    }
  | { readonly status: 'unsupported' | 'invalid_input'; readonly reason: string };

/** Country names and rule coverage come from the B385 mobility catalog. */
export function listRelocationCountries(): readonly RelocationCountry[] {
  return RELOCATION_COUNTRY_CODES.map((countryCode) => {
    const mobility = getCountryMobilityData(countryCode);
    return {
      countryCode,
      name: mobility.name,
      mobility,
      taxSupported: supportedCountryCodes.some((supportedCode) => supportedCode === countryCode),
    };
  });
}

/** Map only facts stored in B467; unavailable inputs stay absent for Country Fit. */
export function mobilityCandidateFromQuestionnaire(
  profile: RelocationQuestionnaire | null,
): MobilityCandidateProfile {
  if (!profile) return {};

  const candidate: {
    citizenshipCountryCodes: readonly string[];
    recognizedDegreeCountryCodes?: readonly string[];
    completedFormalQualification?: boolean;
    family?: { readonly hasPartner: boolean; readonly children: number };
  } = {
    citizenshipCountryCodes: profile.citizenshipDocuments.citizenshipCountryCodes,
  };
  const education = profile.education.education;
  const recognizedDegreeCountryCodes = education
    .filter(({ recognitionStatus }) => recognitionStatus === 'recognized')
    .map(({ countryCode }) => countryCode);
  if (recognizedDegreeCountryCodes.length) {
    candidate.recognizedDegreeCountryCodes = recognizedDegreeCountryCodes;
  }
  if (education.some(({ completedAt }) => completedAt)) {
    candidate.completedFormalQualification = true;
  }

  const family = profile.family;
  if (
    family.childrenCount !== undefined &&
    (family.partnerStatus === 'has_partner' || family.partnerStatus === 'no_partner')
  ) {
    candidate.family = {
      hasPartner: family.partnerStatus === 'has_partner',
      children: family.childrenCount,
    };
  }
  return candidate;
}

export function countryFitForQuestionnaire(
  countryCode: string,
  profile: RelocationQuestionnaire | null,
) {
  return evaluateCountryFit(countryCode, mobilityCandidateFromQuestionnaire(profile));
}

export function calculateRelocationEconomy(
  countryCode: string,
  grossAnnualIncome: number,
): RelocationEconomy {
  if (!supportedCountryCodes.some((supportedCode) => supportedCode === countryCode)) {
    return {
      status: 'unsupported',
      reason: 'Для этой страны нет проверенной налоговой шкалы в расчётном модуле.',
    };
  }
  try {
    const payroll = calculateAnnualPayroll(countryCode, grossAnnualIncome);
    return {
      status: 'available',
      payroll,
      disposableIncome: calculateDisposableIncome(payroll, null, null),
    };
  } catch {
    return {
      status: 'invalid_input',
      reason: 'Укажите годовую зарплату числом от нуля.',
    };
  }
}

export function buildCountryComparisonCountry(
  countryCode: string,
  profile: RelocationQuestionnaire | null,
  grossAnnualIncome?: number,
): CountryComparisonCountry {
  const fit = countryFitForQuestionnaire(countryCode, profile);
  const country = getCountryMobilityData(countryCode);
  const hasTax = supportedCountryCodes.some((supportedCode) => supportedCode === countryCode);
  const taxData = hasTax ? getCountryTaxData(countryCode) : null;
  const taxFacts = buildTaxComparisonFacts(countryCode, grossAnnualIncome, taxData);
  const candidateSource = profileEvidence(profile);

  return {
    countryCode: country.countryCode,
    countryName: country.name,
    facts: {
      access: accessFact(fit.status, fit.scenarios, candidateSource),
      processingTime: noData('В правилах по выбранному сценарию нет подтверждённого срока оформления.'),
      relocationVacancies: noData('Подбор вакансий по этой стране не содержит полной датированной выборки.'),
      salaryThreshold: salaryThresholdFact(fit.scenarios),
      incomeTax: taxFacts.incomeTax,
      netIncome: taxFacts.netIncome,
      monthlyRemainder: noData(
        taxData?.costOfLiving.unavailableReason ?? 'Нет проверенных данных об аренде и страховании для этой страны.',
      ),
      workingLanguage: noData('В источниках по этой стране нет подтверждённых данных о языке работы.'),
      familyAndResidence: noData('В источниках нет сопоставимых сведений о переезде семьи и дальнейшем проживании.'),
    },
  };
}

type TaxComparisonFacts = Pick<CountryComparisonCountry['facts'], 'incomeTax' | 'netIncome'>;

function buildTaxComparisonFacts(
  countryCode: string,
  grossAnnualIncome: number | undefined,
  taxData: ReturnType<typeof getCountryTaxData> | null,
): TaxComparisonFacts {
  const annualIncome = grossAnnualIncome !== undefined && Number.isFinite(grossAnnualIncome) && grossAnnualIncome > 0
    ? grossAnnualIncome
    : undefined;
  if (!taxData || annualIncome === undefined) return unavailableTaxFacts(taxData !== null);
  const incomeTax = calculateAnnualIncomeTax(countryCode, annualIncome);
  const payroll = calculateAnnualPayroll(countryCode, annualIncome);
  return {
    incomeTax: {
      status: 'available',
      value: {
        effectiveRate: Number((incomeTax.amount / annualIncome * 100).toFixed(2)),
        basis: `Налог с указанной годовой зарплаты ${formatMoney(annualIncome, incomeTax.currency)}.`,
      },
      sources: [comparisonEvidence(incomeTax.source)],
    },
    netIncome: {
      status: 'available',
      value: {
        amount: payroll.netMonthlyIncome,
        currency: payroll.currency,
        basis: `В месяц после налогов и удержаний при зарплате ${formatMoney(annualIncome, payroll.currency)} в год.`,
      },
      sources: payrollSources(payroll.incomeTax.source, payroll.employeeContributions.items.map(({ source }) => source)),
    },
  };
}

function unavailableTaxFacts(hasTaxScale: boolean): TaxComparisonFacts {
  const taxReason = hasTaxScale
    ? 'Укажите годовую зарплату для расчёта налога.'
    : 'Для этой страны нет проверенной налоговой шкалы.';
  const netReason = hasTaxScale
    ? 'Укажите годовую зарплату для расчёта остатка после налогов.'
    : taxReason;
  return { incomeTax: noData(taxReason), netIncome: noData(netReason) };
}

function accessFact(
  status: ReturnType<typeof evaluateCountryFit>['status'],
  scenarios: readonly MobilityScenarioEvaluation[],
  candidateSources: readonly ComparisonEvidence[],
): CountryComparisonFact<CountryComparisonCountry['facts']['access'] extends CountryComparisonFact<infer T> ? T : never> {
  if (status === 'unknown') {
    const reason = scenarios.flatMap(({ reasons }) => reasons)[0] ??
      'В анкете недостаточно подтверждённых сведений для проверки доступа.';
    return { status: 'unknown', reason };
  }
  const sources = uniqueEvidence([
    ...scenarios.flatMap(({ sources: items }) => items.map(comparisonEvidence)),
    ...candidateSources,
  ]);
  if (!sources.length) return { status: 'unknown', reason: 'Для этого статуса нет источника или факта анкеты.' };
  return {
    status: 'available',
    value: { label: accessLabel(status), status },
    sources,
  };
}

function salaryThresholdFact(
  scenarios: readonly MobilityScenarioEvaluation[],
): CountryComparisonCountry['facts']['salaryThreshold'] {
  const threshold = scenarios.flatMap(({ thresholds }) => thresholds).find(({ requirement }) =>
    requirement === 'minimum_annual_salary' || requirement === 'minimum_monthly_funds',
  );
  if (!threshold) return noData('Для выбранной страны нет подтверждённого порога зарплаты.');
  return {
    status: 'available',
    value: {
      amount: threshold.amount,
      currency: threshold.currency ?? '',
      basis: `${threshold.label}, ${threshold.period}`,
    },
    sources: [comparisonEvidence(threshold.source)],
  };
}

function profileEvidence(profile: RelocationQuestionnaire | null): ComparisonEvidence[] {
  if (!profile?.updatedAt) return [];
  return [{
    kind: 'candidate_profile',
    title: 'Анкета кандидата',
    capturedAt: profile.updatedAt.slice(0, 10),
  }];
}

function comparisonEvidence(source: TaxDataSource): ComparisonEvidence {
  return {
    kind: 'official',
    title: source.title,
    url: source.url,
    dataYear: source.dataYear,
    capturedAt: source.retrievedAt,
  };
}

function payrollSources(
  incomeTaxSource: TaxDataSource,
  contributionSources: readonly TaxDataSource[],
): ComparisonEvidence[] {
  return uniqueEvidence([incomeTaxSource, ...contributionSources].map(comparisonEvidence));
}

function uniqueEvidence(sources: readonly ComparisonEvidence[]): ComparisonEvidence[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url ?? `${source.kind}:${source.title}:${source.capturedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function noData<T = never>(reason: string): CountryComparisonFact<T> {
  return { status: 'no_data', reason };
}

function accessLabel(status: ReturnType<typeof evaluateCountryFit>['status']): string {
  if (status === 'available') return 'Доступно по подтверждённым данным';
  if (status === 'high_barriers') return 'Есть условия';
  return 'Юридически недоступно';
}

function formatMoney(amount: number, currency: string): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount)} ${currency}`;
}
