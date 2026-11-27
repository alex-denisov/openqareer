import {
  evaluateCareerGoalRisk,
  type CareerDiaryGoal,
  type CareerDiaryGoalRiskStatus,
  type CareerDiaryMeasurement,
} from '../../shared/careerDiary';
import type {
  CareerDiaryDay30Check,
  CareerDiaryDay30Fact,
  CareerDiaryResultItem,
  CareerDiaryResults90,
} from '../../shared/careerDiaryCheckpoints';
import type { CareerDiaryPeopleMap } from '../../shared/careerDiaryPeople';
import { withoutEmployerFigures } from '../../shared/employerFigures';

export { withoutEmployerFigures };

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

/** После «из»: «из 3 человек», «из 21 человека». */
function ofPeople(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'человека' : 'человек'}`;
}

const lowerFirst = (text: string): string => text.charAt(0).toLocaleLowerCase('ru-RU') + text.slice(1);
const latestOf = (track: GoalTrack) => track.measurements.at(-1) ?? null;
const startOf = (track: GoalTrack) => track.goal.baselineValue ?? track.measurements[0]?.value ?? null;

/**
 * Статус цели — тот же, что у карточки в d02 и d02a (B662): одна функция риска на все экраны.
 * «Итоги» и свод первого месяца раньше считали своё и расходились с карточкой.
 */
function riskOf(track: GoalTrack, asOf: string): CareerDiaryGoalRiskStatus {
  return evaluateCareerGoalRisk(track.goal, latestOf(track), asOf).status;
}

/** Цели, которые считаются: у цели с показателями — её показатели, сама она только заголовок. */
function measurable(goals: readonly GoalTrack[]): GoalTrack[] {
  const live = goals.filter((track) => !track.archived);
  const parents = new Set(live.map((track) => track.goal.parentGoalId).filter(Boolean));
  return live.filter((track) => !parents.has(track.goal.id));
}

function mainGoal(goals: readonly GoalTrack[]): GoalTrack | null {
  const primary = new Set(goals.filter((track) => track.goal.isPrimary).map((track) => track.goal.id));
  const live = measurable(goals).filter((track) => track.measurements.length > 0);
  const isMain = (track: GoalTrack) => primary.has(track.goal.id) || primary.has(track.goal.parentGoalId ?? '');
  return live.find(isMain) ?? live[0] ?? null;
}

/** Встречи были: назначенная в плане ещё не встреча. */
function metCount(people: CareerDiaryPeopleMap): number {
  return people.groups
    .flatMap((group) => group.people)
    .filter((person) => person.status === 'met')
    .reduce((sum, person) => sum + person.headcount, 0);
}

function facts(input: Day30Input, main: GoalTrack | null): CareerDiaryDay30Fact[] {
  const list: CareerDiaryDay30Fact[] = [];
  if (input.people && input.people.total > 0) {
    const met = metCount(input.people);
    list.push({ area: 'team', label: 'Команда', value: `Встречи с ${met} из ${ofPeople(input.people.total)}` });
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
  if (main && riskOf(main, input.asOf) === 'at_risk') return { area: 'result', text: `${main.goal.title} отстаёт от плана` };
  if (input.people && input.people.withoutMeeting > 0) {
    return { area: 'team', text: `Без встречи — ${peopleCount(input.people.withoutMeeting)}` };
  }
  const open = input.tasks.filter((task) => task.stage === 'days_1_30' && !task.completed).length;
  return open > 0 && input.asOf > dueOn ? { area: 'plan', text: `Не закрыто задач первого месяца — ${open}` } : null;
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

function itemOf(track: GoalTrack, asOf: string): CareerDiaryResultItem {
  const latest = latestOf(track);
  const { goal } = track;
  if (!latest) return { goalId: goal.id, title: goal.title, line: 'замеров нет', status: 'open' };
  const unit = goal.unit ? ` ${goal.unit}` : '';
  const line = `с ${String(startOf(track))} до ${String(latest.value)}${unit}`;
  const risk = riskOf(track, asOf);
  if (risk === 'achieved') return { goalId: goal.id, title: goal.title, line, status: 'done' };
  const status = risk === 'at_risk' ? 'behind' : 'open';
  return { goalId: goal.id, title: goal.title, line: `${line}, цель — ${String(goal.targetValue)}`, status };
}

/** Итоги 90 дней из целей и замеров и два текста без цифр работодателя. */
export function buildResults90(input: PlaceInput): CareerDiaryResults90 {
  const periodTo = addDays(input.workplace.startDate, 89);
  const items = measurable(input.goals)
    .filter((track) => track.goal.startDate <= periodTo)
    .map((track) => itemOf(track, input.asOf));
  const done = items.filter((item) => item.status === 'done');
  // «в работе» — все недостигнутые, и отстающие, и идущие по плану.
  const behind = items.length - done.length;
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
