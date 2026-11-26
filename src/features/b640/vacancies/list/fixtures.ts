import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';

export interface ItemInput {
  readonly id: string;
  readonly title?: string;
  readonly company?: string;
  readonly location?: string;
  readonly remote?: boolean;
  readonly percent?: number;
  readonly salary?: { readonly from?: number; readonly to?: number; readonly currency: string };
  readonly observedAt?: string;
  readonly relocation?: boolean;
  readonly noProfile?: boolean;
}

/** Строка подборки для тестов: только поля, которые читает список. */
export function makeItem(input: ItemInput): MatchedVacancyItem {
  const fitView =
    input.noProfile === true
      ? { state: 'ready', result: { status: 'insufficient', reason: 'no_eligible_facts' } }
      : input.percent === undefined
        ? undefined
        : {
            state: 'ready',
            result: {
              status: 'assessed',
              dataState: 'known',
              coveragePercent: input.percent,
              coverage: { total: 5 },
            },
          };
  return {
    cluster: {
      id: input.id,
      canonicalTitle: input.title ?? `Роль ${input.id}`,
      canonicalCompany: input.company ?? `Компания ${input.id}`,
      canonicalLocation: input.location ?? 'Москва',
      isRemote: input.remote ?? false,
      salary: input.salary,
      primaryUrl: `https://example.com/${input.id}`,
      firstObservedAt: input.observedAt ?? '2026-11-10T09:00:00Z',
      sources: [{ sourceId: 'hh', observedAt: input.observedAt ?? '2026-11-10T09:00:00Z' }],
      companyFeatures: { relocation: input.relocation, industry: 'Банки' },
    },
    explanation: { fitView, summary: '', calculatedAt: '2026-11-10T09:00:00Z' },
  } as unknown as MatchedVacancyItem;
}
