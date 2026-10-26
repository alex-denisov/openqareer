import type { TaxDataSource } from '../taxData/types';
import {
  MOBILITY_SCENARIO_IDS,
  type MobilityPath,
  type MobilityRequirement,
  type MobilityScenarioDefinition,
  type MobilityScenarioId,
} from './types';

const labels: Readonly<Record<MobilityScenarioId, string>> = {
  domestic_market: 'Домашний рынок',
  employer_sponsorship: 'Переезд под оффер компании',
  job_seeker_visa: 'Самостоятельный поиск работы',
  digital_nomad: 'Международная удалёнка',
  simple_mobility: 'Безвизовый въезд и региональные права на работу',
};

const noDataReason =
  'Нет проверенного официального набора правил для этого маршрута. Числовые пороги не показываются.';

export const noDataScenario = (id: MobilityScenarioId): MobilityScenarioDefinition => ({
  id,
  label: labels[id],
  dataStatus: 'no_data',
  paths: [],
  reason: noDataReason,
});

export function scenario(
  id: MobilityScenarioId,
  paths: readonly MobilityPath[],
  reason?: string,
): MobilityScenarioDefinition {
  return { id, label: labels[id], dataStatus: 'verified', paths, ...(reason ? { reason } : {}) };
}

/** A pair an official source shows has no route; the reason names what does exist instead. */
export function unavailableScenario(
  id: MobilityScenarioId,
  reason: string,
  evidence: readonly TaxDataSource[],
): MobilityScenarioDefinition {
  return { id, label: labels[id], dataStatus: 'unavailable', paths: [], reason, sources: evidence };
}

export function path(
  id: string,
  label: string,
  requirements: readonly MobilityRequirement[],
): MobilityPath {
  return { id, label, requirements };
}

export function noDataScenarios(): MobilityScenarioDefinition[] {
  return MOBILITY_SCENARIO_IDS.map(noDataScenario);
}

export function domesticScenario(countryCode: string): MobilityScenarioDefinition {
  return scenario('domestic_market', [
    path('citizen-or-resident', 'Гражданство или право на работу в стране', [
      { kind: 'domestic_right', countryCode },
    ]),
  ]);
}

export function regionalScenario(
  countryCode: string,
  eligibleCitizenshipCountryCodes: readonly string[],
  evidence: TaxDataSource,
  label: string,
): MobilityScenarioDefinition {
  return scenario('simple_mobility', [
    path('regional-work-right', label, [
      {
        kind: 'regional_work_right',
        destinationCountryCodes: [countryCode],
        eligibleCitizenshipCountryCodes,
        source: evidence,
        explanation: 'Право на работу проверяется по гражданству и стране назначения.',
      },
    ]),
  ]);
}
