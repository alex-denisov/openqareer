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
  /** Откуда имя: назвала модель по резюме или назвал рынок группой вакансий. */
  readonly origin: 'model' | 'market';
  readonly reason: string | null;
  readonly evidenceRefs: readonly string[];
  readonly confirmation: RoleConfirmation;
}

/** Больше пяти ролей кандидат не сравнивает — он их пролистывает. */
const MAX_PROPOSALS = 5;

export function proposeRoles(input: {
  readonly named: readonly NamedRole[];
  readonly pool: readonly RoleObservation[];
  readonly candidateSkills: readonly string[];
}): ProposedRole[] {
  const groups = groupObservations(input.pool);
  const skills = new Set(
    input.candidateSkills.map((skill) => skill.toLowerCase().trim()),
  );
  const claimed = new Set<string>();

  const fromModel = input.named
    // Роль без опоры на резюме — шум: объяснение обязательно, имя — нет.
    .filter((role) => role.title.trim() && role.reason.trim() && role.evidenceRefs.length > 0)
    .flatMap<ProposedRole>((role) => {
      const key = titleKey(role.title);
      if (!key || claimed.has(key)) return [];
      claimed.add(key);
      const group = groups.get(key);
      return [
        {
          id: `role-${key.replace(/\s+/gu, '-')}`,
          title: role.title.trim(),
          origin: 'model',
          reason: role.reason.trim(),
          evidenceRefs: role.evidenceRefs,
          confirmation: confirmationFor(group, skills),
        },
      ];
    });

  const fromMarket = [...groups.entries()]
    .filter(([key, group]) => !claimed.has(key) && group.items.length >= MIN_ROLE_SAMPLE)
    .map<ProposedRole>(([key, group]) => {
      const described = describeGroup(group, new Set<string>(), skills);
      return {
        id: `role-${key.replace(/\s+/gu, '-')}`,
        title: described.title,
        origin: 'market',
        reason: null,
        evidenceRefs: [],
        confirmation: { state: 'observed', ...withoutIdentity(described) },
      };
    });

  return [...fromModel, ...fromMarket].sort(byEvidence).slice(0, MAX_PROPOSALS);
}

/**
 * Совпадение считается только по требованиям вакансий: пересечение имени роли
 * с самим собой давало бы каждой названной роли лишний балл из воздуха.
 */
function confirmationFor(
  group: RoleGroup | undefined,
  skills: Set<string>,
): RoleConfirmation {
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

function withoutIdentity(
  hypothesis: PoolRoleHypothesis,
): Omit<PoolRoleHypothesis, 'id' | 'title'> {
  return {
    sampleSize: hypothesis.sampleSize,
    observedFrom: hypothesis.observedFrom,
    observedTo: hypothesis.observedTo,
    sources: hypothesis.sources,
    repeatedRequirements: hypothesis.repeatedRequirements,
    matchedRequirements: hypothesis.matchedRequirements,
  };
}

/** Порядок задаёт доказательство, а не модель: сначала подтверждённое. */
const STATE_RANK = { observed: 0, 'too-few': 1, 'not-found': 2 } as const;

function byEvidence(left: ProposedRole, right: ProposedRole): number {
  const rank = STATE_RANK[left.confirmation.state] - STATE_RANK[right.confirmation.state];
  if (rank !== 0) return rank;
  return sampleOf(right) - sampleOf(left) || left.title.localeCompare(right.title);
}

function sampleOf(role: ProposedRole): number {
  return role.confirmation.state === 'not-found' ? 0 : role.confirmation.sampleSize;
}
