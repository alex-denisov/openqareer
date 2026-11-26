import {
  candidateStatusTitle,
  TARGET_PROFESSION_MAX_LENGTH,
  type CandidateStatusId,
  type CandidateStatusPreview,
  type StatusChangeOption,
  type TodayStatusModule,
} from '../../shared/candidateStatus';

/** Статус вместе с профессией, которую кандидат назвал для «Меняю профессию». */
export interface StatusChoice {
  readonly status: CandidateStatusId;
  readonly targetProfession: string | null;
}

export interface StatusPreviewContext {
  readonly autoApplyPaused: boolean;
  /** B779: подборка раз в неделю уже включена. */
  readonly weeklySelection?: boolean;
}

/** Отметки кандидата в «Что можно поменять». */
export interface StatusChangeOptions {
  readonly pauseAutoApply?: boolean;
  /** B779: подборка в своей роли раз в неделю; нет поля — как было. */
  readonly weeklySelection?: boolean;
}

interface StatusEffects {
  /** Главное на «Сегодня» при этом статусе — оно же уходит с первого места при смене. */
  readonly todayLead: string;
  readonly career: string;
  readonly modules: readonly TodayStatusModule[];
}

const EFFECTS: Readonly<Record<CandidateStatusId, StatusEffects>> = {
  looking: {
    todayLead: 'Новые вакансии за неделю',
    career: 'Цена вашей роли на рынке — в «Карьере»',
    modules: [
      { key: 'weekly_vacancies', title: 'Новое за неделю' },
      { key: 'applications_summary', title: 'Ваши отклики' },
    ],
  },
  job_search: {
    todayLead: 'Следующее действие по откликам и интервью',
    career: 'Роль поиска и соседние роли — в «Карьере»',
    modules: [
      { key: 'next_action', title: 'Следующее действие' },
      { key: 'applications_summary', title: 'Ваши отклики' },
      { key: 'profile_question', title: 'Один вопрос о профиле' },
    ],
  },
  choosing_role: {
    todayLead: 'Роли по вашему опыту',
    career: 'Сравнение ролей и проверка навыков — в «Карьере»',
    modules: [
      { key: 'role_options', title: 'Роли по вашему опыту' },
      { key: 'role_vacancies', title: 'Вакансии по этой роли' },
    ],
  },
  changing_profession: {
    todayLead: 'Что подходит и чего не хватает',
    career: 'Путь в профессию в «Карьере»',
    modules: [
      { key: 'profession_fit', title: 'Что подходит и чего не хватает' },
      { key: 'profession_reason', title: 'Почему вы меняете профессию' },
      { key: 'profile_question', title: 'Один вопрос о профиле' },
      { key: 'applications_summary', title: 'Ваши отклики' },
    ],
  },
  working: {
    todayLead: 'План 30-60-90 и цели',
    career: 'Рост в роли в «Карьере»',
    modules: [
      { key: 'onboarding_plan', title: 'План на первые 90 дней' },
      { key: 'next_meeting', title: 'Ближайшая встреча' },
      { key: 'record_result', title: 'В профиль: результат' },
    ],
  },
};

/** Ничего не удаляется и не скрывается при любой смене статуса. */
const STAYS: readonly string[] = [
  'Ваши отклики и сохранённые вакансии',
  'Профиль, проверки навыков и история изменений',
  'Меню и все разделы',
];

const PAUSE_AUTO_APPLY_LABEL = 'Поставить автоотклики на паузу';
const WEEKLY_SELECTION_LABEL = 'Подборку в своей роли — раз в неделю';

function sameChoice(from: StatusChoice, to: StatusChoice): boolean {
  return from.status === to.status && from.targetProfession === to.targetProfession;
}

function appearsFor(to: StatusChoice): readonly string[] {
  const effects = EFFECTS[to.status];
  const base = [`${effects.todayLead} — на «Сегодня»`, effects.career];
  return to.status === 'changing_profession'
    ? [...base, `Вакансии новой профессии${to.targetProfession ? `: ${to.targetProfession}` : ''}`]
    : base;
}

function optionsFor(to: StatusChoice, context: StatusPreviewContext): readonly StatusChangeOption[] {
  const weekly: StatusChangeOption = {
    key: 'weeklySelection',
    label: WEEKLY_SELECTION_LABEL,
    checked: context.weeklySelection === true,
  };
  if (context.autoApplyPaused) return [weekly];
  return [
    { key: 'pauseAutoApply', label: PAUSE_AUTO_APPLY_LABEL, checked: to.status === 'working' },
    weekly,
  ];
}

/** «Что изменится» до сохранения: появится, уйдёт, сохранится, что можно поменять. */
export function buildStatusPreview(
  from: StatusChoice,
  to: StatusChoice,
  context: StatusPreviewContext,
): CandidateStatusPreview {
  const unchanged = sameChoice(from, to);
  const sameStatus = from.status === to.status;
  return {
    from: from.status,
    to: to.status,
    title: candidateStatusTitle(to.status, to.targetProfession),
    unchanged,
    appears: unchanged ? [] : appearsFor(to),
    leaves:
      unchanged || sameStatus
        ? []
        : [`С первого места на «Сегодня» уйдёт: ${lowerFirst(EFFECTS[from.status].todayLead)}`],
    stays: STAYS,
    options: unchanged ? [] : optionsFor(to, context),
  };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** При «Работаю» пауза ставится, если кандидат не снял отметку; иначе — только по отметке. */
export function shouldPauseAutoApply(
  status: CandidateStatusId,
  options: StatusChangeOptions,
): boolean {
  if (status === 'working') return options.pauseAutoApply !== false;
  return options.pauseAutoApply === true;
}

export function todayModulesFor(status: CandidateStatusId): readonly TodayStatusModule[] {
  return EFFECTS[status].modules;
}

const DAY_MS = 86_400_000;

function localSecondsSinceMidnight(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string): number => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return part('hour') * 3600 + part('minute') * 60 + part('second');
}

/** «Вернуть прежний» держится до конца дня кандидата — до его ближайшей полуночи. */
export function revertDeadline(now: Date, timezone: string): string {
  const sinceMidnightMs =
    localSecondsSinceMidnight(now, timezone) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - sinceMidnightMs + DAY_MS).toISOString();
}

export function normalizeTargetProfession(
  status: CandidateStatusId,
  value: string | null | undefined,
): string | null {
  if (status !== 'changing_profession' || !value) return null;
  const text = value
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ')
    .trim().slice(0, TARGET_PROFESSION_MAX_LENGTH);
  return text || null;
}
