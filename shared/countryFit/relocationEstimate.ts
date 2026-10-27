/**
 * B354: the public relocation estimate. Every country the candidate picks gets one card: the
 * best verified path from `mobilityData`, its requirements with their official sources, and the
 * gross salary needed for the net amount the candidate wants. A country without a verified path
 * gets an honest answer with the sources behind it, never an empty card.
 */
import { calculateAnnualPayroll } from '../taxCalculators';
import { getCountryTaxData } from '../taxData';
import type { TaxDataSource } from '../taxData/types';
import type { GermanOpportunityCardLanguage } from './germanyOpportunityCard';
import { evaluateRequirement, evaluateCountryFit } from './index';
import { getCountryMobilityData, isVerifiableSource } from './mobilityData';
import type {
  MobilityCandidateProfile,
  MobilityPath,
  MobilityRequirement,
  MobilityScenarioDefinition,
  MobilityScenarioId,
} from './types';

export const RELOCATION_PROFESSIONS = [
  'it',
  'finance',
  'engineering',
  'medicine',
  'sales',
  'other',
] as const;
export type RelocationProfession = (typeof RELOCATION_PROFESSIONS)[number];
export const RELOCATION_ENGLISH = ['none', 'A2', 'B1', 'B2', 'C1'] as const;
export type RelocationEnglish = (typeof RELOCATION_ENGLISH)[number];
export const RELOCATION_FAMILY = ['alone', 'partner', 'partner_kids', 'unknown'] as const;
export type RelocationFamily = (typeof RELOCATION_FAMILY)[number];

export interface RelocationAnswers {
  /** ISO code of the citizenship, or 'other' when it is not in the list. */
  readonly citizenship: string;
  readonly profession: RelocationProfession;
  readonly experienceYears: number;
  readonly hasDegree: boolean;
  readonly english: RelocationEnglish;
  readonly family: RelocationFamily;
  readonly netMonthly: number;
  readonly netCurrency: string;
  readonly countries: readonly string[];
}

export type RequirementMark = 'ok' | 'check' | 'barrier';

export interface RelocationRequirementLine {
  readonly mark: RequirementMark;
  readonly text: string;
}

export type RelocationMoney =
  | {
      readonly kind: 'gross';
      readonly grossMonthly: number;
      readonly netMonthly: number;
      readonly currency: string;
      readonly taxYear: number;
    }
  | { readonly kind: 'no_income_tax'; readonly currency: string; readonly taxYear: number }
  | { readonly kind: 'other_currency'; readonly currency: string };

export interface RelocationCard {
  readonly countryCode: string;
  readonly countryName: string;
  /** 'path' when a verified path exists; 'none' is the honest «no verified path» answer. */
  readonly kind: 'path' | 'none';
  readonly scenarioId?: MobilityScenarioId;
  readonly scenarioLabel?: string;
  readonly pathLabel?: string;
  readonly requirements: readonly RelocationRequirementLine[];
  readonly reason?: string;
  readonly sources: readonly TaxDataSource[];
  readonly money: RelocationMoney;
}

export const RELOCATION_MAX_COUNTRIES = 3;

/** The owner's example (27.10): an IT candidate, three different countries. */
export const RELOCATION_EXAMPLE: RelocationAnswers = {
  citizenship: 'RU',
  profession: 'it',
  experienceYears: 5,
  hasDegree: false,
  english: 'B2',
  family: 'partner',
  netMonthly: 5_000,
  netCurrency: 'EUR',
  countries: ['DE', 'AE', 'GE'],
};

const ENGLISH_TO_CARD: Readonly<Record<RelocationEnglish, GermanOpportunityCardLanguage>> = {
  none: 'none',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
};

export function relocationProfile(answers: RelocationAnswers): MobilityCandidateProfile {
  const citizenship = answers.citizenship === 'other' ? [] : [answers.citizenship];
  const family =
    answers.family === 'unknown'
      ? undefined
      : {
          hasPartner: answers.family !== 'alone',
          children: answers.family === 'partner_kids' ? 1 : 0,
        };
  return {
    citizenshipCountryCodes: citizenship,
    // Assumption shown on the page: the candidate lives in the country of citizenship.
    ...(citizenship[0] ? { currentCountryCode: citizenship[0] } : {}),
    isItProfessional: answers.profession === 'it',
    relevantExperienceYears: answers.experienceYears,
    // The questionnaire asks for recent experience, so it also counts for the 7-year window.
    relevantExperienceYearsByWindow: { '7': Math.min(answers.experienceYears, 7) },
    hasBachelorDegree: answers.hasDegree,
    completedFormalQualification: answers.hasDegree,
    ...(family ? { family } : {}),
    germanyOpportunityCard: {
      qualificationRecognition: 'unknown',
      shortageOccupation: null,
      experienceYearsLastFive: Math.min(answers.experienceYears, 5),
      experienceYearsLastSeven: Math.min(answers.experienceYears, 7),
      germanLevel: null,
      englishLevel: ENGLISH_TO_CARD[answers.english],
      age: null,
      germanyStayMonthsLastFive: null,
      partnerQualifiedAndApplying: null,
    },
  };
}

