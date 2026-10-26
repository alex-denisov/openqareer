import { roleWorkFamily } from './roleWorkFamilies';
import type { WorkFamilyCode, WorkPreferenceResult } from './workPreferences';
import {
  describeGroup,
  groupObservations,
  MIN_ROLE_SAMPLE,
  titleKey,
  type PoolRoleHypothesis,
  type RoleGroup,
  type RoleObservation,
} from './poolRoleHypotheses';

/**
 * Роль называет модель, пул её подтверждает (B180, срез 1в).
 *
 * Срез 1б считал гипотезу роли только снизу — из группировки пула. Замер на
 * проде показал предел этого способа: 529 вакансий дают 514 групп, ни одной с
 * восемью наблюдениями, а группировка по корневому слову собирает 71 разнородную
 * вакансию под словом «manager». Владелец назвал причину прямо: чтобы рынок сам
 * называл роль, нужны десятки тысяч вакансий в сегменте, и это недостижимо
 * сейчас.
 *
 * Поэтому имя приходит от модели, читающей резюме, а пул остаётся источником
 * **доказательства**. Ключевое правило владельца (2026-09-03): «если в пуле
 * вакансий таких нет, то не нужно обесценивать ответ LLM, нужно лишь сообщить,
 * что пока таких вакансий не найдено». Роль **не отбрасывается** ни за
 * отсутствие вакансий, ни за отсутствие в каком-либо справочнике — она несёт
 * метку о том, что про неё известно.
 *
 * Что осталось строгим: модель не печатает чисел (их считает этот модуль),
 * модель не задаёт порядок (порядок — чистая функция от доказательств), и у
 * каждой названной роли обязана быть опора на факт резюме — роль без
 * объяснения это шум, а не гипотеза.
 */

/** Роль, названная моделью по резюме, вместе с опорой на факты. */
export interface NamedRole {
  readonly title: string;
  /** Почему модель её назвала — своими словами, без чисел. */
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export type RoleConfirmation =
  /** Наблюдений хватает: числа со своей выборкой, окном и источниками. */
  | ({ readonly state: 'observed' } & Omit<PoolRoleHypothesis, 'id' | 'title'>)
  /** Наблюдения есть, но их мало: только абсолютное число, без агрегатов. */
  | { readonly state: 'too-few'; readonly sampleSize: number }
  /** Вакансий не найдено — это не приговор роли, а состояние наших источников. */
  | { readonly state: 'not-found' };

export interface ProposedRole {
  readonly id: string;
  readonly title: string;
  /**
   * Откуда имя: назвала модель по резюме, назвал рынок группой вакансий или
   * кандидат сам (в мастере или принял предложение консультанта, 26.10).
   */
  readonly origin: 'model' | 'market' | 'candidate';
  readonly reason: string | null;
  readonly evidenceRefs: readonly string[];
  readonly confirmation: RoleConfirmation;
  /**
   * Вид работы, к которому роль относит **таблица кода** (B180, срез 3).
   * `null` — таблица роль не знает, и ответы кандидата её не двигают.
   */
  readonly family: WorkFamilyCode | null;
  /**
   * Все названия, под которыми роль встречается в пуле, частые первыми:
   * одна функция и уровень — одна строка «Карьеры» (26.10).
   */
  readonly aliases?: readonly string[];
}

/**
 * Ключ роли по функции и уровню (сервер считает его словарём ролей). `null` —
 * словарь название не узнал, и роль сводится только по строке названия.
 */
export type RoleKeyOf = (title: string) => string | null;

/**
 * Идентификатор роли «Карьеры» по названию: им же помечается отклонение
 * кандидата (`career-role:<id>`), поэтому одна формулировка — один id.
 */
export function careerRoleId(title: string): string {
  return `role-${titleKey(title).replace(/\s+/gu, '-')}`;
}

/**
 * Ролей рынка — не больше пяти: их никто не называл, кандидат их пролистывает.
 * Роли, названные по опыту кандидата, не срезаются: у каждой есть факт-основание
 * (решение владельца 26.10).
 */
const MAX_MARKET_PROPOSALS = 5;

/** Пул по ключу роли: функция и уровень, а без словаря — строка названия. */
function groupByRole(
  pool: readonly RoleObservation[],
  keyOf: (title: string) => string,
): Map<string, RoleGroup> {
  const groups = new Map<string, RoleGroup>();
  for (const item of pool) {
    const title = item.canonicalTitle?.trim();
    if (!title) continue;
    const key = keyOf(title);
    if (!key) continue;
    const group = groups.get(key) ?? { key, items: [], titles: new Map<string, number>() };
    group.items.push(item);
    group.titles.set(title, (group.titles.get(title) ?? 0) + 1);
    groups.set(key, group);
  }
  return groups;
}

function memoizedKey(roleKey: RoleKeyOf | undefined): (title: string) => string {
  const cache = new Map<string, string>();
  return (title) => {
    const known = cache.get(title);
    if (known !== undefined) return known;
    const key = roleKey?.(title) ?? titleKey(title);
    cache.set(title, key);
    return key;
  };
}

function aliasesOf(title: string, group: RoleGroup | undefined): string[] {
  const titles = [...(group?.titles.entries() ?? [])]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([alias]) => alias);
  return [title, ...titles.filter((alias) => alias !== title)];
}

