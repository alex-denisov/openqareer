import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { evaluateCountryFit, getCountryMobilityData } from '../../../shared/countryFit';
import type {
  MobilityCandidateProfile,
  MobilityScenarioEvaluation,
} from '../../../shared/countryFit/types';
import { calculateAnnualPayroll, calculateDisposableIncome } from '../../../shared/taxCalculators';
import { getCountryTaxData, supportedCountryCodes } from '../../../shared/taxData';
import type {
  CountryComparisonCountry,
  ComparisonEvidence,
  CountryComparisonFact,
} from '../../../shared/countryFit/countryComparison';
import type { TaxDataSource } from '../../../shared/taxData/types';
import type { PayrollOptions, PayrollResult } from '../../../shared/taxCalculators';
import { localIsoDate } from './relocationDates';
import { relocationStatusLabel } from './relocationStatus';
import { leadingScenario } from './relocationLeadingScenario';
import { countryVacancyFact, type CountryVacancySample } from './relocationCountryVacancies';
import type { CountryMobilityData, MobilityRequirement } from '../../../shared/countryFit/types';

const RELOCATION_COUNTRY_CODES = [
  'AE',
  'AM',
  'BY',
  'CA',
  'CY',
  'DE',
  'ES',
  'GB',
  'GE',
  'KG',
  'KZ',
  'PT',
  'RS',
  'RU',
  'SG',
  'TR',
  'US',
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
    residenceDocuments: MobilityCandidateProfile['residenceDocuments'];
    asOf: string;
    recognizedDegreeCountryCodes?: readonly string[];
    completedFormalQualification?: boolean;
    family?: { readonly hasPartner: boolean; readonly children: number };
  } = {
    citizenshipCountryCodes: profile.citizenshipDocuments.citizenshipCountryCodes,
    residenceDocuments: profile.citizenshipDocuments.documents.map(
      ({ kind, countryCode, expiresAt }) => ({
        kind,
        countryCode,
        ...(expiresAt ? { expiresAt } : {}),
      }),
    ),
    asOf: localIsoDate(),
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

/**
 * The payroll of a saved scenario by today's rules: a scenario saved before a tax fix keeps
 * its input, the calculation screen does not show its stale tax.
 */
export function scenarioPayrollNow(input: {
  readonly countryCode: string;
  readonly incomeMode: string;
  readonly grossAnnualIncome?: number;
  readonly payrollOptions?: PayrollOptions;
}): PayrollResult | undefined {
  if (input.incomeMode !== 'local_employment' || input.grossAnnualIncome === undefined)
    return undefined;
  const economy = calculateRelocationEconomy(input.countryCode, input.grossAnnualIncome);
  if (economy.status !== 'available') return undefined;
  return calculateAnnualPayroll(input.countryCode, input.grossAnnualIncome, input.payrollOptions);
}

/** One line of the calculation's assumptions (tax class, church tax, insurance, children) for «Откуда цифры». */
export function relocationAssumptionSummary(
  countryCode: string,
  income: number | undefined,
  scenarioPayroll?: PayrollResult,
): string | null {
  if (scenarioPayroll) return scenarioPayroll.assumptionSummary;
  if (income === undefined || !countryCode) return null;
  const economy = calculateRelocationEconomy(countryCode, income);
  return economy.status === 'available' ? economy.payroll.assumptionSummary : null;
}

export function buildCountryComparisonCountry(
  countryCode: string,
  profile: RelocationQuestionnaire | null,
  grossAnnualIncome?: number,
  vacancies?: CountryVacancySample | null,
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
      processingTime: noData(
        'В правилах по выбранному сценарию нет подтверждённого срока оформления.',
      ),
      relocationVacancies: countryVacancyFact(vacancies, countryCode),
      salaryThreshold: salaryThresholdFact(fit.scenarios),
      incomeTax: taxFacts.incomeTax,
      netIncome: taxFacts.netIncome,
      monthlyRemainder: noData(
        taxData?.costOfLiving.unavailableReason ??
          'Нет проверенных данных об аренде и страховании для этой страны.',
      ),
      workingLanguage: languageFact(country),
      familyAndResidence: familyFact(country, profile, candidateSource),
    },
  };
}

function countryRequirements(country: CountryMobilityData): readonly MobilityRequirement[] {
  return country.scenarios.flatMap(({ paths }) =>
    paths.flatMap(({ requirements }) => requirements),
  );
}

/** «Язык работы»: the language requirement of the country's own rules, or no row. */
function languageFact(
  country: CountryMobilityData,
): CountryComparisonCountry['facts']['workingLanguage'] {
  const requirement = countryRequirements(country).find(
    (item) => item.kind === 'meets_language_requirements',
  );
  if (!requirement || !('source' in requirement))
    return noData('В правилах страны нет требования к языку.');
  return {
    status: 'available',
    value: { summary: requirement.explanation },
    sources: [comparisonEvidence(requirement.source)],
  };
}

const MOVE_PLAN: Readonly<Record<string, string>> = {
  together: 'переезжаете вместе',
  later: 'семья переедет позже',
};

