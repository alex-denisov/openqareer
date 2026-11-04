import type { FunctionCode } from '../../../shared/roleTaxonomy';
import type { VacancyLevelMatch } from '../../../shared/vacancyMatchOrder';
import { evaluateLevelMatch, LEVEL_RANK, type SeniorityLevel } from '../levelMatcher';
import { normalizeTitleKey } from './normalizeTitleKey';
import { rulesParse } from './rulesParse';

/**
 * Роли кампании → коды функций для смыслового подбора (B267 S3, план §5 п.1).
 * Роль, которую правила не узнали (пусто) или свели к общему `other`, в поиск
 * не идёт — общий якорь дал бы такую же широкую и случайную выдачу, какую
 * смысловой подбор должен убрать.
 */
export function candidateRoleFunctionCodes(targetRoles: readonly string[]): FunctionCode[] {
  const codes = new Set<FunctionCode>();
  for (const role of targetRoles) {
    if (!role.trim()) continue;
    for (const code of rulesParse(role).functions) {
      if (code !== 'other') codes.add(code);
    }
  }
  return [...codes];
}

/**
 * Может ли роль опустить порог уровня своей функции. Роль без признака руководителя (ранг 0) не
 * может: «AI Consultant» открывал руководителю всю функцию, и «Консультант 1С» с «Software Developer»
 * шли в подборку VP, где ворота процента их всё равно отвергали (04.11: 738 строк из 1 217).
 */
function lowersFloor(levelRank: number | null): levelRank is number {
  return levelRank !== null && levelRank >= LEVEL_RANK.lead;
}

/** Рынок ИТ-директора — и руководители ИТ: название равно CIO, а ступень ниже он не теряет. */
function roleFloor(role: string): number | null {
  const { levelRank, roleId } = rulesParse(role);
  return roleId === 'it-ops.cio' ? LEVEL_RANK.head : levelRank;
}

/**
 * Нижняя граница уровня подбора: ступень ниже целевой, но не выше самой
 * младшей руководящей роли кампании. «Head of AI» в кампании C-level — роль
 * уровня Head, и окно ±1 от C-level её отсекало (аудит 01.11). `null` — уровень неизвестен.
 */
export function campaignLevelFloor(
  targetRoles: readonly string[],
  targetLevel: SeniorityLevel | undefined,
): number | null {
  if (!targetLevel) return null;
  const roleRanks = targetRoles.map(roleFloor).filter(lowersFloor);
  return Math.min(LEVEL_RANK[targetLevel] - 1, ...roleRanks);
}

/**
 * Тот же порог, но своя ступень у каждой функции: младшая руководящая роль одной
 * функции не открывает остальные (04.11, из 184 вакансий роли оставалось 33).
 */
export function campaignFunctionLevelFloors(
  targetRoles: readonly string[],
  targetLevel: SeniorityLevel | undefined,
): Partial<Record<FunctionCode, number>> {
  if (!targetLevel) return {};
  const standard = LEVEL_RANK[targetLevel] - 1;
  const floors: Partial<Record<FunctionCode, number>> = {};
  for (const role of targetRoles) {
    const rank = roleFloor(role);
    for (const code of rulesParse(role).functions) {
      floors[code] = Math.min(floors[code] ?? standard, lowersFloor(rank) ? rank : standard);
    }
  }
  return floors;
}

/**
 * Роль специалиста в кампании руководителя не опускает порог, но названная роль остаётся в
 * подборе: ниже порога функции проходит строка, в названии которой она написана.
 */
function campaignSpecialistTitles(
  targetRoles: readonly string[],
  floors: Partial<Record<FunctionCode, number>>,
): Partial<Record<FunctionCode, string[]>> {
  const titles: Partial<Record<FunctionCode, string[]>> = {};
  for (const role of targetRoles) {
    const { functions, levelRank } = rulesParse(role);
    const key = normalizeTitleKey(role);
    if (levelRank !== 0 || !key) continue;
    for (const code of functions) {
      if ((floors[code] ?? 0) > 0) titles[code] = [...(titles[code] ?? []), key];
    }
  }
  return titles;
}

export interface CampaignLevelWindow {
  /** Уровень кандидата неизвестен: окно не сужает. */
  readonly open: boolean;
  readonly ceiling: number;
  readonly floors: Partial<Record<FunctionCode, number>>;
  readonly specialistTitles: Partial<Record<FunctionCode, string[]>>;
}

/** Окно уровня одно на отбор и ворота процента: иначе строка отбирается, а ворота её отвергают. */
export function campaignLevelWindow(
  targetRoles: readonly string[],
  targetLevel: SeniorityLevel | undefined,
): CampaignLevelWindow {
  const floors = campaignFunctionLevelFloors(targetRoles, targetLevel);
  return {
    open: !targetLevel,
    ceiling: targetLevel ? LEVEL_RANK[targetLevel] + 1 : 0,
    floors,
    specialistTitles: campaignSpecialistTitles(targetRoles, floors),
  };
}

/** Строка разбора в окне кампании по той же логике, что `buildSemanticMatchQuery`. */
export function withinCampaignLevels(
  window: CampaignLevelWindow,
  row: {
    readonly titleKey: string;
    readonly functions: readonly string[];
    readonly levelRank: number | null;
  },
): boolean {
  if (window.open || row.levelRank === null) return true;
  const rank = row.levelRank;
  return (row.functions as readonly FunctionCode[]).some((code) => {
    const floor = window.floors[code];
    if (floor === undefined || rank > window.ceiling) return false;
    return (
      rank >= floor ||
      (window.specialistTitles[code] ?? []).some((title) => row.titleKey.includes(title))
    );
  });
}

/**
 * Вердикт ворот уровня: одна функция на ворота процента и на подборку. `undefined` у разбора —
 * названия нет в `title_parse`, тогда уровень читается из самого названия.
 */
export function campaignLevelMatch(
  window: CampaignLevelWindow,
  targetLevel: SeniorityLevel | undefined,
  title: string,
  parsed: { readonly functions: readonly string[]; readonly levelRank: number | null } | undefined,
): VacancyLevelMatch {
  if (targetLevel && parsed) {
    const row = { ...parsed, titleKey: normalizeTitleKey(title) };
    if (withinCampaignLevels(window, row)) return 'match';
  }
  return evaluateLevelMatch(targetLevel, title, parsed?.levelRank);
}