function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(\s|$)/u.exec(text);
  return (match?.[1] ?? text).trim();
}

function requirementSource(requirement: MobilityRequirement): TaxDataSource | undefined {
  return 'source' in requirement && isVerifiableSource(requirement.source)
    ? requirement.source
    : undefined;
}

const PERIOD_SUFFIX: Partial<Record<MobilityRequirement['kind'], string>> = {
  minimum_annual_salary: 'в год',
  minimum_monthly_funds: 'в месяц',
  minimum_remote_income: 'в месяц',
  minimum_savings: 'на счёте',
};

/** The official amount, so the card never shows a threshold without its number. */
function amountSuffix(requirement: MobilityRequirement): string {
  const suffix = PERIOD_SUFFIX[requirement.kind];
  if (!suffix || !('amount' in requirement) || !('currency' in requirement)) return '';
  const amount = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: requirement.currency,
    maximumFractionDigits: 0,
  }).format(requirement.amount);
  return ` Порог: ${amount} ${suffix}.`;
}

function requirementText(requirement: MobilityRequirement): string {
  if (requirement.kind === 'domestic_right')
    return 'Вы гражданин страны: разрешение на работу не нужно.';
  const sentence = firstSentence(requirement.explanation);
  return /\d/u.test(sentence) ? sentence : `${sentence}${amountSuffix(requirement)}`;
}

/** On equal fit a job offer path beats remote work, and both beat narrow job-seeker routes. */
const SCENARIO_PRIORITY: Readonly<Record<MobilityScenarioId, number>> = {
  domestic_market: 6,
  simple_mobility: 5,
  employer_sponsorship: 4,
  digital_nomad: 2,
  job_seeker_visa: 0,
};

interface RankedPath {
  readonly scenario: MobilityScenarioDefinition;
  readonly path: MobilityPath;
  readonly lines: readonly RelocationRequirementLine[];
  readonly score: number;
}

function rankPath(
  scenario: MobilityScenarioDefinition,
  path: MobilityPath,
  countryCode: string,
  profile: MobilityCandidateProfile,
): RankedPath {
  const lines = path.requirements.map((requirement): RelocationRequirementLine => {
    const { status } = evaluateRequirement(requirement, countryCode, profile);
    const mark: RequirementMark =
      status === 'satisfied' ? 'ok' : status === 'barrier' ? 'barrier' : 'check';
    return { mark, text: requirementText(requirement) };
  });
  const barriers = lines.filter(({ mark }) => mark === 'barrier').length;
  const checks = lines.filter(({ mark }) => mark === 'check').length;
  const met = lines.length - barriers - checks;
  // A barrier outweighs everything; conditions the candidate already meets count more than open checks.
  const score =
    (barriers === 0 ? 1_000 : 0) -
    barriers * 100 +
    met * 10 -
    (checks > 0 ? 3 : 0) +
    SCENARIO_PRIORITY[scenario.id];
  return { scenario, path, lines, score };
}

function bestPath(countryCode: string, profile: MobilityCandidateProfile): RankedPath | undefined {
  const data = getCountryMobilityData(countryCode);
  const ranked = data.scenarios
    .filter(({ dataStatus }) => dataStatus === 'verified')
    .flatMap((scenario) =>
      scenario.paths.map((path) => rankPath(scenario, path, data.countryCode, profile)),
    )
    .filter(
      ({ scenario, lines }) =>
        scenario.id !== 'domestic_market' || lines.every(({ mark }) => mark === 'ok'),
    )
    // Entry rules («visa-free entry does not let you work») are a path only when they already hold.
    .filter(
      ({ scenario, lines }) =>
        scenario.id !== 'simple_mobility' || lines.every(({ mark }) => mark === 'ok'),
    );
  return [...ranked].sort((a, b) => b.score - a.score)[0];
}

