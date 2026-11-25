import type { VacancyFitView } from '../../shared/vacancyFit';
import { termAppears } from './requirementTerm';

/** Что вакансия требует и какие слова профиля это подтвердили в разборе процента (B785). */
export interface ResumeRelevance {
  readonly requirements: readonly string[];
  readonly evidence: readonly {
    readonly requirement: string;
    readonly factId: string;
    readonly quote: string;
    readonly weight: number;
  }[];
}

const MATCHED = 3;
const PARTIAL = 2;
const TERM = 2;
const WORD = 0.5;
const STEM = 6;
const MIN_WORD = 4;
const MIN_QUOTE = 12;
const COMMON =
  /^(?:with|from|that|this|have|will|your|years?|experience|proven|strong|ability|able|including|across|working|track|record|deep|skills?|role|опыт\p{L}*|работ\p{L}*|знани\p{L}*|умени\p{L}*|навык\p{L}*|года?|лет)$/iu;

const normal = (text: string): string => text.toLowerCase().replace(/\s+/gu, ' ').trim();

const stems = (text: string): ReadonlySet<string> =>
  new Set(
    (normal(text).match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((word) => word.length >= MIN_WORD && !COMMON.test(word))
      .map((word) => word.slice(0, STEM)),
  );

/** Готовый разбор процента; разбора нет — требования текста или навыки вакансии. */
export function relevanceOf(
  view: Pick<VacancyFitView, 'requirements' | 'result'> | null,
  skills: readonly string[],
): ResumeRelevance {
  const texts = (view?.requirements ?? []).map((item) => item.text);
  const evidence = (view?.result?.assessments ?? []).flatMap((item) =>
    item.status === 'matched' || item.status === 'partial'
      ? item.evidence.map(({ factId, quote }) => ({
          requirement: item.requirementId,
          factId,
          quote: normal(quote),
          weight: item.status === 'matched' ? MATCHED : PARTIAL,
        }))
      : [],
  );
  return { requirements: [...new Set([...texts, ...skills])], evidence };
}

/** Цитата разбора — из этого пункта: строка профиля хранит все пункты места вместе. */
function quoted(text: string, quote: string): boolean {
  return (
    quote.length >= MIN_QUOTE &&
    (text.includes(quote) || (quote.includes(text) && text.length >= MIN_QUOTE))
  );
}

/** Насколько строка резюме отвечает вакансии; 0 — ничем. */
export function relevanceScore(
  relevance: ResumeRelevance,
  text: string,
  memoryId?: string,
): number {
  const own = normal(text);
  const byRequirement = new Map<string, number>();
  for (const { requirement, factId, quote, weight } of relevance.evidence) {
    if (factId !== memoryId && !quoted(own, quote)) continue;
    byRequirement.set(requirement, Math.max(byRequirement.get(requirement) ?? 0, weight));
  }
  const proven = [...byRequirement.values()].reduce((sum, weight) => sum + weight, 0);
  const words = stems(text);
  const told = relevance.requirements.reduce((sum, requirement) => {
    if (termAppears(requirement, text)) return sum + TERM;
    const shared = [...stems(requirement)].filter((stem) => words.has(stem)).length;
    return sum + (shared >= 2 ? WORD * Math.min(shared, 4) : 0);
  }, 0);
  return proven + told;
}
