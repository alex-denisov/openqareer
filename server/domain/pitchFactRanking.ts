import type { FunctionCode } from '../../shared/roleTaxonomy';
import { rulesParse } from '../vacancies/titleParse/rulesParse';

export interface RankablePitchFact {
  readonly id?: string;
  readonly ref?: string;
  readonly statement: string;
  readonly domain?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface PitchRankingVacancy {
  readonly title: string;
  readonly description?: string;
}

export interface PitchVacancyAnalysis {
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
}

export interface PitchCampaignRole {
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
  readonly evidenceRefs: readonly string[];
}

export interface PitchFactRankingContext {
  readonly vacancy: PitchVacancyAnalysis;
  readonly campaignRole?: PitchCampaignRole;
}

const EXPERIENCE_DOMAINS = new Set(['role-evidence', 'responsibility', 'outcome']);
const VACANCY_STOP_WORDS = new Set([
  'and',
  'for',
  'the',
  'with',
  'your',
  'для',
  'или',
  'как',
  'над',
  'при',
  'что',
  'это',
]);

type FactGroup =
  | 'campaign-evidence'
  | 'matching-position'
  | 'matched-experience'
  | 'experience'
  | 'project'
  | 'skill'
  | 'other'
  | 'tail';

function factKey(fact: RankablePitchFact): string {
  return fact.id ?? fact.ref ?? '';
}

function factRefs(fact: RankablePitchFact): readonly string[] {
  const refs = [fact.id, fact.ref].filter((ref): ref is string => Boolean(ref));
  return refs.flatMap((ref) => (ref.startsWith('memory:') ? [ref, ref.slice('memory:'.length)] : [ref, `memory:${ref}`]));
}

function isIdKind(fact: RankablePitchFact, kind: string): boolean {
  return new RegExp(`(?:^|-)${kind}(?:-|$)`, 'iu').test(factKey(fact));
}

function isExperience(fact: RankablePitchFact): boolean {
  return EXPERIENCE_DOMAINS.has(fact.domain ?? '') || isIdKind(fact, 'ach2');
}

function tokens(text: string): Set<string> {
  const words = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => word.length >= 3 && !VACANCY_STOP_WORDS.has(word)));
}

function overlapCount(statement: string, vacancyWords: ReadonlySet<string>): number {
  let count = 0;
  for (const word of tokens(statement)) {
    if (vacancyWords.has(word)) count += 1;
  }
  return count;
}

function groupFor(fact: RankablePitchFact, overlap: number): FactGroup {
  if (isExperience(fact)) return overlap > 0 ? 'matched-experience' : 'experience';
  if (isIdKind(fact, 'proj')) return 'project';
  if (fact.domain === 'skill') return 'skill';
  if (isIdKind(fact, 'edu') || isIdKind(fact, 'cert')) return 'tail';
  return 'other';
}

function hasSharedFunction(left: readonly FunctionCode[], right: readonly FunctionCode[]): boolean {
  return left.some((code) => right.includes(code));
}

function usableCampaignRole(context: PitchFactRankingContext | undefined): PitchCampaignRole | undefined {
  const role = context?.campaignRole;
  if (!role || context.vacancy.functions.length === 0 || role.functions.length === 0) return undefined;
  return hasSharedFunction(context.vacancy.functions, role.functions) ? role : undefined;
}

/** Без полного разбора сохраняется порядок шаблона прежних выпусков. */
export function hasRoleAwarePitchRanking(context: PitchFactRankingContext | undefined): boolean {
  return context?.vacancy.levelRank !== null && usableCampaignRole(context) !== undefined;
}

function isPositionForVacancy(
  fact: RankablePitchFact,
  context: PitchFactRankingContext | undefined,
): boolean {
  if (!isExperience(fact) || !context || context.vacancy.levelRank === null) return false;
  const parsed = rulesParse(fact.statement);
  return (
    parsed.levelRank === context.vacancy.levelRank &&
    hasSharedFunction(parsed.functions, context.vacancy.functions)
  );
}

