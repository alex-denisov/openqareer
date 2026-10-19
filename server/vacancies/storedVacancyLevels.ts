import { evaluateLevelMatch, inferSeniorityLevel, levelFromRank } from './levelMatcher';
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
