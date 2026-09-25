/**
 * Кампания = одна явная запись {роль(и), география}, а не сборка из трёх
 * независимых источников (B247, срез 1).
 *
 * Аудит поймал «Product Manager, US» при профиле VP Tech в Дубае:
 * `readMatchProfile` объединяла гипотезы роли, сохранённые поисковые запросы
 * (`vacancySubscriptions`) и черновик резюме без приоритета и без сверки с
 * профилем, а `readSearchRegions` читала географию отдельно. Хуже того — роли,
 * предложенные моделью и ни разу не принятые кандидатом (`status: 'proposed'`),
 * уже задавали подбор.
 *
 * Эта функция — единственное место сведения. Она не читает БД: чтение снимка
 * кандидата и рабочего пространства остаётся на вызывающей стороне
 * (`server/routes/vacancyRoutes.ts`), здесь — только сведение уже прочитанных
 * данных, поэтому она проверяется без sqlite.
 */

export interface CampaignMemoryFact {
  readonly domain: string;
  readonly kind: string;
  readonly statement: string;
  readonly status: 'proposed' | 'confirmed' | 'corrected';
}

export interface StoredCampaignSelection {
  readonly roles: readonly string[];
  readonly regions: readonly string[];
  readonly revision: number;
  readonly updatedAt: string;
}

export type CampaignFieldOrigin = 'explicit' | 'model' | 'profile' | 'default';

export interface CampaignField<T> {
  readonly value: T;
  readonly origin: CampaignFieldOrigin;
}

export interface CampaignDivergenceSide<T> {
  readonly campaign: T;
  readonly profile: T;
}

export interface CampaignDivergence {
  readonly roles: CampaignDivergenceSide<readonly string[]> | null;
  readonly regions: CampaignDivergenceSide<readonly string[]> | null;
}

/**
 * Порог значимости роли (B247, срез 2). Роль кампании с числом вакансий ниже
 * порога — гипотеза, а не результат подбора: баннер «Вакансии» и тег фильтра
 * «Вакансии»/шаг 4 онбординга читают именно этот флаг, не считают заново.
 */
export const ROLE_HYPOTHESIS_THRESHOLD = 8;

export interface RoleHypothesisFlag {
  readonly role: string;
  readonly vacancyCount: number;
  readonly isHypothesis: boolean;
}

/**
 * Помечает каждую роль кампании гипотезой, если по ней найдено меньше
 * `threshold` вакансий. Роль без записи в счётчике считается нулём — молчание
 * счётчика не значит «результат подтверждён», а значит «пока ничего не
 * найдено», и это тоже гипотеза (PRB-016).
 */
export function annotateRoleHypotheses(
  roles: readonly string[],
  vacancyCountsByRole: Readonly<Record<string, number>>,
  threshold: number = ROLE_HYPOTHESIS_THRESHOLD,
): RoleHypothesisFlag[] {
  return roles.map((role) => {
    const vacancyCount = vacancyCountsByRole[role] ?? 0;
    return { role, vacancyCount, isHypothesis: vacancyCount < threshold };
  });
}

export interface CampaignResolution {
  readonly roles: CampaignField<readonly string[]>;
  readonly regions: CampaignField<readonly string[]>;
  readonly divergence: CampaignDivergence;
  /**
   * `undefined`, пока вызывающая сторона не прочитала пул и не посчитала
   * вакансии по ролям: без счёта нечего размечать (см. `annotateRoleHypotheses`).
   */
  readonly roleHypotheses?: readonly RoleHypothesisFlag[];
}

export interface ResolveCampaignInput {
  readonly memory: readonly CampaignMemoryFact[];
  readonly resumeTargetRole?: string | null;
  readonly profileRegions: readonly string[];
  readonly explicit: StoredCampaignSelection | null;
  readonly auto?: import('./campaignRoleSet').StoredAutoCampaign | null;
  /** Число подобранных вакансий на роль кампании — вход порога значимости. */
  readonly vacancyCountsByRole?: Readonly<Record<string, number>>;
}

const ACCEPTED_STATUSES = new Set(['confirmed', 'corrected']);

/**
 * Роли, на которые профиль сам по себе даёт право по умолчанию — принятые
 * кандидатом, а не предложенные моделью и повисшие без ответа (S1, найдено
 * попутно к решению: `role-evidence`/гипотезы без учёта `status` уже задавали
 * подбор). Подтверждённая роль-факт идёт раньше подтверждённой гипотезы,
 * резюме — самый слабый сигнал и идёт последним.
 */
function profileRoles(
  memory: readonly CampaignMemoryFact[],
  resumeTargetRole?: string | null,
): string[] {
  const accepted = memory.filter((entry) => ACCEPTED_STATUSES.has(entry.status));
  const roleEvidence = accepted
    .filter((entry) => entry.domain === 'role-evidence')
    .map((entry) => entry.statement);
  const hypotheses = accepted
    .filter((entry) => entry.domain !== 'role-evidence' && entry.kind === 'hypothesis')
    .map((entry) => entry.statement);
  const resumeTitle = resumeTargetRole?.trim();

  return Array.from(
    new Set(
      [...roleEvidence, ...hypotheses, ...(resumeTitle ? [resumeTitle] : [])].filter(Boolean),
    ),
  );
}

function resolveField(
  explicitValues: readonly string[] | undefined,
  modelValues: readonly string[],
  profileValues: readonly string[],
): CampaignField<readonly string[]> {
  if (explicitValues && explicitValues.length > 0) {
    return { value: explicitValues, origin: 'explicit' };
  }
  if (modelValues.length > 0) {
    return { value: modelValues, origin: 'model' };
  }
  if (profileValues.length > 0) {
    return { value: profileValues, origin: 'profile' };
  }
  return { value: [], origin: 'default' };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((value) => setB.has(value));
}

function divergenceOf(
  field: CampaignField<readonly string[]>,
  profileValues: readonly string[],
): CampaignDivergenceSide<readonly string[]> | null {
  if (field.origin !== 'explicit') return null;
  if (sameSet(field.value, profileValues)) return null;
  return { campaign: field.value, profile: profileValues };
}

export function resolveCampaign(input: ResolveCampaignInput): CampaignResolution {
  const derivedRoles = profileRoles(input.memory, input.resumeTargetRole);
  const derivedRegions = input.profileRegions;
  const modelRoles = input.auto?.roles.map((role) => role.title) ?? [];

  const roles = resolveField(input.explicit?.roles, modelRoles, derivedRoles);
  const regions = resolveField(input.explicit?.regions, [], derivedRegions);

  return {
    roles,
    regions,
    divergence: {
      roles: divergenceOf(roles, derivedRoles),
      regions: divergenceOf(regions, derivedRegions),
    },
    ...(input.vacancyCountsByRole
      ? { roleHypotheses: annotateRoleHypotheses(roles.value, input.vacancyCountsByRole) }
      : {}),
  };
}
