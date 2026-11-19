import { getRoleHypotheses } from '../../coach/coachApi';
import {
  getCandidateCampaign,
  updateCampaignRoles,
  type CampaignMetaView,
} from '../../coach/matchedVacancyApi';
import { changeCareerRole } from '../../career-map/careerRoleApi';
import {
  getCheckedRoles,
  getCurrentRoleSkillAssessment,
} from '../../skills/roleSkillAssessmentApi';
import { getRoleSkillDemand, type RoleSkillDemand } from '../../skills/roleSkillDemandApi';
import {
  DEFAULT_CANDIDATE_STATUS,
  type CandidateStatusId,
} from '../../../../shared/candidateStatus';
import { getStatus } from '../profile/statusChoice';
import { readSelectionTotal } from '../vacancies/list/selectionCount';
import { buildRoleRows, type RoleRow } from './rolesModel';

/** Всё, что нужно вкладке «Роли»: строки ролей, роли поиска и пробелы в навыках. */
export interface RolesData {
  readonly rows: readonly RoleRow[];
  readonly searchTitles: readonly string[];
  readonly campaign: CampaignMetaView;
  /** Число вакансий выбора: единый расчёт со списком «Вакансии»; `null` — не прочитано. */
  readonly selectionTotal: number | null;
}

/** Полоса «Проверьте N навыков»: роль поиска, проверку которой можно начать. */
export interface SkillStripData {
  /** Частых требований роли, которых нет в профиле. */
  readonly gap: number;
  readonly role: string;
}

const key = (title: string): string => title.trim().toLocaleLowerCase('ru');

/** Требования ролей из вакансий; не прочитались — пустой список, экран читается. */
async function readDemand(): Promise<readonly RoleSkillDemand[]> {
  try {
    return (await getRoleSkillDemand()).roles;
  } catch {
    return [];
  }
}

/**
 * Первая роль поиска, у которой проверка навыков готова. Роль, требования которой
 * ещё не собраны или которых мало, в полосу не попадает: иначе «Проверить» ведёт в тупик.
 */
async function readyRole(searchTitles: readonly string[]): Promise<{
  readonly title: string;
  readonly skills: number;
} | null> {
  // Роли спрашиваем разом (B645 s09): по очереди это 5+ запросов подряд до полосы.
  const answers = await Promise.all(
    searchTitles.map((title) => getCurrentRoleSkillAssessment(title).catch(() => null)),
  );
  const index = answers.findIndex((current) => current?.state === 'ready');
  const current = answers[index];
  return current?.state === 'ready'
    ? { title: searchTitles[index]!, skills: current.skills.length }
    : null;
}

const demandOf = (demand: readonly RoleSkillDemand[], title: string) =>
  demand.find((entry) => key(entry.roleTitle) === key(title));

/** Сколько навыков проверить: частые требования роли, которых нет в профиле. */
function gapOf(
  demand: readonly RoleSkillDemand[],
  role: { title: string; skills: number },
): number {
  const entry = demandOf(demand, role.title);
  return entry ? entry.skills.filter((skill) => !skill.inProfile).length : role.skills;
}

/** «Чего не хватает» без данных роли — первый навык из вакансий, которого нет в профиле. */
function withLacks(
  rows: readonly RoleRow[],
  demand: readonly RoleSkillDemand[],
): readonly RoleRow[] {
  return rows.map((row) => {
    if (row.lacks) return row;
    const missing = demandOf(demand, row.title)?.skills.find((skill) => !skill.inProfile);
    return missing ? { ...row, lacks: missing.name } : row;
  });
}

/** Строка «Проверить N навыков» в «Вакансиях» (s07): тот же счёт, что у полосы во вкладке «Роли». */
export async function readSkillGap(
  searchTitles: readonly string[],
): Promise<{ readonly gap: number; readonly role: string | null }> {
  const [ready, demand] = await Promise.all([readyRole(searchTitles), readDemand()]);
  return ready ? { gap: gapOf(demand, ready), role: ready.title } : { gap: 0, role: null };
}

export async function loadRoles(signal: AbortSignal): Promise<RolesData> {
  const [roles, campaign, checked, demand] = await Promise.all([
    getRoleHypotheses(signal),
    getCandidateCampaign(signal),
    getCheckedRoles(signal),
    readDemand(),
  ]);
  const searchTitles = campaign.roles.value;
  return {
    rows: withLacks(buildRoleRows(roles, searchTitles, checked), demand),
    searchTitles,
    campaign,
    selectionTotal: searchTitles.length > 0 ? await readSelectionTotal(searchTitles, signal) : null,
  };
}

/** Полоса навыков догружается после таблицы ролей и её не держит. */
export async function loadSkillStrip(signal: AbortSignal): Promise<SkillStripData | null> {
  const demandRead = readDemand();
  const campaign = await getCandidateCampaign(signal);
  const [ready, demand] = await Promise.all([readyRole(campaign.roles.value), demandRead]);
  return ready ? { gap: gapOf(demand, ready), role: ready.title } : null;
}

/** C04 без роли в адресе: роли поиска и первая из них, проверку которой можно начать. */
export async function loadSkillRoles(signal: AbortSignal): Promise<{
  readonly searchTitles: readonly string[];
  readonly ready: string | null;
}> {
  const campaign = await getCandidateCampaign(signal);
  const searchTitles = campaign.roles.value;
  return { searchTitles, ready: (await readyRole(searchTitles))?.title ?? null };
}

/** Роли поиска целиком: подборка пересчитывается по ним. */
export async function saveSearchRoles(
  titles: readonly string[],
  campaign: CampaignMetaView,
): Promise<readonly string[]> {
  const saved = await updateCampaignRoles(titles, campaign);
  return saved.roles.value;
}

/** «Назвать свою роль»: роль становится ролью поиска. */
export function addOwnRole(title: string): Promise<void> {
  return changeCareerRole('add', title);
}

/** Статус кандидата для выбора экрана; не прочитался — экран как при «Ищу работу». */
export async function loadStatusId(signal: AbortSignal): Promise<CandidateStatusId> {
  try {
    return (await getStatus(signal)).current.status;
  } catch {
    return DEFAULT_CANDIDATE_STATUS;
  }
}
