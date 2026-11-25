import type {
  CareerDiaryAdaptationDetails,
  CareerDiaryAdaptationStageId,
  CareerDiaryAdaptationStageView,
  CareerDiaryAdaptationStepId,
  CareerDiaryAdaptationStepView,
  CareerDiaryAdaptationTask,
  CareerDiaryProgress,
} from '../../../../shared/careerDiaryCards';
import type { CareerDiaryDay30Check } from '../../../../shared/careerDiaryCheckpoints';
import type { CareerDiaryPeopleMap } from '../../../../shared/careerDiaryPeople';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;
const DAY_MS = 86_400_000;

/** «1 человек», «2 человека», «18 человек». */
export function peopleCount(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  const word = ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'человека' : 'человек';
  return `${count} ${word}`;
}

/** «1 декабря» из `ГГГГ-ММ-ДД`. */
export function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** «14–30 ноября» или «28 ноября – 13 декабря». */
export function rangeLabel(from: string, to: string): string {
  const fromDay = Number(from.slice(8, 10));
  if (from.slice(0, 7) === to.slice(0, 7)) return `${fromDay}–${dayLabel(to)}`;
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** Дни шагов от дня выхода: до выхода — 17 дней перед ним, первые две недели — дни 1–13. */
export const STEP_SPAN: Readonly<Partial<Record<CareerDiaryAdaptationStepId, readonly [number, number]>>> = {
  before_start: [-17, -1],
  first_two_weeks: [0, 12],
};

export const STEP_TITLE: Readonly<Record<CareerDiaryAdaptationStepId, string>> = {
  before_start: 'До выхода',
  first_two_weeks: 'Первые две недели',
  first_meeting: 'Первая встреча с руководителем',
  people_map: 'Карта людей',
  day_30_check: 'Проверка на 30-й день',
  settling: 'Обустройство',
};

export const STEP_HEADING: Readonly<Partial<Record<CareerDiaryAdaptationStepId, string>>> = {
  before_start: 'До выхода: что уточнить и с чем прийти',
  first_two_weeks: 'Первые две недели: доступы, команда, встречи',
  settling: 'Обустройство: документы и банк',
};

const STEP_ABOUT: Readonly<Partial<Record<CareerDiaryAdaptationStepId, string>>> = {
  before_start: 'вопросы HR и руководителю, план первой недели',
  first_two_weeks: 'доступы, знакомство, встречи один на один',
  first_meeting: 'ожидания и критерии 90 дней',
  settling: 'документы и банк',
};

const STAGE_DAY: Readonly<Record<CareerDiaryAdaptationStageId, string>> = {
  prep: 'До выхода',
  days_1_30: 'К 30-му дню',
  days_31_60: 'К 60-му дню',
  days_61_90: 'К 90-му дню',
};

export const PROGRESS_TAG: Readonly<Record<CareerDiaryProgress, readonly [string, string]>> = {
  done: ['ok', 'готово'],
  active: ['part', 'в работе'],
  ahead: ['miss', 'впереди'],
};
export const STEP_TAG: Readonly<Record<CareerDiaryProgress, readonly [string, string]>> = {
  done: ['ok', 'пройдено'],
  active: ['part', 'идёт'],
  ahead: ['miss', 'впереди'],
};

/** Метка шага; сигнал проверки на 30-й день виден и в списке шагов. */
export function stepTag(
  step: CareerDiaryAdaptationStepView,
  check: CareerDiaryDay30Check | null,
): readonly [string, string] {
  if (step.id === 'day_30_check' && step.status !== 'ahead' && check?.signal) {
    return ['part', 'есть сигнал'];
  }
  return STEP_TAG[step.status];
}

export function stageTitle(stage: CareerDiaryAdaptationStageView): string {
  return stage.title ? `${STAGE_DAY[stage.stage]}: ${stage.title}` : STAGE_DAY[stage.stage];
}

export function stageSub(stage: CareerDiaryAdaptationStageView): string {
  return `Задачи · ${stage.tasksDone} из ${stage.tasksTotal}`;
}

/** Заголовок экрана d01: день на новом месте и цель текущего этапа. */
export function dayHeading(dayNumber: number, stages: readonly CareerDiaryAdaptationStageView[]): string {
  if (dayNumber <= 0) return dayNumber === 0 ? 'Выход завтра' : `До выхода ${-dayNumber} дн.`;
  const day = Math.min(dayNumber, 90);
  const current = stages.find((stage) => stage.status === 'active' && stage.stage !== 'prep');
  return current?.title ? `День ${day} из 90: цель — ${current.title}` : `День ${day} из 90`;
}

export function probationLine(details: Pick<CareerDiaryAdaptationDetails, 'probation'>): string | null {
  const { endsOn, reviewer } = details.probation;
  if (!endsOn) return null;
  const who = reviewer ? `; оценивает ${reviewer}` : '';
  return `Решение по испытательному сроку — ${dayLabel(endsOn)}${who}.`;
}

/** Строка под шагом в списке «Адаптация по шагам». */
export function stepSub(
  step: CareerDiaryAdaptationStepView,
  details: Pick<CareerDiaryAdaptationDetails, 'firstMeeting' | 'relocated'>,
  people: CareerDiaryPeopleMap | null,
  check: CareerDiaryDay30Check | null = null,
): string {
  if (step.id === 'day_30_check' && check) {
    const signal = step.status !== 'ahead' && check.signal ? ' · 1 сигнал' : '';
    return `${dayLabel(check.dueOn)}${signal}`;
  }
  if (step.id === 'people_map') {
    if (!people || people.total === 0) return 'с кем и как часто встречаться';
    return `${peopleCount(people.total)} · ${people.withoutMeeting} без встречи`;
  }
  if (step.id === 'first_meeting' && details.firstMeeting?.heldOn) {
    return `${dayLabel(details.firstMeeting.heldOn)} · ${STEP_ABOUT.first_meeting}`;
  }
  if (step.id === 'settling' && details.relocated !== null) {
    return `${details.relocated ? 'был переезд' : 'переезда не было'} · ${STEP_ABOUT.settling}`;
  }
  return STEP_ABOUT[step.id] ?? '';
}

/** Строка задачи: срок и отметка о выполнении. */
export function taskWhen(task: CareerDiaryAdaptationTask): string {
  return task.completed ? ` · до ${dayLabel(task.dueDate)} · готово` : ` · до ${dayLabel(task.dueDate)}`;
}

/** Этап плана по дате задачи, как у сервера. */
export function stageForDate(startDate: string, date: string): CareerDiaryAdaptationStageId {
  const day = Math.round((Date.parse(date) - Date.parse(startDate)) / DAY_MS) + 1;
  if (day <= 0) return 'prep';
  if (day <= 30) return 'days_1_30';
  return day <= 60 ? 'days_31_60' : 'days_61_90';
}
