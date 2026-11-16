import type {
  CandidateStatusId,
  TodayStatusModule,
  TodayStatusModuleKey,
} from '../../../../shared/candidateStatus';
import { pluralRu } from '../../../../shared/pluralRu';
import type { MatchedVacancyItem } from '../../coach/cabinetTypes';
import type { RoleSkillDemand } from '../../skills/roleSkillDemandApi';
import type { TodayFunnelCounts, TodayNextInterview, TodayQueueItem } from '../../today/todayApi';
import { queueActionTitle, queueDesktopSubtitle } from '../../today/todayFormat';
import { formatCompensationCompact } from '../../vacancies/vacancyCompensation';
import type { IconName } from '../kit';
import { buildNodePath } from '../routes';

/** Адрес ближайшего интервью: раздел сам находит отклик (см. README основы). */
const NEXT_INTERVIEW_PATH = '/app/responses/next/interview';

export interface TodayAction {
  readonly title: string;
  readonly sub: string;
  readonly label: string;
  /** Подпись кнопки в строке на 390. */
  readonly shortLabel: string;
  readonly icon: IconName;
  readonly path: string;
}

type ActionFace = Pick<TodayAction, 'label' | 'shortLabel' | 'icon' | 'path'>;

function responsePath(applicationId: string | undefined): string {
  return applicationId
    ? buildNodePath('o01c', { responseId: applicationId })
    : buildNodePath('o01');
}

function actionFace(item: TodayQueueItem): ActionFace {
  if (item.kind === 'interview') {
    const path = item.applicationId
      ? buildNodePath('i01', { responseId: item.applicationId })
      : NEXT_INTERVIEW_PATH;
    return { label: 'Подготовиться', shortLabel: 'Готовиться', icon: 'play', path };
  }
  if (item.kind === 'linkedin_post') {
    return {
      label: 'Открыть пост',
      shortLabel: 'Открыть',
      icon: 'linkedin',
      path: buildNodePath('a03b'),
    };
  }
  if (item.kind === 'new_vacancy' || item.kind === 'shortlist') {
    const path = item.clusterId
      ? buildNodePath('v04', { vacancyId: item.clusterId })
      : buildNodePath('s07');
    return { label: 'Открыть вакансию', shortLabel: 'Открыть', icon: 'vacancies', path };
  }
  if (item.material === 'cover_letter' && item.applicationId) {
    const path = buildNodePath('o02', { responseId: item.applicationId });
    return { label: 'Проверить письмо', shortLabel: 'Проверить', icon: 'file', path };
  }
  return {
    label: 'Открыть отклик',
    shortLabel: 'Открыть',
    icon: 'send',
    path: responsePath(item.applicationId),
  };
}

/** Строка очереди дня: что сделать и куда ведёт кнопка в новом кабинете. */
export function queueAction(item: TodayQueueItem): TodayAction {
  return { title: queueActionTitle(item), sub: queueDesktopSubtitle(item), ...actionFace(item) };
}

/** «13 откликов → 1 интервью → 1 оффер»; без откликов строки нет. */
export function funnelLine(funnel: TodayFunnelCounts | undefined): string | null {
  if (!funnel?.applied) return null;
  return [
    pluralRu(funnel.applied, ['отклик', 'отклика', 'откликов']),
    `${funnel.interviews ?? 0} интервью`,
    pluralRu(funnel.offers, ['оффер', 'оффера', 'офферов']),
  ].join(' → ');
}

export interface SkillFit {
  readonly title: string;
  readonly role: string;
  readonly have: readonly string[];
  readonly lack: readonly string[];
  /** Текст ⓘ: откуда взяты требования. */
  readonly source: string;
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

/** Частые требования роли: что уже есть в профиле и чего не хватает. */
export function skillFit(demand: RoleSkillDemand | undefined): SkillFit | null {
  if (!demand || demand.skills.length === 0) return null;
  const have = demand.skills.filter((skill) => skill.inProfile).map((skill) => skill.name);
  const lack = demand.skills.filter((skill) => !skill.inProfile).map((skill) => skill.name);
  const total = demand.skills.length;
  const observed = new Date(demand.observedAt);
  const date = Number.isNaN(observed.getTime()) ? '' : `, на ${DAY_MONTH.format(observed)}`;
  const sample = pluralRu(demand.sampleSize, ['вакансии', 'вакансий', 'вакансий']);
  return {
    title: `${have.length} из ${pluralRu(total, ['частого требования', 'частых требований', 'частых требований'])} у вас уже есть`,
    role: demand.roleTitle,
    have,
    lack,
    source: `Частые требования — из ${sample} по роли «${demand.roleTitle}»${date}.`,
  };
}

export interface ApplicationsSummary {
  readonly title: string;
  readonly text: string | null;
}

function interviewMoment(at: string, timeZone: string): string | null {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone }).format(
    date,
  );
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
  return `${day}, ${time}`;
}

/** Модуль «Отклики» вне поиска: сколько откликов идёт и что ближайшее. */
export function applicationsSummary(
  funnel: TodayFunnelCounts | undefined,
  nextInterview: TodayNextInterview | null,
  timeZone: string,
): ApplicationsSummary | null {
  if (!funnel?.applied) return null;
  const moment = nextInterview ? interviewMoment(nextInterview.at, timeZone) : null;
  const place = nextInterview?.company ?? nextInterview?.title;
  return {
    title: `Ваши отклики: ${funnel.applied}`,
    text: moment && place ? `Ближайшее: ${place}, интервью ${moment}.` : null,
  };
}

export interface VacancyRow {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly salary: string;
  /** Совпадение с профилем, %; `null` — оценки ещё нет. */
  readonly fit: number | null;
  readonly path: string;
}

export function vacancyRow(item: MatchedVacancyItem): VacancyRow {
  const { cluster, explanation } = item;
  const percent = explanation.fitView?.result?.coveragePercent;
  return {
    id: cluster.id,
    title: cluster.canonicalTitle,
    sub: [cluster.canonicalCompany, cluster.canonicalLocation].filter(Boolean).join(' · '),
    salary: formatCompensationCompact(cluster.salary),
    fit: typeof percent === 'number' ? Math.round(percent) : null,
    path: buildNodePath('v04', { vacancyId: cluster.id }),
  };
}

/**
 * Модули без данных на сервере не показываем: причина смены профессии,
 * ближайшая встреча и запись результата в профиль (отклонения B650).
 */
const HIDDEN_MODULES: ReadonlySet<TodayStatusModuleKey> = new Set([
  'profession_reason',
  'next_meeting',
  'record_result',
]);

export interface ModuleLayout {
  readonly main: readonly TodayStatusModule[];
  readonly side: readonly TodayStatusModule[];
}

function isSideModule(status: CandidateStatusId, key: TodayStatusModuleKey): boolean {
  if (status === 'job_search') return key === 'profile_question';
  return key === 'applications_summary';
}

/** Левая колонка — главное дня, правая — контекст (как в макетах s03 и s05b). */
export function moduleLayout(
  status: CandidateStatusId,
  modules: readonly TodayStatusModule[],
): ModuleLayout {
  const shown = modules.filter((module) => !HIDDEN_MODULES.has(module.key));
  return {
    main: shown.filter((module) => !isSideModule(status, module.key)),
    side: shown.filter((module) => isSideModule(status, module.key)),
  };
}
