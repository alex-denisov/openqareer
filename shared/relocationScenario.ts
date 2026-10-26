import { relocationVisaProfile } from './relocationVisaProfile';
import { relocationAlerts, type RelocationQuestionnaire } from './relocationQuestionnaire';
import { z } from 'zod';
import { evaluateCountryFit } from './countryFit';
import { MOBILITY_SCENARIO_IDS, type MobilityCandidateProfile } from './countryFit/types';
import { calculateAnnualPayroll } from './taxCalculators';
import { getCountryTaxData, payrollSources } from './taxData';

export const RELOCATION_EXPENSES = ['rent', 'utilities', 'food', 'transport', 'insurance', 'education', 'other'] as const;
export const RELOCATION_UPFRONT = ['visa', 'moving', 'deposit', 'documents', 'travel', 'furnishings'] as const;
const amount = z.number().finite().min(0).max(1_000_000_000);
const flag = z.boolean().optional();
export const relocationCostSchema = z.object({
  amount, currency: z.string().regex(/^[A-Z]{3}$/),
  period: z.enum(['monthly', 'annual', 'once']),
  payer: z.enum(['candidate', 'employer', 'included']).default('candidate'),
  kind: z.enum(['candidate_estimate', 'source_quote']),
  basis: z.string().trim().min(3).max(500),
  observedAt: z.iso.date(),
  url: z.url().startsWith('https://').max(2000).optional(),
}).strict().refine((v) => v.kind !== 'source_quote' || Boolean(v.url), 'Укажите ссылку на источник');
export const relocationScenarioInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  countryCode: z.enum(['DE', 'CY', 'RS', 'AE', 'GE', 'RU']),
  city: z.string().trim().min(1).max(100), householdSize: z.number().int().min(1).max(20),
  incomeMode: z.enum(['local_employment', 'remote_employment', 'self_employed']),
  grossAnnualIncome: amount.optional(),
  confirmedNetMonthly: relocationCostSchema.optional(),
  scenarioId: z.enum(MOBILITY_SCENARIO_IDS),
  expenses: z.object(Object.fromEntries(RELOCATION_EXPENSES.map((key) => [key, relocationCostSchema.optional()])) as Record<typeof RELOCATION_EXPENSES[number], z.ZodOptional<typeof relocationCostSchema>>).strict(),
  upfront: z.object({ visa: relocationCostSchema.optional(), moving: relocationCostSchema.optional(), deposit: relocationCostSchema.optional(), documents: relocationCostSchema.optional(), travel: relocationCostSchema.optional(), furnishings: relocationCostSchema.optional() }).strict(),
  reserveMonths: z.number().int().min(0).max(36),
  proofOfFunds: relocationCostSchema.optional(),
  comparisonRate: relocationCostSchema.optional(),
  proofFundsUsableForLiving: z.boolean().default(false),
  payrollOptions: z.object({ germanyChildless: flag, georgiaPensionParticipant: flag, uaeNational: flag }).strict().optional(),
  visa: z.object({
    citizenshipCountryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(5).optional(),
    currentCountryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    hasJobOffer: flag, approvedEmployerSponsor: flag, occupationEligible: flag,
    occupationGoingRateMet: flag, recognizedDegreeCountryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).optional(),
    completedFormalQualification: flag, blueCardExceptionEligible: flag, isItProfessional: flag,
    hasBachelorDegree: flag, worksRemotelyForForeignEmployer: flag, hasPrivateHealthInsurance: flag,
    remoteMonthlyIncomeIsNet: flag, remoteMonthlyIncome: z.object({ amount, currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
    hasLocalWorkAuthorizationCountryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).optional(),
    minimumMonthlyFunds: z.object({ amount, currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
    monthlyOfferSalary: z.object({ amount, currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
    availableSavings: z.object({ amount, currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
    meetsLanguageRequirementsByCountry: z.record(z.string().regex(/^[A-Z]{2}$/), z.boolean()).optional(),
    jobSeekerCategoryEligibleByCountry: z.record(z.string().regex(/^[A-Z]{2}$/), z.boolean()).optional(),
    recentTopUniversityGraduateWithinYearsByCountry: z.record(z.string().regex(/^[A-Z]{2}$/), z.number().int().min(0).max(50)).optional(),
    financialGuaranteeSatisfiedByCountry: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).optional(),
    relevantExperienceYearsByWindow: z.record(z.string().regex(/^[0-9]{1,2}$/), z.number().min(0).max(80)).optional(),
    shortTermWorkExceptionByCountry: z.record(z.string().regex(/^[A-Z]{2}$/), z.boolean()).optional(),
    germanyOpportunityCard: z.object({ qualificationRecognition: z.enum(['fully', 'partially', 'not-recognized', 'unknown']), shortageOccupation: z.boolean().nullable(), experienceYearsLastFive: z.number().min(0).max(5).nullable(), experienceYearsLastSeven: z.number().min(0).max(7).nullable(), germanLevel: z.enum(['none', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']).nullable(), englishLevel: z.enum(['none', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']).nullable(), age: z.number().int().min(0).max(100).nullable(), germanyStayMonthsLastFive: z.number().min(0).max(60).nullable(), partnerQualifiedAndApplying: z.boolean().nullable() }).strict().optional(),
    relevantExperienceYears: z.number().min(0).max(80).optional(), stayDurationDays: z.number().int().min(1).max(3650).optional(),
    family: z.object({ hasPartner: z.boolean(), children: z.number().int().min(0).max(15) }).strict().optional(),
  }).strict(),
}).strict();
export type RelocationScenarioInput = z.infer<typeof relocationScenarioInputSchema>;
export type RelocationCost = z.infer<typeof relocationCostSchema>;
const cents = (v: number) => Math.round(v * 100) / 100;

function costInPeriod(cost: RelocationCost, currency: string, monthly: boolean): number {
  if (cost.currency !== currency) throw new Error('Расходы должны быть в валюте выбранной страны; пересчёт валют не задан.');
  if (monthly && cost.period === 'once') throw new Error('Регулярный расход требует месячный или годовой период.');
  if (!monthly && cost.period !== 'once') throw new Error('Первоначальные расходы укажите однократно.');
  if (cost.observedAt > new Date().toISOString().slice(0, 10)) throw new Error('Дата источника не может быть в будущем.');
  return cost.payer === 'candidate' ? cost.amount / (monthly && cost.period === 'annual' ? 12 : 1) : 0;
}

export function calculateRelocationScenario(input: RelocationScenarioInput, profile: RelocationQuestionnaire | null = null) {
  const data = getCountryTaxData(input.countryCode);
  if (input.comparisonRate && (input.comparisonRate.amount <= 0 || input.comparisonRate.period !== 'once' || input.comparisonRate.observedAt > new Date().toISOString().slice(0, 10))) throw new Error('Проверьте курс валют и дату источника.');
  if (input.confirmedNetMonthly && input.confirmedNetMonthly.payer !== 'candidate') throw new Error('Чистый доход должен быть суммой, доступной кандидату.');
  const payroll = input.incomeMode === 'local_employment' && input.grossAnnualIncome !== undefined
    ? calculateAnnualPayroll(input.countryCode, input.grossAnnualIncome, input.payrollOptions) : null;
  const net = input.incomeMode === 'local_employment' ? payroll?.netMonthlyIncome ?? null : (input.confirmedNetMonthly
    ? costInPeriod(input.confirmedNetMonthly, data.currency, true) : null);
  const missingCosts = RELOCATION_EXPENSES.filter((key) => !input.expenses[key]);
  const missingUpfront = RELOCATION_UPFRONT.filter((key) => !input.upfront[key]);
  const monthlyKnownCosts = cents(Object.values(input.expenses).reduce((sum, cost) => sum + (cost ? costInPeriod(cost, data.currency, true) : 0), 0));
  const upfrontSpending = cents(Object.entries(input.upfront).reduce((sum, [key, cost]) => sum + (key !== 'deposit' && cost ? costInPeriod(cost, data.currency, false) : 0), 0));
  const refundableDeposit = input.upfront.deposit ? costInPeriod(input.upfront.deposit, data.currency, false) : null;
  const proofOfFunds = input.proofOfFunds ? costInPeriod(input.proofOfFunds, data.currency, false) : 0;
  const reserve = input.proofFundsUsableForLiving ? Math.max(monthlyKnownCosts * input.reserveMonths, proofOfFunds) : monthlyKnownCosts * input.reserveMonths + proofOfFunds;
  const visa: MobilityCandidateProfile = { ...relocationVisaProfile(profile), ...input.visa,
    ...(input.visa.hasJobOffer && input.incomeMode === 'local_employment' && input.grossAnnualIncome !== undefined ? { annualOfferSalary: { amount: input.grossAnnualIncome, currency: data.currency } } : {}),
  };
  const mobility = evaluateCountryFit(input.countryCode, visa).scenarios.find((s) => s.id === input.scenarioId) ?? null;
  return {
    engineVersion: 'relocation-scenario-v1', currency: data.currency, taxYear: data.taxYear,
    payroll, incomeStatus: payroll ? 'salary_estimate' : net === null ? 'unknown' : 'candidate_estimate',
    monthlyNetIncome: net, monthlyKnownCosts, missingCosts, missingUpfront,
    monthlyRemaining: net !== null && missingCosts.length === 0 ? cents(net - monthlyKnownCosts) : null,
    upfrontSpending, refundableDeposit, proofOfFunds,
    missingProofOfFunds: !input.proofOfFunds,
    requiredCash: missingCosts.length === 0 && missingUpfront.length === 0 && input.proofOfFunds ? cents(upfrontSpending + (refundableDeposit ?? 0) + reserve) : null,
    comparisonCurrency: input.comparisonRate?.currency ?? null,
    comparisonMonthlyRemaining: input.comparisonRate && net !== null && missingCosts.length === 0
      ? cents((net - monthlyKnownCosts) * input.comparisonRate.amount) : null,
    mobility, mobilityCandidate: visa, documentWarnings: profile ? relocationAlerts(profile, new Date().toISOString().slice(0, 10)) : [], taxSources: payrollSources(data),
    assumptions: [...(payroll?.assumptions ?? []),
      'Зарплатная модель не устанавливает налоговое резидентство и не учитывает индивидуальные льготы и соглашения.',
      'Разрешение на въезд не означает право на работу. Доступность маршрута требует проверки документов.',
      'Депозит — возвратные связанные средства; он отделён от расходов. Средства для визы задаются отдельно.',
      'Суммы кандидата являются его оценками; отсутствующая категория не считается нулём.'],
  };
}
export type RelocationScenarioResult = ReturnType<typeof calculateRelocationScenario>;
export interface SavedRelocationScenario { readonly id: string; readonly createdAt: string; readonly input: RelocationScenarioInput; readonly result: RelocationScenarioResult; readonly profileRevision: number | null; }