function pathSources(path: MobilityPath): TaxDataSource[] {
  const seen = new Set<string>();
  return path.requirements.flatMap((requirement) => {
    const source = requirementSource(requirement);
    if (!source || seen.has(source.url)) return [];
    seen.add(source.url);
    return [source];
  });
}

const GROSS_SEARCH_STEPS = 60;

/** The monthly gross that leaves `netMonthly` after tax and contributions; null when unreachable. */
export function grossForNetMonthly(countryCode: string, netMonthly: number): number | null {
  if (!Number.isFinite(netMonthly) || netMonthly <= 0) return null;
  const netAt = (grossMonthly: number) =>
    calculateAnnualPayroll(countryCode, grossMonthly * 12).netMonthlyIncome;
  let low = netMonthly;
  let high = netMonthly * 4;
  if (netAt(high) < netMonthly) return null;
  for (let step = 0; step < GROSS_SEARCH_STEPS && high - low > 0.5; step += 1) {
    const middle = (low + high) / 2;
    if (netAt(middle) < netMonthly) low = middle;
    else high = middle;
  }
  return Math.round(high);
}

export function relocationMoney(
  countryCode: string,
  netMonthly: number,
  netCurrency: string,
): RelocationMoney {
  const data = getCountryTaxData(countryCode);
  const noTax = calculateAnnualPayroll(countryCode, 120_000).netAnnualIncome === 120_000;
  if (noTax) return { kind: 'no_income_tax', currency: data.currency, taxYear: data.taxYear };
  if (netCurrency.toUpperCase() !== data.currency)
    return { kind: 'other_currency', currency: data.currency };
  const grossMonthly = grossForNetMonthly(countryCode, netMonthly);
  if (grossMonthly === null) return { kind: 'other_currency', currency: data.currency };
  return {
    kind: 'gross',
    grossMonthly,
    netMonthly,
    currency: data.currency,
    taxYear: data.taxYear,
  };
}

function noPathCard(
  countryCode: string,
  profile: MobilityCandidateProfile,
  money: RelocationMoney,
): RelocationCard {
  const data = getCountryMobilityData(countryCode);
  const evaluation = evaluateCountryFit(countryCode, profile);
  const unavailable = data.scenarios.filter(({ dataStatus }) => dataStatus === 'unavailable');
  const seen = new Set<string>();
  const sources = unavailable
    .flatMap(({ sources: list }) => list ?? [])
    .filter(
      (source) =>
        isVerifiableSource(source) && !seen.has(source.url) && Boolean(seen.add(source.url)),
    );
  const reason =
    evaluation.status === 'legally_unavailable'
      ? 'Официальные правила не дают иностранцу пути на работу в этой стране по вашим ответам.'
      : 'Для вашего гражданства проверенного пути на работу нет: правила по остальным путям мы ещё не сверили с официальными источниками.';
  return {
    countryCode: data.countryCode,
    countryName: data.name,
    kind: 'none',
    requirements: [],
    reason,
    sources,
    money,
  };
}

export function estimateRelocationCountry(
  countryCode: string,
  answers: RelocationAnswers,
): RelocationCard {
  const profile = relocationProfile(answers);
  const money = relocationMoney(countryCode, answers.netMonthly, answers.netCurrency);
  const best = bestPath(countryCode, profile);
  if (!best) return noPathCard(countryCode, profile, money);
  const data = getCountryMobilityData(countryCode);
  return {
    countryCode: data.countryCode,
    countryName: data.name,
    kind: 'path',
    scenarioId: best.scenario.id,
    scenarioLabel: best.scenario.label,
    pathLabel: best.path.label,
    requirements: best.lines,
    sources: pathSources(best.path),
    money,
    ...(best.lines.some(({ mark }) => mark === 'barrier')
      ? { reason: 'По вашим ответам есть препятствие.' }
      : {}),
  };
}

function cardRank(card: RelocationCard): number {
  if (card.kind === 'none') return 3;
  if (card.requirements.some(({ mark }) => mark === 'barrier')) return 2;
  return card.requirements.some(({ mark }) => mark === 'check') ? 1 : 0;
}

/** One card per picked country, the most open path first; ties keep the candidate's order. */
export function estimateRelocation(answers: RelocationAnswers): RelocationCard[] {
  const unique = [...new Set(answers.countries.map((code) => code.toUpperCase()))].slice(
    0,
    RELOCATION_MAX_COUNTRIES,
  );
  return unique
    .map((code, index) => ({ card: estimateRelocationCountry(code, answers), index }))
    .sort((a, b) => cardRank(a.card) - cardRank(b.card) || a.index - b.index)
    .map(({ card }) => card);
}