/** «Семья»: who moves from the questionnaire, plus the country's income uplift for them. */
function familyFact(
  country: CountryMobilityData,
  profile: RelocationQuestionnaire | null,
  candidateSources: readonly ComparisonEvidence[],
): CountryComparisonCountry['facts']['familyAndResidence'] {
  const family = profile?.family;
  if (!family || !candidateSources.length) return noData('В анкете нет сведений о семье.');
  const parts = [
    family.partnerStatus === 'has_partner' ? 'с партнёром' : null,
    family.partnerStatus === 'no_partner' ? 'без партнёра' : null,
    family.childrenCount ? `детей: ${family.childrenCount}` : null,
    MOVE_PLAN[family.familyMovePlan] ?? null,
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) return noData('В анкете нет сведений о семье.');
  const uplift = countryRequirements(country).find(
    (item) => item.kind === 'minimum_remote_income' && (item.partnerUplift || item.childUplift),
  );
  const upliftText =
    uplift?.kind === 'minimum_remote_income'
      ? `; порог дохода растёт${uplift.partnerUplift ? ` на ${formatMoney(uplift.partnerUplift, uplift.currency)} за партнёра` : ''}${uplift.childUplift ? ` и на ${formatMoney(uplift.childUplift, uplift.currency)} за ребёнка` : ''}`
      : '';
  const summary = parts.join(', ');
  return {
    status: 'available',
    value: { summary: `${summary.charAt(0).toUpperCase()}${summary.slice(1)}${upliftText}` },
    sources: uniqueEvidence([
      ...candidateSources,
      ...(uplift && 'source' in uplift ? [comparisonEvidence(uplift.source)] : []),
    ]),
  };
}

type TaxComparisonFacts = Pick<CountryComparisonCountry['facts'], 'incomeTax' | 'netIncome'>;

function buildTaxComparisonFacts(
  countryCode: string,
  grossAnnualIncome: number | undefined,
  taxData: ReturnType<typeof getCountryTaxData> | null,
): TaxComparisonFacts {
  const annualIncome =
    grossAnnualIncome !== undefined && Number.isFinite(grossAnnualIncome) && grossAnnualIncome > 0
      ? grossAnnualIncome
      : undefined;
  if (!taxData || annualIncome === undefined) return unavailableTaxFacts(taxData !== null);
  const payroll = calculateAnnualPayroll(countryCode, annualIncome);
  const incomeTax = payroll.incomeTax.amount + payroll.solidaritySurcharge;
  return {
    incomeTax: {
      status: 'available',
      value: {
        effectiveRate: Number(((incomeTax / annualIncome) * 100).toFixed(2)),
        basis: `Налог с указанной годовой зарплаты ${formatMoney(annualIncome, payroll.currency)} (${payroll.assumptionSummary}).`,
      },
      sources: [comparisonEvidence(payroll.incomeTax.source)],
    },
    netIncome: {
      status: 'available',
      value: {
        amount: payroll.netMonthlyIncome,
        currency: payroll.currency,
        basis: `В месяц после налогов и удержаний при зарплате ${formatMoney(annualIncome, payroll.currency)} в год.`,
      },
      sources: payrollSources(
        payroll.incomeTax.source,
        payroll.employeeContributions.items.map(({ source }) => source),
      ),
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
): CountryComparisonFact<
  CountryComparisonCountry['facts']['access'] extends CountryComparisonFact<infer T> ? T : never
> {
  if (status === 'unknown') {
    const reason =
      leadingScenario(scenarios)?.reasons[0] ??
      'В анкете недостаточно подтверждённых сведений для проверки доступа.';
    return { status: 'unknown', reason };
  }
  const sources = uniqueEvidence([
    ...scenarios.flatMap(({ sources: items }) => items.map(comparisonEvidence)),
    ...candidateSources,
  ]);
  if (!sources.length)
    return { status: 'unknown', reason: 'Для этого статуса нет источника или факта анкеты.' };
  return {
    status: 'available',
    value: { label: accessLabel(status), status },
    sources,
  };
}

const THRESHOLD_PERIOD_LABELS: Readonly<Record<string, string>> = {
  annual: 'в год',
  monthly: 'в месяц',
  quarterly: 'в квартал',
  one_time: 'на счёте',
  points: 'баллов',
  years: 'лет',
};

function salaryThresholdFact(
  scenarios: readonly MobilityScenarioEvaluation[],
): CountryComparisonCountry['facts']['salaryThreshold'] {
  const threshold = scenarios
    .flatMap(({ thresholds }) => thresholds)
    .find(
      ({ requirement }) =>
        requirement === 'minimum_annual_salary' || requirement === 'minimum_monthly_funds',
    );
  if (!threshold) return noData('Для выбранной страны нет подтверждённого порога зарплаты.');
  return {
    status: 'available',
    value: {
      amount: threshold.amount,
      currency: threshold.currency ?? '',
      basis: thresholdBasis(threshold.label, threshold.period),
    },
    sources: [comparisonEvidence(threshold.source)],
  };
}

function profileEvidence(profile: RelocationQuestionnaire | null): ComparisonEvidence[] {
  if (!profile?.updatedAt) return [];
  return [
    {
      kind: 'candidate_profile',
      title: 'Анкета кандидата',
      // The candidate's local calendar day, not the UTC one.
      capturedAt: localIsoDate(new Date(profile.updatedAt)),
    },
  ];
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
  return relocationStatusLabel(status);
}

function formatMoney(amount: number, currency: string): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount)} ${currency}`;
}

/** «Минимальная годовая зарплата» already names its period: no «, в год» after it. */
export function thresholdBasis(label: string, period: string): string {
  const periodLabel = THRESHOLD_PERIOD_LABELS[period];
  const named =
    (period === 'annual' && /годов/i.test(label)) ||
    (period === 'monthly' && /месячн/i.test(label));
  return named || !periodLabel ? label : `${label}, ${periodLabel}`;
}