export function proposeRoles(input: {
  readonly named: readonly NamedRole[];
  readonly pool: readonly RoleObservation[];
  readonly candidateSkills: readonly string[];
  /**
   * Ответы на задания «Какие роли мне подходят» (B180, срез 3). Они меняют
   * **порядок** внутри одного яруса доказанности и никогда — состав: задания
   * уточняют порядок уже прошедших рынок гипотез, а не находят роли.
   */
  readonly preferences?: WorkPreferenceResult;
  /** Сводит разные названия одной функции и уровня в одну роль (26.10). */
  readonly roleKey?: RoleKeyOf;
}): ProposedRole[] {
  const keyOf = memoizedKey(input.roleKey);
  const groups = groupByRole(input.pool, keyOf);
  const skills = new Set(input.candidateSkills.map((skill) => skill.toLowerCase().trim()));
  const claimed = new Set<string>();

  const fromModel = input.named
    // Роль без опоры на резюме — шум: объяснение обязательно, имя — нет.
    .filter((role) => role.title.trim() && role.reason.trim() && role.evidenceRefs.length > 0)
    .flatMap<ProposedRole>((role) => {
      const key = keyOf(role.title.trim());
      if (!key || claimed.has(key)) return [];
      claimed.add(key);
      const group = groups.get(key);
      return [
        {
          id: careerRoleId(role.title),
          title: role.title.trim(),
          origin: 'model',
          reason: role.reason.trim(),
          evidenceRefs: role.evidenceRefs,
          confirmation: confirmationFor(group, skills),
          family: roleWorkFamily(role.title),
          aliases: aliasesOf(role.title.trim(), group),
        },
      ];
    });

  const fromMarket = [...groups.entries()]
    .filter(([key, group]) => !claimed.has(key) && group.items.length >= MIN_ROLE_SAMPLE)
    .map<ProposedRole>(([, group]) => {
      const described = describeGroup(group, new Set<string>(), skills);
      return {
        id: careerRoleId(described.title),
        title: described.title,
        origin: 'market',
        reason: null,
        evidenceRefs: [],
        confirmation: { state: 'observed', ...withoutIdentity(described) },
        family: roleWorkFamily(described.title),
        aliases: aliasesOf(described.title, group),
      };
    });

  const order = byEvidenceThen(preferenceRank(input.preferences));
  const market = [...fromMarket].sort(order).slice(0, MAX_MARKET_PROPOSALS);
  return [...fromModel, ...market].sort(order);
}

/**
 * Место вида работы в ответах кандидата: чем меньше число, тем выше роль
 * внутри своего яруса доказанности.
 *
 * Роль без известного вида работы и роль вне краёв распределения стоят
 * посередине — их ответы не двигают. Исключённый вид работы («точно не хочу»)
 * уходит в конец яруса, но **не исчезает**: убирать роль с экрана за
 * предпочтение значило бы решать за кандидата.
 */
