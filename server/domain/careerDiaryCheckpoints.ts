import { evaluateCareerGoalRisk, type CareerDiaryGoal, type CareerDiaryMeasurement } from '../../shared/careerDiary';
import type {
  CareerDiaryDay30Check,
  CareerDiaryDay30Fact,
  CareerDiaryResultItem,
  CareerDiaryResults90,
} from '../../shared/careerDiaryCheckpoints';
import type { CareerDiaryPeopleMap } from '../../shared/careerDiaryPeople';

const DAY_MS = 86_400_000;

/** Цель с замерами по возрастанию даты; `archived` — снята кандидатом. */
export interface GoalTrack {
  readonly goal: CareerDiaryGoal;
  readonly measurements: readonly CareerDiaryMeasurement[];
  readonly archived: boolean;
}

interface PlaceInput {
  readonly workplace: { readonly id: string; readonly startDate: string; readonly title: string };
  readonly goals: readonly GoalTrack[];
  readonly asOf: string;
}

export interface Day30Input extends PlaceInput {
  readonly people: CareerDiaryPeopleMap | null;
  readonly tasks: ReadonlyArray<{ readonly stage: string; readonly completed: boolean }>;
  readonly sentOn: string | null;
}

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function peopleCount(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  return `${count} ${ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'человека' : 'человек'}`;
}

const lowerFirst = (text: string): string => text.charAt(0).toLocaleLowerCase('ru-RU') + text.slice(1);
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const latestOf = (track: GoalTrack) => track.measurements.at(-1) ?? null;
const startOf = (track: GoalTrack) => track.goal.baselineValue ?? track.measurements[0]?.value ?? null;

/** Достигнута ли цель: числа — с учётом направления, остальное — по правилу дневника. */
function achieved(track: GoalTrack, asOf: string): boolean {
  const latest = latestOf(track);
  if (!latest) return false;
  const { targetValue, baselineValue } = track.goal;
  if (numeric(latest.value) && numeric(targetValue) && numeric(baselineValue)) {
    return targetValue < baselineValue ? latest.value <= targetValue : latest.value >= targetValue;
  }
  return evaluateCareerGoalRisk(track.goal, latest, asOf).status === 'achieved';
}

/** Отстаёт ли числовая цель от ровного пути от базы к цели на сегодня. */
function behindPace(track: GoalTrack, asOf: string): boolean {
  const latest = latestOf(track);
  const { targetValue, baselineValue, startDate, dueDate } = track.goal;
  if (!latest || achieved(track, asOf) || !numeric(latest.value) || !numeric(targetValue) || !numeric(baselineValue)) return false;
  const span = Math.max(1, Date.parse(dueDate) - Date.parse(startDate));
  const share = Math.min(1, Math.max(0, (Date.parse(asOf) - Date.parse(startDate)) / span));
  const expected = baselineValue + (targetValue - baselineValue) * share;
  return targetValue < baselineValue ? latest.value > expected : latest.value < expected;
}

function mainGoal(goals: readonly GoalTrack[]): GoalTrack | null {
  const live = goals.filter((track) => !track.archived && track.measurements.length > 0);
  return live.find((track) => track.goal.isPrimary) ?? live[0] ?? null;
}

function facts(input: Day30Input, main: GoalTrack | null): CareerDiaryDay30Fact[] {
  const list: CareerDiaryDay30Fact[] = [];
  if (input.people && input.people.total > 0) {
    const met = input.people.total - input.people.withoutMeeting;
    list.push({ area: 'team', label: 'Команда', value: `Встречи с ${met} из ${peopleCount(input.people.total)}` });
  }
  if (main) {
    const unit = main.goal.unit ? ` ${main.goal.unit}` : '';
    list.push({ area: 'result', label: 'Результат', value: `${main.goal.title}: ${String(startOf(main))} → ${String(latestOf(main)!.value)}${unit}` });
  }
  const month = input.tasks.filter((task) => task.stage === 'days_1_30');
  if (month.length > 0) {
    const done = month.filter((task) => task.completed).length;
    list.push({ area: 'plan', label: 'План', value: `Задачи первого месяца: ${done} из ${month.length}` });
  }
  return list;
}

