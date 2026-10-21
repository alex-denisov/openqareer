import type {
  MobilityScenarioEvaluation,
  MobilityScenarioId,
  ScenarioAvailability,
} from '../../../shared/countryFit/types';

const SCENARIO_RANK: Readonly<Record<ScenarioAvailability, number>> = {
  available: 0,
  barriers: 1,
  unknown: 2,
  unavailable: 3,
};

/** Routes that exist only by citizenship or residence: when not open, they are not a way in. */
const BIRTHRIGHT_SCENARIOS: ReadonlySet<MobilityScenarioId> = new Set([
  'domestic_market',
  'simple_mobility',
]);

/**
 * The scenario that leads a country card: the most open route the candidate
 * can take, and among equal routes the one backed by an official source. A
 * citizenship-only route that is not open (Spain is not EAEU for a Russian)
 * never leads while another route exists.
 */
export function leadingScenario(scenarios: readonly MobilityScenarioEvaluation[]) {
  const rank = (scenario: MobilityScenarioEvaluation) => {
    const closed = scenario.status !== 'available' && BIRTHRIGHT_SCENARIOS.has(scenario.id);
    const base = closed ? SCENARIO_RANK.unavailable : SCENARIO_RANK[scenario.status];
    return base * 2 + (scenario.sources.length ? 0 : 1);
  };
  return [...scenarios].sort((left, right) => rank(left) - rank(right))[0];
}
