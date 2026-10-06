/**
 * «Какие роли мне подходят» — задания парного выбора (B180, срез 3).
 *
 * Метод переписан относительно шкалы 1..5, которая стояла в продукте раньше.
 * Шкала Ликерта на восьми абстрактных свойствах ломается тремя способами
 * сразу: согласие ради согласия, социальная желательность («лидерство»
 * завышают все) и разный личный масштаб шкалы — в итоге направления
 * различаются стилем ответа, а не содержанием.
 *
 * Парный принудительный выбор это лечит: оба варианта выбрать нельзя, шкала
 * исчезает как источник шума, и каждый ответ несёт информацию о **порядке** —
 * именно его инструмент и строит.
 *
 * Три правила, которые здесь важнее кода:
 *
 * 1. **Счёт, а не модель:** доля = сколько раз выбрано / в скольких заданиях
 *    предлагалось. Ни весов, ни нормировки, ни 0–100.
 * 2. **Никакого сводного балла.** «Итога прохождения» не существует: продукт
 *    не оценивает человека.
 * 3. **Гейт различимости.** Если разрыв между первым и третьим видом работы
 *    меньше порога, инструмент обязан отказаться ранжировать. Отказ — законный
 *    исход, а не поломка.
 *
 * Формулировки хранятся **вместе с ключом** и версионируются вместе с ним:
 * когда слова живут в интерфейсе, а числа в домене, смена слов молча меняет
 * смысл всех сохранённых результатов.
 */

import { pluralRu } from './pluralRu';

export const WORK_PREFERENCE_KEY_VERSION = 'work-preferences-pairs-v1';

/** Виды работы, а не должности: тест на восьми заданиях различает именно их. */
export const WORK_FAMILIES = [
  { code: 'СП', name: 'Создание и постройка', about: 'разработка, инженерия, ремесло' },
  { code: 'РР', name: 'Разбор и расчёт', about: 'анализ, данные, финансы, качество' },
  { code: 'ПП', name: 'Порядок и поток', about: 'операции, логистика, процессы' },
  { code: 'ЛД', name: 'Люди и договорённости', about: 'продажи, партнёрства, закупки' },
  { code: 'ЗО', name: 'Забота и обучение', about: 'поддержка, преподавание, уход' },
  { code: 'ЗФ', name: 'Замысел и форма', about: 'дизайн, контент, креатив' },
  { code: 'НН', name: 'Неопределённость и направление', about: 'исследование, продукт, стратегия' },
  { code: 'РМ', name: 'Руки и место', about: 'полевые, монтажные, производственные работы' },
] as const;

export type WorkFamilyCode = (typeof WORK_FAMILIES)[number]['code'];

export interface WorkPreferenceOption {
  readonly id: string;
  readonly text: string;
  /** Ровно одно семейство на вариант: иначе подсчёт нельзя показать целиком. */
  readonly family: WorkFamilyCode;
}

export interface WorkPreferenceTask {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly [WorkPreferenceOption, WorkPreferenceOption];
  /**
   * Обратный ключ: выбранное — то, чего человек избегает, поэтому выбор
   * засчитывается **противоположному** семейству. Помечено в данных явно,
   * иначе через полгода логику никто не восстановит.
   */
  readonly reverseKeyed?: true;
}

/**
 * Двенадцать заданий, по два варианта. Каждое семейство предлагается ровно
 * трижды — сбалансированность проверяется тестом, а не договорённостью.
 *
 * Двенадцать, а не восемь: на восьми заданиях у семейства максимум два выбора,
 * и разрыв между первым и третьим в два выбора становится почти недостижим —
 * инструмент отказывался бы ранжировать всегда, что так же нечестно, как
 * ранжировать шум. Восемь заданий взяты из записки эксперта дословно, четыре
 * добавлены так, чтобы каждое семейство получило третью встречу.
 *
 * Формулировки намеренно без офисного крена: продукт «для людей разных
 * профессий», у которого все восемь пунктов про митинги и дашборды, существует
 * только на словах.
 */