function semanticGroup(
  fact: RankablePitchFact,
  context: PitchFactRankingContext | undefined,
): FactGroup | undefined {
  const role = usableCampaignRole(context);
  if (!role || !hasRoleAwarePitchRanking(context)) return undefined;
  if (factRefs(fact).some((ref) => role.evidenceRefs.includes(ref))) return 'campaign-evidence';
  return isPositionForVacancy(fact, context) ? 'matching-position' : undefined;
}

function freshness(fact: RankablePitchFact): number {
  const value = Date.parse(fact.updatedAt ?? fact.createdAt ?? '');
  return Number.isNaN(value) ? 0 : value;
}

/** Повторный импорт профиля даёт копию факта с новым префиксом `imp<хеш>-` и тем же
 * хвостом (`exp-4`); формат дат в тексте при этом может отличаться (прод 25.09). */
const IMPORT_PREFIX = /^imp[0-9a-f]+-/iu;
const DUPLICATE_HEAD_LENGTH = 12;

function duplicateKey(fact: RankablePitchFact): string | null {
  const key = factKey(fact);
  if (!IMPORT_PREFIX.test(key)) return null;
  const head = fact.statement.toLocaleLowerCase().replace(/[^\p{L}]+/gu, '');
  return `${key.replace(IMPORT_PREFIX, '')}|${head.slice(0, DUPLICATE_HEAD_LENGTH)}`;
}

/** Из копий одного факта остаётся самая свежая; порядок входа не меняется. */
function withoutImportDuplicates<T extends RankablePitchFact>(facts: readonly T[]): T[] {
  const freshest = new Map<string, T>();
  for (const fact of facts) {
    const key = duplicateKey(fact);
    if (key === null) continue;
    const kept = freshest.get(key);
    if (!kept || freshness(fact) > freshness(kept)) freshest.set(key, fact);
  }
  const seenText = new Set<string>();
  return facts.filter((fact) => {
    const key = duplicateKey(fact);
    if (key !== null && freshest.get(key) !== fact) return false;
    // Тот же текст под другим хвостом (resp-3-2 и ach-3-1) — тоже копия.
    const text = fact.statement.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (seenText.has(text)) return false;
    seenText.add(text);
    return true;
  });
}

const GROUP_PRIORITY: Record<FactGroup, number> = {
  'campaign-evidence': 0,
  'matching-position': 1,
  'matched-experience': 2,
  experience: 3,
  project: 4,
  skill: 5,
  other: 6,
  tail: 7,
};

/**
 * Ставит доказательства опыта перед менее содержательными пунктами профиля.
 * Копия массива сохраняет порядок входа как последний критерий и не меняет
 * снимок кандидата, который принадлежит хранилищу.
 */
export function rankPitchFacts<T extends RankablePitchFact>(
  facts: readonly T[],
  vacancy: PitchRankingVacancy,
  context?: PitchFactRankingContext,
): T[] {
  const vacancyWords = tokens(`${vacancy.title} ${vacancy.description ?? ''}`);
  return withoutImportDuplicates(facts)
    .map((fact, index) => {
      const overlap = overlapCount(fact.statement, vacancyWords);
      return { fact, index, overlap, group: semanticGroup(fact, context) ?? groupFor(fact, overlap) };
    })
    .sort((left, right) => {
      const groupDifference = GROUP_PRIORITY[left.group] - GROUP_PRIORITY[right.group];
      if (groupDifference !== 0) return groupDifference;
      if (
        (left.group === 'matched-experience' || left.group === 'matching-position') &&
        left.overlap !== right.overlap
      ) {
        return right.overlap - left.overlap;
      }
      const freshnessDifference = freshness(right.fact) - freshness(left.fact);
      return freshnessDifference || left.index - right.index;
    })
    .map(({ fact }) => fact);
}
