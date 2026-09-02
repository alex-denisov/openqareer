import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { canonicalRoleWord } from './roleSynonyms';

/**
 * Гипотеза роли — это наблюдение в пуле вакансий, а не строка из резюме.
 *
 * На проде «Роли и рынок» печатала заголовком гипотезы целую фразу из профиля
 * («VP of Technology, VP of Operations, CTO, or COO roles in SaaS, FinTech,
 * iGaming, or AI scale-ups»). Продукт её не выдумал — это ответ кандидата, — но
 * рыночной ролью она не является: у неё нет ни вакансий, ни выборки. Роль
 * теперь берётся из пула и называется так, как её называет рынок (B180, срез 1).
 *
 * Обе экспертные записки сходятся на одном пороге: меньше восьми вакансий —
 * это не гипотеза, потому что один работодатель со своим шаблоном требований
 * переворачивает картину.
 */
export const MIN_ROLE_SAMPLE = 8;

export interface PoolRoleHypothesis {
  readonly id: string;
  /** Каноническое имя: самая частая форма названия внутри группы. */
  readonly title: string;
  readonly sampleSize: number;
  readonly observedFrom: string;
  readonly observedTo: string;
  readonly sources: ReadonlyArray<{ source: string; count: number }>;
  /** Требования, встречающиеся у большинства вакансий группы. */
  readonly repeatedRequirements: readonly string[];
  /** Сколько требований группы уже подтверждено навыками кандидата. */
  readonly matchedRequirements: number;
}

/** Слова уровня и формата не меняют роль: они меняют грейд и условия. */
const NOISE = new Set([
  'senior', 'middle', 'junior', 'lead', 'ведущий', 'старший', 'младший',
  'главный', 'sr', 'jr', 'intern', 'стажёр', 'стажер', 'remote', 'удалённо',
  'удаленно', 'офис', 'гибрид', 'fulltime', 'parttime', 'в', 'и', 'на', 'для',
]);

function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[()«»"'’,.:;/\\|—–-]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 1 && !NOISE.has(word))
    // «Продакт-менеджер» и «Product Manager» — одна роль: без склейки обе
    // выборки оказывались ниже порога наблюдений.
    .map(canonicalRoleWord)
    .sort()
    .join(' ');
}

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[()«»"'’,.:;/\\|—–-]/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length > 2 && !NOISE.has(word))
      .map(canonicalRoleWord),
  );
}

interface RoleGroup {
  readonly key: string;
  readonly items: MatchedVacancyItem[];
  readonly titles: Map<string, number>;
}

function emptyGroup(key: string): RoleGroup {
  return { key, items: [], titles: new Map<string, number>() };
}

export function poolRoleHypotheses(input: {
  readonly pool: readonly MatchedVacancyItem[];
  readonly candidateRole: string;
  readonly candidateSkills: readonly string[];
}): PoolRoleHypothesis[] {
  const groups = new Map<string, RoleGroup>();
  for (const item of input.pool) {
    const title = item.cluster.canonicalTitle?.trim();
    if (!title) continue;
    const key = titleKey(title);
    if (!key) continue;
    const group = groups.get(key) ?? emptyGroup(key);
    group.items.push(item);
    group.titles.set(title, (group.titles.get(title) ?? 0) + 1);
    groups.set(key, group);
  }

  const roleWords = normalizeWords(input.candidateRole);
  const skills = new Set(input.candidateSkills.map((skill) => skill.toLowerCase().trim()));

  return [...groups.values()]
    // Меньше восьми наблюдений — не гипотеза, а совпадение.
    .filter((group) => group.items.length >= MIN_ROLE_SAMPLE)
    .map((group) => describeGroup(group, roleWords, skills))
    .sort((left, right) =>
      right.matchedRequirements - left.matchedRequirements ||
      right.sampleSize - left.sampleSize,
    )
    .slice(0, 3);
}

function describeGroup(
  group: RoleGroup,
  roleWords: Set<string>,
  skills: Set<string>,
): PoolRoleHypothesis {
  const observed = group.items.map((item) => item.cluster.firstObservedAt).sort();
  const requirements = repeatedRequirements(group.items);
  const titleOverlap = [...normalizeWords(canonicalTitle(group))].filter((word) =>
    roleWords.has(word),
  ).length;

  return {
    id: `pool-role-${group.key.replace(/\s+/gu, '-')}`,
    title: canonicalTitle(group),
    sampleSize: group.items.length,
    observedFrom: observed[0] ?? '',
    observedTo: observed.at(-1) ?? '',
    sources: countSources(group.items),
    repeatedRequirements: requirements,
    matchedRequirements:
      requirements.filter((requirement) => skills.has(requirement.toLowerCase())).length +
      titleOverlap,
  };
}

/** Каноническое имя — самая частая форма, даже если она разговорная. */
function canonicalTitle(group: RoleGroup): string {
  return [...group.titles.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0][0];
}

function repeatedRequirements(items: readonly MatchedVacancyItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const skill of new Set(item.cluster.skills.map((value) => value.trim()))) {
      if (skill) counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(items.length / 2));
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([skill]) => skill)
    .slice(0, 6);
}

function countSources(
  items: readonly MatchedVacancyItem[],
): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const source of new Set(item.cluster.sources.map((entry) => entry.sourceType))) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([source, count]) => ({ source, count }));
}
