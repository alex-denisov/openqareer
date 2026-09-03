import { canonicalRoleWord } from './roleSynonyms';

/**
 * Наблюдения рынка, сгруппированные по роли.
 *
 * На проде «Роли и рынок» печатала заголовком гипотезы целую фразу из профиля
 * («VP of Technology, VP of Operations, CTO, or COO roles in SaaS, FinTech,
 * iGaming, or AI scale-ups»). Продукт её не выдумал — это ответ кандидата, — но
 * рыночной ролью она не является: у неё нет ни вакансий, ни выборки. Роль
 * берётся не из строки резюме: пул либо подтверждает её, либо честно молчит
 * (B180, срезы 1 и 1в).
 *
 * Считается это на сервере (B180, срез 1б). В браузер пул приезжает без
 * требований вовсе: `matchedVacancyPage.ts` намеренно вырезает `skills`, чтобы
 * страница влезла в байтовый бюджет маршрута (INC-029), а обе экспертные
 * записки строят гипотезу роли именно на пересечении требований. Полный пул
 * живёт на сервере — там же и расчёт; наружу уходит готовый ответ в несколько
 * сотен байт. Модуль лежит в `shared/`, потому что у него два вызывающих:
 * маршрут и тест интерфейса.
 *
 * Обе экспертные записки сходятся на одном пороге: меньше восьми вакансий —
 * это не гипотеза, потому что один работодатель со своим шаблоном требований
 * переворачивает картину.
 */
export const MIN_ROLE_SAMPLE = 8;

/**
 * Наблюдение рынка в том виде, в каком его видит расчёт: заголовок, когда
 * увидели, требования и откуда. Структурный тип, а не запись подбора: у
 * сервера и у браузера они разные, а нужно от них одно и то же.
 */
export interface RoleObservation {
  readonly canonicalTitle: string | undefined;
  readonly firstObservedAt: string;
  readonly skills: readonly string[];
  readonly sources: ReadonlyArray<{ readonly sourceType: string }>;
}

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

/**
 * Ключ группировки: две формулировки одной роли обязаны попасть в один ключ.
 * Экспортирован, потому что тем же ключом роль, названную моделью, ищут в пуле
 * (`roleProposals.ts`, срез 1в) — иначе имя и доказательство разошлись бы.
 */
export function titleKey(title: string): string {
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

export interface RoleGroup {
  readonly key: string;
  readonly items: RoleObservation[];
  readonly titles: Map<string, number>;
}

function emptyGroup(key: string): RoleGroup {
  return { key, items: [], titles: new Map<string, number>() };
}

/** Пул, сгруппированный по ключу роли. Один проход для обоих вызывающих. */
export function groupObservations(
  pool: readonly RoleObservation[],
): Map<string, RoleGroup> {
  const groups = new Map<string, RoleGroup>();
  for (const item of pool) {
    const title = item.canonicalTitle?.trim();
    if (!title) continue;
    const key = titleKey(title);
    if (!key) continue;
    const group = groups.get(key) ?? emptyGroup(key);
    group.items.push(item);
    group.titles.set(title, (group.titles.get(title) ?? 0) + 1);
    groups.set(key, group);
  }
  return groups;
}

export function describeGroup(
  group: RoleGroup,
  roleWords: Set<string>,
  skills: Set<string>,
): PoolRoleHypothesis {
  const observed = group.items.map((item) => item.firstObservedAt).sort();
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

function repeatedRequirements(items: readonly RoleObservation[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const skill of new Set(item.skills.map((value) => value.trim()))) {
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
  items: readonly RoleObservation[],
): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const source of new Set(item.sources.map((entry) => entry.sourceType))) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([source, count]) => ({ source, count }));
}