export const WORK_PREFERENCE_TASKS: readonly WorkPreferenceTask[] = [
  {
    id: 'monday',
    prompt: 'Понедельник, девять утра. Что возьмёте первым?',
    options: [
      {
        id: 'monday-queue',
        text: 'Разобрать очередь из сорока заявок и к вечеру сдать её пустой.',
        family: 'ПП',
      },
      {
        id: 'monday-why',
        text: 'Понять, почему заявок стало сорок вместо пятнадцати, хотя причину никто не знает.',
        family: 'НН',
      },
    ],
  },
  {
    id: 'half-done',
    prompt: 'Задача решена наполовину. Что дальше приятнее?',
    options: [
      {
        id: 'half-done-finish',
        text: 'Довести решение до состояния, когда оно работает без вас.',
        family: 'СП',
      },
      {
        id: 'half-done-agree',
        text: 'Договориться с тремя людьми, чтобы каждый сделал свою часть.',
        family: 'ЛД',
      },
    ],
  },
  {
    id: 'day-done',
    prompt: 'Что к концу дня даёт ощущение сделанной работы?',
    options: [
      {
        id: 'day-done-numbers',
        text: 'Сошёлся расчёт, который до этого не сходился.',
        family: 'РР',
      },
      {
        id: 'day-done-person',
        text: 'Человек, который не понимал, — понял.',
        family: 'ЗО',
      },
    ],
  },
  {
    id: 'explain',
    prompt: 'Нужно объяснить сложное. Вы скорее…',
    options: [
      {
        id: 'explain-form',
        text: 'придумаете форму: как показать, чтобы стало ясно с первого взгляда.',
        family: 'ЗФ',
      },
      {
        id: 'explain-check',
        text: 'проверите, что каждая цифра верна и её можно перепроверить.',
        family: 'РР',
      },
    ],
  },
  {
    id: 'shift',
    prompt: 'Выберите смену.',
    options: [
      {
        id: 'shift-site',
        text: 'Восемь часов на объекте: своими руками, результат видно к вечеру.',
        family: 'РМ',
      },
      {
        id: 'shift-schedule',
        text: 'Восемь часов за расписанием объектов, чтобы у восьми бригад всё сошлось.',
        family: 'ПП',
      },
    ],
  },
  {
    id: 'worse',
    prompt: 'Что хуже?',
    reverseKeyed: true,
    options: [
      {
        id: 'worse-build-unneeded',
        text: 'Месяц строить то, что окажется никому не нужным.',
        family: 'СП',
      },
      {
        id: 'worse-research-nothing',
        text: 'Месяц выяснять, что нужно, и ничего за месяц не построить.',
        family: 'НН',
      },
    ],
  },
  {
    id: 'people',
    prompt: 'Оба варианта про людей. Что ближе?',
    options: [
      {
        id: 'people-deal',
        text: 'Довести переговоры до «да» там, где сначала было «нет».',
        family: 'ЛД',
      },
      {
        id: 'people-grow',
        text: 'Довести человека до самостоятельности там, где сначала он не мог.',
        family: 'ЗО',
      },
    ],
  },
  {
    id: 'easier',
    prompt: 'Где вам легче?',
    options: [
      {
        id: 'easier-touch',
        text: 'Там, где к концу дня можно потрогать сделанное.',
        family: 'РМ',
      },
      {
        id: 'easier-new',
        text: 'Там, где к концу дня есть вариант, которого раньше никто не предлагал.',
        family: 'ЗФ',
      },
    ],
  },
  {
    id: 'week',
    prompt: 'Что охотнее взяли бы на неделю?',
    options: [
      {
        id: 'week-build',
        text: 'Собрать работающий стенд, которого до вас не было.',
        family: 'СП',
      },
      {
        id: 'week-figure-out',
        text: 'Разобраться, почему цифры в двух отчётах не сходятся, и найти где.',
        family: 'РР',
      },
    ],
  },
  {
    id: 'end-of-shift',
    prompt: 'Смена закончилась. Что приятнее увидеть?',
    options: [
      {
        id: 'end-of-shift-schedule',
        text: 'Все заказы прошли по графику, ни один не потерялся.',
        family: 'ПП',
      },
      {
        id: 'end-of-shift-newcomer',
        text: 'Новичок, которого вы учили, отработал смену сам.',
        family: 'ЗО',
      },
    ],
  },
  {
    id: 'one-hour',
    prompt: 'У вас час и одна попытка. Что сделаете?',
    options: [
      {
        id: 'one-hour-persuade',
        text: 'Придёте к тому, кто решает, и договоритесь лично.',
        family: 'ЛД',
      },
      {
        id: 'one-hour-show',
        text: 'Сделаете так, чтобы за вас сказала сама вещь: образец, макет, витрина.',
        family: 'ЗФ',
      },
    ],
  },
  {
    id: 'first-day',
    prompt: 'Первый день на новом месте. Что легче?',
    options: [
      {
        id: 'first-day-open',
        text: 'Никто не знает, чем именно вы будете заниматься, — и это придумаете вы.',
        family: 'НН',
      },
      {
        id: 'first-day-plot',
        text: 'Вам показали участок, инструмент и норму — и вы начали.',
        family: 'РМ',
      },
    ],
  },
];

