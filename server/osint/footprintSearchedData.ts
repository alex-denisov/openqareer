import type { CandidateFootprintFinding } from '../../shared/candidateFootprint';
import type { FootprintQueryPlanItem } from './candidateFootprintQueryPlan';
import type { FootprintFinding } from './adapters/footprintAdapter';
import { youtubeChannelQueryText } from './adapters/youtubeAdapter';

type Receipt = FootprintFinding['receipt'];

/** Запросы по ссылке и нику, как их пишут квитанции находок. */
function plannedQueries(plan: readonly FootprintQueryPlanItem[]): ReadonlySet<string> {
  return new Set(
    plan.flatMap(({ input }) => {
      if ('username' in input) return [`username=${input.username}`];
      if (!('profileUrl' in input)) return [];
      const channel = youtubeChannelQueryText(input.profileUrl);
      return [`url=${input.profileUrl}`, ...(channel ? [channel] : [])];
    }),
  );
}

/** Квитанция поиска по ссылке или нику; прочие источники ищут по имени и почте. */
const LINK_QUERY = /^(?:url|username|forHandle|forUsername|id)=/u;

/** Находка, с которой кандидат уже что-то сделал, остаётся. */
function handled(finding: CandidateFootprintFinding): boolean {
  return (
    finding.review !== 'unreviewed' ||
    finding.checklistMark !== undefined ||
    finding.removal !== undefined ||
    finding.profileFactId !== undefined
  );
}

/**
 * B668: ссылку убрали из профиля — прежние находки только по ней (и по нику из неё) в новый
 * поиск не переходят. Не отмеченные в этом запуске данные остаются в плане, их находки тоже.
 */
export function findingsStillSearched(
  previous: readonly CandidateFootprintFinding[],
  plan: readonly FootprintQueryPlanItem[],
): readonly CandidateFootprintFinding[] {
  const planned = plannedQueries(plan);
  const searched = ({ query }: Receipt) => !LINK_QUERY.test(query) || planned.has(query);
  return previous.filter((finding) => {
    const receipts = finding.receipts?.length ? finding.receipts : [finding.receipt];
    return handled(finding) || receipts.some(searched);
  });
}
