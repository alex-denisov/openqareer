/**
 * Калибровочный опрос стратега (B383, US-03.1): один из пяти векторов
 * перехода, антицели и границы компромиссов. Вектор — гипотеза, пока
 * кандидат явно не подтвердил «Стратегический фокус поиска».
 */

export type VectorId = 'status_scale' | 'stable_move' | 'industry_pivot' | 'refocus' | 'relocation';

export interface CareerVector {
  readonly id: VectorId;
  readonly label: string;
  readonly summary: string;
}

export const CAREER_VECTORS: readonly CareerVector[] = [
  {
    id: 'status_scale',
    label: 'Статус и масштаб',
    summary: 'Тот же уровень или выше, компания крупнее.',
  },
  {
    id: 'stable_move',
    label: 'Стабильный переход',
    summary: 'То же дело в комфортных условиях и с ростом дохода на 20–30 %.',
  },
  {
    id: 'industry_pivot',
    label: 'Смена отрасли',
    summary: 'Перенести опыт в другую сферу, при необходимости пересмотрев уровень.',
  },
  {
    id: 'refocus',
    label: 'Смена фокуса',
    summary: 'Меньше управления людьми, больше работы своими руками или другой трек.',
  },
  { id: 'relocation', label: 'Переезд в другую страну', summary: 'Искать работу с переездом.' },
];

export interface VectorOption {
  readonly id: string;
  readonly text: string;
  readonly vector: VectorId;
  readonly weight: number;
}

export interface VectorQuestion {
  readonly id: string;
  readonly text: string;
  readonly options: readonly VectorOption[];
}

const opt = (id: string, text: string, vector: VectorId, weight: number): VectorOption => ({
  id,
  text,
  vector,
  weight,
});

export const VECTOR_QUESTIONS: readonly VectorQuestion[] = [
  {
    id: 'priority',
    text: 'Что для вас важнее всего в следующей работе?',
    options: [
      opt('priority_scale', 'Больше ответственности и масштаба', 'status_scale', 3),
      opt('priority_stable', 'Спокойные условия и рост дохода', 'stable_move', 3),
      opt('priority_field', 'Попробовать другую отрасль', 'industry_pivot', 3),
      opt('priority_craft', 'Меньше управлять, больше делать самому', 'refocus', 3),
      opt('priority_country', 'Жить и работать в другой стране', 'relocation', 3),
    ],
  },
  {
    id: 'company',
    text: 'Какая компания вам подходит?',
    options: [
      opt('company_bigger', 'Крупнее и известнее нынешней', 'status_scale', 2),
      opt('company_same', 'Похожая по размеру и зрелости', 'stable_move', 2),
      opt('company_any', 'Размер неважен, важна сфера', 'industry_pivot', 2),
      opt('company_small', 'Небольшая команда, где видно свой вклад', 'refocus', 2),
      opt('company_abroad', 'Компания в другой стране', 'relocation', 2),
    ],
  },
  {
    id: 'change',
    text: 'Что вы готовы изменить?',
    options: [
      opt('change_level', 'Взять на себя больше, чем сейчас', 'status_scale', 2),
      opt('change_employer', 'Только работодателя', 'stable_move', 2),
      opt('change_field', 'Отрасль, сохранив уровень опыта', 'industry_pivot', 2),
      opt('change_role', 'Роль: меньше людей, больше предмета', 'refocus', 2),
      opt('change_country', 'Страну проживания', 'relocation', 3),
    ],
  },
  {
    id: 'result',
    text: 'Через год я хочу сказать:',
    options: [
      opt('result_position', 'Я занимаю заметную позицию', 'status_scale', 2),
      opt('result_money', 'Я зарабатываю больше и спокойнее', 'stable_move', 2),
      opt('result_new', 'Я работаю в новом для меня деле', 'industry_pivot', 2),
      opt('result_hands', 'Я снова занимаюсь самим делом', 'refocus', 2),
      opt('result_moved', 'Я устроился в новой стране', 'relocation', 2),
    ],
  },
];

