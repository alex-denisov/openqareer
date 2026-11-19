import type { RelocationQuestionnaire } from '../../../../shared/relocationQuestionnaire';
import type {
  RelocationCost,
  RelocationScenarioInput,
  SavedRelocationScenario,
} from '../../../../shared/relocationScenario';
import type { MobilityScenarioId } from '../../../../shared/countryFit/types';
import { putRelocationQuestionnaireStep } from '../../relocation/relocationApi';
import {
  deleteRelocationScenario,
  listRelocationScenarios,
  saveRelocationScenario,
} from '../../relocation/relocationScenarioApi';
import {
  COST_SECTIONS,
  householdOf,
  RESERVE_MONTHS,
  type CostValues,
  type Family,
} from './relocationCostsModel';

const BASIS = 'Оценка кандидата';

export type ScenarioCountry = RelocationScenarioInput['countryCode'];

/** Последний сохранённый расчёт каждой страны: в нём траты по разделам. */
export async function latestScenarios(): Promise<ReadonlyMap<string, SavedRelocationScenario>> {
  const page = await listRelocationScenarios();
  const latest = new Map<string, SavedRelocationScenario>();
  for (const item of page.items) {
    const current = latest.get(item.input.countryCode);
    if (!current || current.createdAt < item.createdAt) latest.set(item.input.countryCode, item);
  }
  return latest;
}

export function costValues(scenario: SavedRelocationScenario | undefined): CostValues {
  if (!scenario) return {};
  const { expenses, upfront } = scenario.input;
  return Object.fromEntries(
    COST_SECTIONS.flatMap((section) => {
      const cost =
        section.key === 'moving' || section.key === 'deposit'
          ? upfront[section.key]
          : expenses[section.key];
      return cost ? [[section.key, cost.amount]] : [];
    }),
  );
}

export function familyOf(profile: RelocationQuestionnaire | null): Family | null {
  const family = profile?.family;
  if (!family || family.partnerStatus === 'unknown' || family.partnerStatus === 'undecided')
    return null;
  return { partner: family.partnerStatus === 'has_partner', children: family.childrenCount ?? 0 };
}

export interface CostsTarget {
  readonly countryCode: ScenarioCountry;
  readonly countryName: string;
  readonly city: string;
  readonly currency: string;
  readonly grossMonthly: number;
  readonly scenarioId: MobilityScenarioId;
  readonly family: Family | null;
}

function cost(amount: number, currency: string, once: boolean): RelocationCost {
  return {
    amount,
    currency,
    period: once ? 'once' : 'monthly',
    payer: 'candidate',
    kind: 'candidate_estimate',
    basis: BASIS,
    observedAt: new Date().toISOString().slice(0, 10),
  };
}

function scenarioInput(target: CostsTarget, values: CostValues): RelocationScenarioInput {
  const pick = (once: boolean) =>
    Object.fromEntries(
      COST_SECTIONS.filter(
        (section) => section.once === once && values[section.key] !== undefined,
      ).map((section) => [section.key, cost(values[section.key]!, target.currency, once)]),
    );
  return {
    name: `${target.countryName}, ${target.city}`,
    countryCode: target.countryCode,
    city: target.city,
    householdSize: householdOf(target.family),
    incomeMode: 'local_employment',
    grossAnnualIncome: target.grossMonthly * 12,
    scenarioId: target.scenarioId,
    expenses: pick(false),
    upfront: pick(true),
    reserveMonths: RESERVE_MONTHS,
    proofFundsUsableForLiving: false,
    visa: {},
  };
}

/** Новая версия расчёта страны; прежняя удаляется, чтобы история не упиралась в лимит. */
export async function saveCosts(
  target: CostsTarget,
  values: CostValues,
  previous: SavedRelocationScenario | undefined,
): Promise<SavedRelocationScenario> {
  const saved = await saveRelocationScenario(scenarioInput(target, values), crypto.randomUUID());
  if (previous && previous.id !== saved.id)
    await deleteRelocationScenario(previous.id).catch(() => undefined);
  return saved;
}

export async function saveFamily(profile: RelocationQuestionnaire, family: Family) {
  return putRelocationQuestionnaireStep(
    'family',
    {
      ...profile.family,
      partnerStatus: family.partner ? 'has_partner' : 'no_partner',
      childrenCount: family.children,
      familyMovePlan: family.partner || family.children > 0 ? 'together' : 'not_applicable',
    },
    profile.revision,
  );
}
