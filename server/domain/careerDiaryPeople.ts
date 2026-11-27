import { z } from 'zod';
import type { CareerDiaryAdaptationStageId } from '../../shared/careerDiaryCards';
import {
  MEETING_TOPIC_MAX,
  PEOPLE_CADENCES,
  PEOPLE_GROUP_MAX,
  PERSON_HEADCOUNT_MAX,
  PERSON_NAME_MAX,
  PERSON_ROLE_MAX,
  type CareerDiaryPeopleGroup,
  type CareerDiaryPeopleMap,
  type CareerDiaryPerson,
  type CareerDiaryPersonView,
} from '../../shared/careerDiaryPeople';
import type { PlanTask } from './careerDiaryAdaptationView';

const DAY_MS = 86_400_000;

export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  });

const personFields = z
  .object({
    name: z.string().trim().max(PERSON_NAME_MAX),
    role: z.string().trim().max(PERSON_ROLE_MAX),
    group: z.string().trim().min(1).max(PEOPLE_GROUP_MAX),
    cadence: z.enum(PEOPLE_CADENCES),
    headcount: z.number().int().min(1).max(PERSON_HEADCOUNT_MAX),
    lastMetOn: calendarDate.nullable(),
  })
  .strict();

/** Одного человека называют именем или ролью; строку «Ещё N человек» можно без них. */
const named = (person: { name: string; role: string; headcount: number }) =>
  person.headcount > 1 || person.name !== '' || person.role !== '';

export const personInputSchema = personFields.refine(named, { path: ['name'] });
export const personPatchSchema = personFields
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
export const meetingSchema = z
  .object({
    date: calendarDate,
    topic: z
      .string()
      .trim()
      .max(MEETING_TOPIC_MAX)
      .nullish()
      .transform((topic) => topic || null),
  })
  .strict();

export { named as personIsNamed };

/** Задача плана для встречи с человеком: одна на человека, перенос меняет её дату. */
export const meetingTaskId = (personId: string): string => `meeting-${personId}`;

export function stageForDate(startDate: string, date: string): CareerDiaryAdaptationStageId {
  const day = Math.round((Date.parse(date) - Date.parse(startDate)) / DAY_MS) + 1;
  if (day <= 0) return 'prep';
  if (day <= 30) return 'days_1_30';
  return day <= 60 ? 'days_31_60' : 'days_61_90';
}

/** Подпись задачи без имени: план читает консультант, имена коллег туда не уходят. */
function label(person: CareerDiaryPerson): string {
  return person.role || person.group;
}

/** План с задачей встречи на `date`: новая задача в конце или прежняя с новой датой. */
export function withMeetingTask(
  tasks: readonly PlanTask[],
  person: CareerDiaryPerson,
  date: string,
  startDate: string,
): PlanTask[] {
  const id = meetingTaskId(person.id);
  const meeting: PlanTask = {
    id,
    title: `Встреча: ${label(person)}`.slice(0, 200),
    description: '',
    stage: stageForDate(startDate, date),
    category: 'people',
    dueDate: date,
    completed: false,
    source: 'candidate',
  };
  return tasks.some((task) => task.id === id)
    ? tasks.map((task) => (task.id === id ? meeting : task))
    : [...tasks, meeting];
}

export const withoutTask = (tasks: readonly PlanTask[], id: string): PlanTask[] =>
  tasks.filter((task) => task.id !== id);

/** Человек с состоянием встречи: задача плана выполнена — встреча была в её день. */
function personView(person: CareerDiaryPerson, tasks: ReadonlyMap<string, PlanTask>): CareerDiaryPersonView {
  const task = person.meeting ? tasks.get(person.meeting.taskId) : undefined;
  if (!task) {
    return { ...person, meeting: null, status: person.lastMetOn ? 'met' : 'none' };
  }
  if (task.completed) {
    const lastMetOn = person.lastMetOn && person.lastMetOn > task.dueDate ? person.lastMetOn : task.dueDate;
    return { ...person, lastMetOn, meeting: { ...person.meeting, taskId: task.id, date: task.dueDate }, status: 'met' };
  }
  return { ...person, meeting: { ...person.meeting, taskId: task.id, date: task.dueDate }, status: 'scheduled' };
}

function groupsOf(people: readonly CareerDiaryPersonView[]): CareerDiaryPeopleGroup[] {
  const names = [...new Set(people.map((person) => person.group))];
  return names.map((name) => {
    const members = people.filter((person) => person.group === name);
    return { name, headcount: members.reduce((sum, p) => sum + p.headcount, 0), people: members };
  });
}

/** Карта людей одним ответом: группы в порядке добавления, счёт и ближайшая встреча. */
export function buildPeopleMap(
  workplaceId: string,
  people: readonly CareerDiaryPerson[],
  tasks: readonly PlanTask[],
): CareerDiaryPeopleMap {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const views = people.map((person) => personView(person, byId));
  const scheduled = views
    .filter((person) => person.status === 'scheduled' && person.meeting)
    .map((person) => ({
      personId: person.id,
      date: person.meeting!.date,
      topic: person.meeting!.topic ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    workplaceId,
    total: views.reduce((sum, person) => sum + person.headcount, 0),
    withoutMeeting: views
      .filter((person) => person.status === 'none')
      .reduce((sum, person) => sum + person.headcount, 0),
    nextMeeting: scheduled[0] ?? null,
    groups: groupsOf(views),
  };
}
