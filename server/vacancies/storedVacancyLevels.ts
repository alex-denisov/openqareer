import { evaluateLevelMatch, inferSeniorityLevel, levelFromRank } from './levelMatcher';
import { campaignLevelMatch, type CampaignLevelWindow } from './titleParse/candidateRoleFunctions';
import { normalizeTitleKey } from './titleParse/normalizeTitleKey';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import type { deriveCandidateTargetLevel } from './candidateLevel';

/** Adds the persisted title parse to any consumer of a matched snapshot. */
export function addStoredVacancyLevels(
  items: readonly MatchedVacancyItem[],
  candidateLevel: ReturnType<typeof deriveCandidateTargetLevel>,
  getTitleParse: (titleKey: string) => { readonly levelRank: number | null } | undefined,
): MatchedVacancyItem[] {
  return items.map((item) => {
    const parsed = getTitleParse(normalizeTitleKey(item.cluster.canonicalTitle));
    const vacancyLevel =
      parsed === undefined
        ? inferSeniorityLevel(item.cluster.canonicalTitle)
        : levelFromRank(parsed.levelRank);
    return {
      ...item,
      explanation: {
        ...item.explanation,
        vacancyLevel,
        levelMatch: evaluateLevelMatch(
          candidateLevel,
          item.cluster.canonicalTitle,
          parsed?.levelRank,
        ),
      },
    };
  });
}

/**
 * Индекс подбора мог отстать от разбора названия, а кластер назван другой строкой: такие строки
 * проходили окно SQL, и ворота процента потом молча их отвергали (04.11). В подборку они не идут.
 * Подбор без функций (роли не разобраны) идёт без окна уровня, и здесь его не сужают.
 */
export function dropOutsideLevelGate(
  items: readonly MatchedVacancyItem[],
  window: CampaignLevelWindow,
  candidateLevel: ReturnType<typeof deriveCandidateTargetLevel>,
  getTitleParse: (
    titleKey: string,
  ) => { readonly functions: readonly string[]; readonly levelRank: number | null } | undefined,
): MatchedVacancyItem[] {
  if (Object.keys(window.floors).length === 0) return [...items];
  return items.filter((item) => {
    const title = item.cluster.canonicalTitle;
    const verdict = campaignLevelMatch(window, candidateLevel, title, getTitleParse(normalizeTitleKey(title)));
    return verdict === 'match' || verdict === 'unknown';
  });
}
