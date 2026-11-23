import { getRoleHypotheses } from '../../coach/coachApi';
import {
  getCandidateCampaign,
  updateCampaignRoles,
  type CampaignMetaView,
} from '../../coach/matchedVacancyApi';
import { changeCareerRole } from '../../career-map/careerRoleApi';
import { skillKey } from '../../career-map/roleHypothesisAdapter';
import {
  getCheckedRoles,
  getCurrentRoleSkillAssessment,
  type RoleSkillAssessmentCurrent,
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
type Answer = RoleSkillAssessmentCurrent | null;

// Роли спрашиваем разом (B645 s09): по очереди это 5+ запросов подряд до полосы.
function readAnswers(searchTitles: readonly string[]): Promise<readonly Answer[]> {
  return Promise.all(
    searchTitles.map((title) => getCurrentRoleSkillAssessment(title).catch(() => null)),
  );
}

function pickReady(
  searchTitles: readonly string[],
  answers: readonly Answer[],
  orChecked: boolean,
): { readonly title: string; readonly skills: number } | null {
  const index = answers.findIndex((current) => current?.state === 'ready');
  const current = answers[index];
  if (current?.state === 'ready') return { title: searchTitles[index]!, skills: current.skills.length };
  if (!orChecked) return null;
  // B645 s07: пройденная проверка — не тупик: ссылка ведёт к её результату и повтору,
  // число — частые требования роли, которых нет в профиле (без данных спроса строки нет).
  const checked = answers.findIndex((answer) => answer?.state === 'result');
  return checked >= 0 ? { title: searchTitles[checked]!, skills: 0 } : null;
}

async function readyRole(
  searchTitles: readonly string[],
  orChecked = false,
): Promise<{
  readonly title: string;
  readonly skills: number;
} | null> {
  return pickReady(searchTitles, await readAnswers(searchTitles), orChecked);
}

const BLOCKED: ReadonlySet<RoleSkillAssessmentCurrent['state']> = new Set([
  'role_not_selected',
  'source_unavailable',
  'too_few_vacancies',
  'insufficient_requirements',
  'focus_insufficient',
]);

/** B726: роль, проверка которой откроется; непрочитанную не прячем — ошибка сети не повод. */
const opensCheck = (answer: Answer) => answer === null || !BLOCKED.has(answer.state);

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
    const confirmed = new Set(row.confirmedNames.map(skillKey));
    const missing = demandOf(demand, row.title)?.skills.find(
      (skill) => !skill.inProfile && !confirmed.has(skillKey(skill.name)),
    );
    return missing ? { ...row, lacks: missing.name } : row;
  });
}

/** Строка «Проверить N навыков» в «Вакансиях» (s07): тот же счёт, что у полосы во вкладке «Роли». */
export async function readSkillGap(
  searchTitles: readonly string[],
): Promise<{ readonly gap: number; readonly role: string | null }> {
  const [ready, demand] = await Promise.all([readyRole(searchTitles, true), readDemand()]);
  return ready ? { gap: gapOf(demand, ready), role: ready.title } : { gap: 0, role: null };
}

export async function loadRoles(signal: AbortSignal): Promise<RolesData> {
  const [roles, campaign, checked, demand] = await Promise.all([
    getRoleHypotheses(signal, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    getCandidateCampaign(signal),
    getCheckedRoles(signal),
    readDemand(),
  ]);
  const searchTitles = campaign.roles.value;
  return {
    rows: withLacks(buildRoleRows(roles, searchTitles, checked, campaign.titlesRu), demand),
    searchTitles,
    campaign,
  };
}

/**
 * Число вакансий выбора: единый расчёт со списком «Вакансии»; `null` — не прочитано.
 * B768: читается отдельно — таблица ролей его не ждёт (на проде запрос шёл 3,6 с).
 */
export function loadSelectionTotal(
  titles: readonly string[],
  signal: AbortSignal,
): Promise<number | null> {
  return titles.length > 0 ? readSelectionTotal(titles, signal) : Promise.resolve(null);
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
  /** Роли поиска, проверку которых можно открыть: выбор на месте не ведёт в тупик. */
  readonly checkable: readonly string[];
  readonly ready: string | null;
  readonly titlesRu: Readonly<Record<string, string>>;
}> {
  const campaign = await getCandidateCampaign(signal);
  const titlesRu = campaign.titlesRu ?? {};
  const all = campaign.roles.value;
  const allAnswers = await readAnswers(all);
  const picked = onePerLabel(all, allAnswers, titlesRu);
  const searchTitles = picked.map((index) => all[index]!);
  const answers = picked.map((index) => allAnswers[index] ?? null);
  return {
    searchTitles,
    checkable: searchTitles.filter((_, index) => opensCheck(answers[index] ?? null)),
    ready: pickReady(searchTitles, answers, false)?.title ?? null,
    titlesRu,
  };
}

/**
 * B767: варианты одной роли с одним русским названием — одна роль на выбор. Остаётся
 * вариант с пройденной проверкой, иначе первый; место — первого варианта.
 */
function onePerLabel(
  titles: readonly string[],
  answers: readonly Answer[],
  titlesRu: Readonly<Record<string, string>>,
): readonly number[] {
  const byLabel = new Map<string, number[]>();
  titles.forEach((title, index) => {
    const label = key(titlesRu[title] ?? title);
    byLabel.set(label, [...(byLabel.get(label) ?? []), index]);
  });
  return [...byLabel.values()].map(
    (group) => group.find((index) => answers[index]?.state === 'result') ?? group[0]!,
  );
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