export interface Compromises {
  readonly grade: 'none' | 'one_step';
  readonly salary: 'none' | 'up_to_10' | 'up_to_20';
}

export interface VectorAnswers {
  /** questionId → optionId */
  readonly choices: Readonly<Record<string, string>>;
  readonly antiGoals: readonly string[];
  readonly compromises: Compromises;
}

export interface SearchFocus {
  readonly status: 'hypothesis' | 'confirmed';
  readonly vector: VectorId | null;
  readonly runnerUp: VectorId | null;
  readonly confidence: 'none' | 'close' | 'clear';
  readonly reasons: readonly string[];
  readonly antiGoals: readonly string[];
  readonly compromises: Compromises;
  readonly confirmedAt: string | null;
}

const CLEAR_MARGIN = 2;
const ANTI_GOAL_MAX_LENGTH = 120;
const ANTI_GOAL_MAX_COUNT = 10;

function scoreVectors(choices: Readonly<Record<string, string>>): {
  scores: Map<VectorId, number>;
  reasons: Map<VectorId, string[]>;
} {
  const scores = new Map<VectorId, number>();
  const reasons = new Map<VectorId, string[]>();
  for (const question of VECTOR_QUESTIONS) {
    const option = question.options.find((o) => o.id === choices[question.id]);
    if (!option) continue;
    scores.set(option.vector, (scores.get(option.vector) ?? 0) + option.weight);
    reasons.set(option.vector, [...(reasons.get(option.vector) ?? []), option.text]);
  }
  return { scores, reasons };
}

function cleanAntiGoals(raw: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const text = item.trim().slice(0, ANTI_GOAL_MAX_LENGTH);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= ANTI_GOAL_MAX_COUNT) break;
  }
  return result;
}

export function buildSearchFocus(answers: VectorAnswers): SearchFocus {
  const { scores, reasons } = scoreVectors(answers.choices);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const base = {
    status: 'hypothesis' as const,
    antiGoals: cleanAntiGoals(answers.antiGoals),
    compromises: answers.compromises,
    confirmedAt: null,
  };
  if (!top) return { ...base, vector: null, runnerUp: null, confidence: 'none', reasons: [] };
  const close = Boolean(second) && top[1] - second[1] < CLEAR_MARGIN;
  return {
    ...base,
    vector: top[0],
    runnerUp: second ? second[0] : null,
    confidence: close ? 'close' : 'clear',
    reasons: reasons.get(top[0]) ?? [],
  };
}

export function confirmSearchFocus(focus: SearchFocus, now: Date): SearchFocus {
  if (!focus.vector) throw new Error('Нельзя подтвердить фокус поиска без выбранного вектора');
  return { ...focus, status: 'confirmed', confirmedAt: now.toISOString() };
}

export interface CampaignBias {
  readonly levelShift: 'same' | 'same_or_higher' | 'one_step_down_allowed';
  readonly keepIndustry: boolean;
  readonly widenGeography: boolean;
}

/** Как фокус влияет на роли кампании. Снижение уровня — только по согласию кандидата. */
export function campaignBias(focus: SearchFocus): CampaignBias {
  const gradeOk = focus.compromises.grade === 'one_step';
  switch (focus.vector) {
    case 'status_scale':
      return { levelShift: 'same_or_higher', keepIndustry: true, widenGeography: false };
    case 'industry_pivot':
      return {
        levelShift: gradeOk ? 'one_step_down_allowed' : 'same',
        keepIndustry: false,
        widenGeography: false,
      };
    case 'refocus':
      return {
        levelShift: gradeOk ? 'one_step_down_allowed' : 'same',
        keepIndustry: true,
        widenGeography: false,
      };
    case 'relocation':
      return { levelShift: 'same', keepIndustry: true, widenGeography: true };
    default:
      return { levelShift: 'same', keepIndustry: true, widenGeography: false };
  }
}
