import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

export interface RoleSampleSummary {
  /** Последняя дата, когда вакансия выборки была видна в источнике. */
  readonly observedAt: string | null;
  /** Коды площадок, из которых пришла выборка. */
  readonly sources: readonly string[];
}

/** Дата и площадки выборки «Карьеры»: подвал берёт их из данных, а не литералом (B445). */
export function summarizeRoleSample(matched: readonly MatchedVacancyItem[]): RoleSampleSummary {
  const dates = matched.map((item) => item.cluster.lastSeenAt).filter(Boolean);
  const sources = new Set(
    matched.flatMap((item) => item.cluster.sources.map((source) => source.sourceType)),
  );
  return { observedAt: [...dates].sort().at(-1) ?? null, sources: [...sources] };
}