/** Больше двух исключений — это уже не «точно нет», а выбор за инструмент. */
export const MAX_EXCLUDED_FAMILIES = 2;

/**
 * Разрыв между первым и третьим видом работы, ниже которого ранжировать
 * нельзя. Значение стартовое и подлежит калибровке на собственных ответах.
 */
export const DISCRIMINATION_GAP = 2;

/** Края распределения устойчивы, середина — шум. */
const RANKED_LIMIT = 3;

export interface WorkPreferenceAnswer {
  readonly taskId: string;
  readonly optionId: string;
}

export interface WorkFamilyCount {
  readonly family: WorkFamilyCode;
  readonly name: string;
  /** Сколько раз выбрано. */
  readonly value: number;
  /** В скольких заданиях предлагалось — знаменатель, который видно. */
  readonly total: number;
  /** Из чего сложено число: кандидат обязан уметь пересчитать его глазами. */
  readonly basis: string;
}

export interface WorkPreferenceResult {
  readonly keyVersion: typeof WORK_PREFERENCE_KEY_VERSION;
  /** Сколько заданий действительно засчитано. */
  readonly answered: number;
  readonly counts: readonly WorkFamilyCount[];
  /** Виды работы, которые кандидат назвал «точно нет». */
  readonly excluded: readonly WorkFamilyCode[];
  /**
   * Разделили ли ответы направления. `false` — законный исход: значит выбор
   * надо делать по фактам опыта и по рынку, а не по предпочтениям.
   */
  readonly discriminates: boolean;
  /** Только края распределения и только когда они различимы. */
  readonly ranked: readonly WorkFamilyCount[];
}

export function scoreWorkPreferences(input: {
  readonly answers: readonly WorkPreferenceAnswer[];
  readonly excluded: readonly WorkFamilyCode[];
}): WorkPreferenceResult {
  const excluded = input.excluded.slice(0, MAX_EXCLUDED_FAMILIES);
  const chosen = new Map<WorkFamilyCode, number>();
  const offered = new Map<WorkFamilyCode, number>();
  let answered = 0;

  for (const family of WORK_FAMILIES) {
    chosen.set(family.code, 0);
    offered.set(family.code, 0);
  }
  for (const task of WORK_PREFERENCE_TASKS) {
    for (const option of task.options) {
      offered.set(option.family, (offered.get(option.family) ?? 0) + 1);
    }
  }

  for (const answer of input.answers) {
    const task = WORK_PREFERENCE_TASKS.find((item) => item.id === answer.taskId);
    const picked = task?.options.find((option) => option.id === answer.optionId);
    if (!task || !picked) continue;
    answered += 1;
    // Обратный ключ: выбранное — то, чего человек избегает.
    const credited = task.reverseKeyed
      ? task.options.find((option) => option.id !== picked.id)
      : picked;
    if (credited) chosen.set(credited.family, (chosen.get(credited.family) ?? 0) + 1);
  }

  const counts = WORK_FAMILIES.map<WorkFamilyCount>((family) => {
    const value = chosen.get(family.code) ?? 0;
    const total = offered.get(family.code) ?? 0;
    return {
      family: family.code,
      name: family.name,
      value,
      total,
      basis: `выбрали ${pluralRu(value, ['раз', 'раза', 'раз'])} из ${total}, когда это предлагалось`,
    };
  });

  const rankable = counts
    .filter((count) => !excluded.includes(count.family))
    .sort(
      (left: WorkFamilyCount, right: WorkFamilyCount) =>
        right.value - left.value || left.name.localeCompare(right.name),
    );
  const discriminates =
    rankable.length >= RANKED_LIMIT &&
    rankable[0].value - rankable[RANKED_LIMIT - 1].value >= DISCRIMINATION_GAP;

  return {
    keyVersion: WORK_PREFERENCE_KEY_VERSION,
    answered,
    counts,
    excluded,
    discriminates,
    // Отказ ранжировать — законный исход, и он честнее выдуманного порядка.
    ranked: discriminates ? rankable.slice(0, RANKED_LIMIT) : [],
  };
}