function preferenceRank(
  preferences: WorkPreferenceResult | undefined,
): (role: ProposedRole) => number {
  if (!preferences || !preferences.discriminates) return () => 0;
  const ranked = new Map(
    preferences.ranked.map((count, index) => [count.family, index - preferences.ranked.length]),
  );
  return (role) => {
    if (!role.family) return 0;
    if (preferences.excluded.includes(role.family)) return 1;
    return ranked.get(role.family) ?? 0;
  };
}

/**
 * Что пул говорит о названии, пришедшем не из предложений, — например о роли,
 * которую кандидат назвал сам (B180, срез 2). Считает то же самое и тем же
 * способом: имя не даёт роли ни одного очка, доказательство даёт только пул.
 */
export function confirmRoleTitle(input: {
  readonly title: string;
  readonly pool: readonly RoleObservation[];
  readonly candidateSkills: readonly string[];
}): RoleConfirmation {
  const key = titleKey(input.title);
  if (!key) return { state: 'not-found' };
  return confirmationFor(
    groupObservations(input.pool).get(key),
    new Set(input.candidateSkills.map((skill) => skill.toLowerCase().trim())),
  );
}

/**
 * Подтверждение по уже отобранным вакансиям роли (26.10): роль мастера
 * «VP of Engineering / Technology» дословно не встречается в пуле, и счёт по
 * ключу заголовка давал «0 вакансий» при 273 в фильтре «Роли».
 */
export function confirmRoleObservations(input: {
  readonly title: string;
  readonly observations: readonly RoleObservation[];
  readonly candidateSkills: readonly string[];
}): RoleConfirmation {
  const key = titleKey(input.title);
  if (!key) return { state: 'not-found' };
  const titles = new Map<string, number>();
  for (const item of input.observations) {
    const title = item.canonicalTitle?.trim();
    if (title) titles.set(title, (titles.get(title) ?? 0) + 1);
  }
  return confirmationFor(
    { key, items: [...input.observations], titles },
    new Set(input.candidateSkills.map((skill) => skill.toLowerCase().trim())),
  );
}

/**
 * Совпадение считается только по требованиям вакансий: пересечение имени роли
 * с самим собой давало бы каждой названной роли лишний балл из воздуха.
 */
function confirmationFor(group: RoleGroup | undefined, skills: Set<string>): RoleConfirmation {
  const size = group?.items.length ?? 0;
  if (size === 0) return { state: 'not-found' };
  // Ниже порога наблюдений показывается только абсолютное число: доли и
  // повторяющиеся требования на такой выборке переворачивает один работодатель.
  if (size < MIN_ROLE_SAMPLE || !group) return { state: 'too-few', sampleSize: size };
  return {
    state: 'observed',
    ...withoutIdentity(describeGroup(group, new Set<string>(), skills)),
  };
}

function withoutIdentity(hypothesis: PoolRoleHypothesis): Omit<PoolRoleHypothesis, 'id' | 'title'> {
  return {
    sampleSize: hypothesis.sampleSize,
    observedFrom: hypothesis.observedFrom,
    observedTo: hypothesis.observedTo,
    sources: hypothesis.sources,
    repeatedRequirements: hypothesis.repeatedRequirements,
    ...(hypothesis.wage ? { wage: hypothesis.wage } : {}),
    ...(hypothesis.matchedRequirementNames
      ? { matchedRequirementNames: hypothesis.matchedRequirementNames }
      : {}),
    matchedRequirements: hypothesis.matchedRequirements,
  };
}

/** Порядок задаёт доказательство, а не модель: сначала подтверждённое. */
const STATE_RANK = { observed: 0, 'too-few': 1, 'not-found': 2 } as const;

function byEvidenceThen(rankOf: (role: ProposedRole) => number) {
  return (left: ProposedRole, right: ProposedRole): number => {
    // Ярус доказанности первым: ответы кандидата не могут поднять роль без
    // вакансий над ролью, которую подтвердил пул.
    const tier = STATE_RANK[left.confirmation.state] - STATE_RANK[right.confirmation.state];
    if (tier !== 0) return tier;
    const preference = rankOf(left) - rankOf(right);
    if (preference !== 0) return preference;
    return sampleOf(right) - sampleOf(left) || left.title.localeCompare(right.title);
  };
}

function sampleOf(role: ProposedRole): number {
  return role.confirmation.state === 'not-found' ? 0 : role.confirmation.sampleSize;
}