function signalOf(input: Day30Input, main: GoalTrack | null, dueOn: string): CareerDiaryDay30Check['signal'] {
  if (main && behindPace(main, input.asOf)) return { area: 'result', text: `${main.goal.title} отстаёт от плана` };
  if (input.people && input.people.withoutMeeting > 0) {
    return { area: 'team', text: `Без встречи — ${peopleCount(input.people.withoutMeeting)}` };
  }
  const open = input.tasks.filter((task) => task.stage === 'days_1_30' && !task.completed).length;
  return open > 0 && input.asOf > dueOn ? { area: 'plan', text: `Не закрыто задач первого месяца: ${open}` } : null;
}

/** Свод первого месяца: команда, результат, план, один сигнал и черновик письма руководителю. */
export function buildDay30Check(input: Day30Input): CareerDiaryDay30Check {
  const dueOn = addDays(input.workplace.startDate, 29);
  const main = mainGoal(input.goals);
  const list = facts(input, main);
  const signal = signalOf(input, main, dueOn);
  const summary = list.length > 0 ? `Подвожу итоги первого месяца: ${list.map((fact) => lowerFirst(fact.value)).join('; ')}. ` : '';
  const ask = signal ? `Нужен ваш совет: ${lowerFirst(signal.text)}. ` : '';
  return {
    workplaceId: input.workplace.id,
    dueOn,
    facts: list,
    signal,
    letter: `30 минут на этой неделе? ${summary}${ask}Как вы оцениваете мой старт?`,
    sentOn: input.sentOn,
  };
}

/**
 * Убирает из текста цифры работодателя: деньги, проценты, крупные суммы и предлог перед ними.
 * Счёт людей и штук остаётся — это не внутренние показатели.
 */
export function withoutEmployerFigures(text: string): string {
  const unit = String.raw`(?:%|процент\p{L}*|percent|млн\.?|млрд\.?|миллион\p{L}*|миллиард\p{L}*|тыс\p{L}*\.?|k|m|bn|₽|руб\p{L}*\.?|usd|eur|евро|долл\p{L}*\.?|\$|€)(?![\p{L}\d])`;
  const money = String.raw`(?:₽|руб\p{L}*\.?|usd|eur|евро|долл\p{L}*\.?|\$|€)`;
  const figure = new RegExp(
    String.raw`(?:(?<=^|\s)(?:до|на|с|в|по|от)\s+)?[-+$€]?\d[\d\s.,]*\s*${unit}(?:\s*${money}(?![\p{L}\d]))?`,
    'giu',
  );
  return text.replace(figure, '').replace(/\s+,/gu, ',').replace(/\s{2,}/gu, ' ').replace(/[\s,]+$/u, '').trim();
}

function itemOf(track: GoalTrack, asOf: string): CareerDiaryResultItem {
  const latest = latestOf(track);
  const { goal } = track;
  if (!latest) return { goalId: goal.id, title: goal.title, line: 'замеров нет', status: 'open' };
  const unit = goal.unit ? ` ${goal.unit}` : '';
  const line = `с ${String(startOf(track))} до ${String(latest.value)}${unit}`;
  return achieved(track, asOf)
    ? { goalId: goal.id, title: goal.title, line, status: 'done' }
    : { goalId: goal.id, title: goal.title, line: `${line}, цель — ${String(goal.targetValue)}`, status: 'behind' };
}

/** Итоги 90 дней из целей и замеров и два текста без цифр работодателя. */
export function buildResults90(input: PlaceInput): CareerDiaryResults90 {
  const periodTo = addDays(input.workplace.startDate, 89);
  const items = input.goals
    .filter((track) => !track.archived && track.goal.startDate <= periodTo)
    .map((track) => itemOf(track, input.asOf));
  const done = items.filter((item) => item.status === 'done');
  const behind = items.filter((item) => item.status === 'behind').length;
  const titles = done.map((item) => lowerFirst(withoutEmployerFigures(item.title))).filter(Boolean);
  const progress = `${done.length} из ${items.length} целей достигнуто${behind > 0 ? `, ${behind} в работе` : ''}`;
  return {
    workplaceId: input.workplace.id,
    periodFrom: input.workplace.startDate,
    periodTo,
    items,
    resumeText: titles.length > 0 ? `${input.workplace.title}: за первые 90 дней — ${titles.join(', ')}.` : null,
    talkText: items.length > 0
      ? `За 90 дней ${progress}. Прошу зафиксировать критерии итоговой оценки и обсудить ожидания на следующий квартал.`
      : null,
  };
}