/**
 * Профиль ограничений кандидата (Decision Profile & Hard Constraints, US-03.3 / B384).
 *
 * Жёсткие условия поиска работы:
 * - Гражданство и налоговый/миграционный статус
 * - Подтверждённые языки (с контекстом, без абстрактных самооценок)
 * - Допустимые форматы работы (домашний рынок, удалёнка из РФ, удалёнка из-за рубежа, офис, релокация)
 * - Зарплатный пол (compensation floor)
 * - Финансовая подушка (в месяцах)
 *
 * Конфиденциальность:
 * Данные строго конфиденциальны и служат ТОЛЬКО личным фильтром подборки.
 * Никогда не передаются в публичные профили, работодателям и во внешние выгрузки.
 */

export const DECISION_WORK_FORMATS = [
  { id: 'home_market', label: 'Домашний рынок (РФ)' },
  { id: 'remote_home', label: 'Удалёнка из РФ' },
  { id: 'remote_abroad', label: 'Удалёнка из-за рубежа' },
  { id: 'office', label: 'Офис' },
  { id: 'relocation', label: 'Релокация' },
] as const;

export type DecisionWorkFormatId = (typeof DECISION_WORK_FORMATS)[number]['id'];

export interface CandidateDecisionLanguage {
  readonly language: string;
  readonly level: string;
  readonly certified?: boolean;
  readonly context?: string;
}

export interface CandidateDecisionProfile {
  readonly citizenship: readonly string[];
  readonly taxStatus?: string;
  readonly languages: readonly CandidateDecisionLanguage[];
  readonly workFormats: readonly DecisionWorkFormatId[];
  readonly salaryFloor?: number;
  readonly salaryCurrency?: string;
  readonly cushionMonths?: number;
  readonly hasFamily?: boolean;
  readonly updatedAt?: string;
}

export const DEFAULT_DECISION_PROFILE: CandidateDecisionProfile = {
  citizenship: [],
  taxStatus: '',
  languages: [],
  workFormats: [],
  salaryFloor: undefined,
  salaryCurrency: 'RUB',
  cushionMonths: undefined,
  hasFamily: false,
};

export const DECISION_PROFILE_STORAGE_KEY = 'openqareer.decision-profile.v1';

export const CONFIDENTIAL_DECISION_KEYS = [
  'salaryFloor',
  'salaryCurrency',
  'cushionMonths',
  'citizenship',
  'taxStatus',
  'hasFamily',
] as const;

export function isDecisionProfileConfidential(key: string): boolean {
  return CONFIDENTIAL_DECISION_KEYS.includes(key as (typeof CONFIDENTIAL_DECISION_KEYS)[number]);
}

/**
 * Очищает данные для экспорта третьим лицам: ни одно конфиденциальное поле
 * профиля ограничений не должно попасть во внешний JSON или выгрузку.
 */
