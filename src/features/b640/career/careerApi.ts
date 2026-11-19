import { getRoleHypotheses } from '../../coach/coachApi';
import {
  getCandidateCampaign,
  updateCampaignRoles,
  type CampaignMetaView,
} from '../../coach/matchedVacancyApi';
import { changeCareerRole } from '../../career-map/careerRoleApi';
import { getCheckedRoles } from '../../skills/roleSkillAssessmentApi';
import { getRoleSkillDemand } from '../../skills/roleSkillDemandApi';
import {
  DEFAULT_CANDIDATE_STATUS,
  type CandidateStatusId,
} from '../../../../shared/candidateStatus';
import { getStatus } from '../profile/statusChoice';
import { buildRoleRows, type RoleRow } from './rolesModel';

/** Всё, что нужно вкладке «Роли»: строки ролей, роли поиска и пробелы в навыках. */
export interface RolesData {
  readonly rows: readonly RoleRow[];
  readonly searchTitles: readonly string[];
  readonly campaign: CampaignMetaView;
  /** Частых требований роли поиска, которых нет в профиле: число для полосы «Проверьте». */
  readonly skillGap: number;
}

const key = (title: string): string => title.trim().toLocaleLowerCase('ru');

/** Пробелы по роли поиска; чтение требований не удалось — полосы просто нет. */
async function readSkillGap(searchTitles: readonly string[]): Promise<number> {
  try {
    const demand = await getRoleSkillDemand();
    const wanted = new Set(searchTitles.map(key));
    const role = demand.roles.find((entry) => wanted.has(key(entry.roleTitle))) ?? demand.roles[0];
    return role ? role.skills.filter((skill) => !skill.inProfile).length : 0;
  } catch {
    return 0;
  }
}

export async function loadRoles(signal: AbortSignal): Promise<RolesData> {
  const [roles, campaign, checked] = await Promise.all([
    getRoleHypotheses(signal),
    getCandidateCampaign(signal),
    getCheckedRoles(signal),
  ]);
  const searchTitles = campaign.roles.value;
  return {
    rows: buildRoleRows(roles, searchTitles, checked),
    searchTitles,
    campaign,
    skillGap: await readSkillGap(searchTitles),
  };
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
