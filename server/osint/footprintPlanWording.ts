import type { PublicFootprintQueryPlanItem } from './candidateFootprintQueryPlan';

/**
 * B668: один ник или одна ссылка проверяются несколькими способами, и у строк плана одна
 * формулировка. Экран B640 способов не называет (B740), поэтому показывает одну строку на
 * формулировку, а выбор строки запускает все доступные проверки за ней.
 */
export function mergeSameWording(
  plan: readonly PublicFootprintQueryPlanItem[],
): readonly PublicFootprintQueryPlanItem[] {
  const groups = new Map<string, PublicFootprintQueryPlanItem[]>();
  for (const item of plan) groups.set(item.preview, [...(groups.get(item.preview) ?? []), item]);
  return [...groups.values()].map((group) => ({
    ...group[0]!,
    available: group.some((item) => item.available),
    selectedByDefault: group.some((item) => item.selectedByDefault && item.available),
  }));
}

export function expandSameWording(
  plan: readonly PublicFootprintQueryPlanItem[],
  selectedIds: readonly string[],
): readonly string[] {
  const expanded = selectedIds.flatMap((id) => {
    const chosen = plan.find((item) => item.id === id);
    if (!chosen) return [id];
    const members = plan
      .filter((item) => item.preview === chosen.preview && item.available)
      .map((item) => item.id);
    return members.length > 0 ? members : [id];
  });
  return [...new Set(expanded)];
}