export function sanitizeForThirdPartyExport<T extends Record<string, unknown>>(payload: T): T {
  const result = { ...payload };
  for (const key of CONFIDENTIAL_DECISION_KEYS) {
    delete (result as Record<string, unknown>)[key];
  }
  delete (result as Record<string, unknown>).decisionProfile;
  if ('workPreferences' in result && typeof result.workPreferences === 'object' && result.workPreferences !== null) {
    const wp = { ...(result.workPreferences as Record<string, unknown>) };
    for (const key of CONFIDENTIAL_DECISION_KEYS) {
      delete wp[key];
    }
    delete wp.decisionProfile;
    (result as Record<string, unknown>).workPreferences = wp;
  }
  return result;
}

function matchesSalaryFloor(
  salary: { readonly from?: number; readonly to?: number; readonly currency?: string } | undefined,
  salaryFloor: number | undefined,
  _currency?: string,
): boolean {
  if (!salaryFloor || salaryFloor <= 0) return true;
  // Пустые поля не режут подборку: вакансия без указанной зарплаты не исключается вслепую.
  if (!salary || (salary.from === undefined && salary.to === undefined)) {
    return true;
  }
  const maxCompensation = salary.to ?? salary.from;
  if (maxCompensation !== undefined && maxCompensation < salaryFloor) {
    return false;
  }
  return true;
}

function matchesWorkFormat(
  isRemote: boolean | undefined,
  formats: readonly DecisionWorkFormatId[],
): boolean {
  if (!formats || formats.length === 0) return true;
  const allowsRemote = formats.includes('remote_home') || formats.includes('remote_abroad');
  const allowsOffice = formats.includes('office') || formats.includes('home_market');
  if (allowsRemote && !allowsOffice && !isRemote) return false;
  if (allowsOffice && !allowsRemote && isRemote) return false;
  return true;
}

export function matchesDecisionProfile(
  cluster: {
    readonly isRemote?: boolean;
    readonly salary?: { readonly from?: number; readonly to?: number; readonly currency?: string };
    readonly companyFeatures?: { readonly country?: string };
    readonly canonicalLocation?: string;
  },
  profile?: CandidateDecisionProfile | null,
): boolean {
  if (!profile) return true;
  if (!matchesSalaryFloor(cluster.salary, profile.salaryFloor, profile.salaryCurrency)) {
    return false;
  }
  if (!matchesWorkFormat(cluster.isRemote, profile.workFormats)) {
    return false;
  }
  return true;
}

export function filterVacanciesByDecisionProfile<
  T extends {
    readonly cluster: {
      readonly isRemote?: boolean;
      readonly salary?: { readonly from?: number; readonly to?: number; readonly currency?: string };
      readonly companyFeatures?: { readonly country?: string };
      readonly canonicalLocation?: string;
    };
  },
>(items: readonly T[], profile?: CandidateDecisionProfile | null): T[] {
  if (!profile) return [...items];
  return items.filter((item) => matchesDecisionProfile(item.cluster, profile));
}

export function loadDecisionProfile(storage?: { getItem(key: string): string | null }): CandidateDecisionProfile {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const raw = s?.getItem(DECISION_PROFILE_STORAGE_KEY);
    if (!raw) return DEFAULT_DECISION_PROFILE;
    const parsed = JSON.parse(raw);
    return {
      citizenship: Array.isArray(parsed.citizenship) ? parsed.citizenship : [],
      taxStatus: typeof parsed.taxStatus === 'string' ? parsed.taxStatus : '',
      languages: Array.isArray(parsed.languages) ? parsed.languages : [],
      workFormats: Array.isArray(parsed.workFormats) ? parsed.workFormats : [],
      salaryFloor: typeof parsed.salaryFloor === 'number' ? parsed.salaryFloor : undefined,
      salaryCurrency: typeof parsed.salaryCurrency === 'string' ? parsed.salaryCurrency : 'RUB',
      cushionMonths: typeof parsed.cushionMonths === 'number' ? parsed.cushionMonths : undefined,
      hasFamily: Boolean(parsed.hasFamily),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
    };
  } catch {
    return DEFAULT_DECISION_PROFILE;
  }
}

export function saveDecisionProfile(
  profile: CandidateDecisionProfile,
  storage?: { setItem(key: string, value: string): void },
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    s?.setItem(DECISION_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage write failure
  }
}

