import type {
  ResumeEditChoices,
  ResumeEditDecision,
  ResumeVacancyEdit,
} from '../../shared/resumeVacancyEdits';
import type { ResumeAssertion, ResumeExperience, TargetedResumeSlice } from './resumeStudioTypes';

interface Lift {
  readonly id: string;
  readonly bullet: ResumeAssertion;
  readonly why: string;
}

function normalized(value: string): string {
  return ` ${value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

function requirementOf(text: string, requirements: readonly string[]): string | null {
  const haystack = normalized(text);
  return (
    requirements.find((item) => normalized(item).trim() && haystack.includes(normalized(item))) ??
    null
  );
}

const editId = (place: ResumeExperience, bullet: ResumeAssertion) =>
  `${place.id}:${bullet.memoryId}`;

/** Пункты места, отвечающие требованиям и стоящие ниже не отвечающих: их и поднимает версия. */
function liftsOf(place: ResumeExperience, requirements: readonly string[]): Lift[] {
  const firstOther = place.bullets.findIndex((item) => !requirementOf(item.value, requirements));
  if (firstOther === -1) return [];
  return place.bullets.slice(firstOther + 1).flatMap((bullet) => {
    const why = requirementOf(bullet.value, requirements);
    return why ? [{ id: editId(place, bullet), bullet, why }] : [];
  });
}

const requirementsOf = (slice: TargetedResumeSlice) =>
  slice.requirements.map((item) => item.requirement);

/** Правки версии под вакансию в порядке резюме; решения кандидата уже учтены. */
export function resumeVacancyEdits(
  slice: TargetedResumeSlice,
  choices: ResumeEditChoices,
): ResumeVacancyEdit[] {
  return slice.document.experience.flatMap((place) =>
    liftsOf(place, requirementsOf(slice)).map(({ id, bullet, why }) => {
      const cancelled = choices.cancelled.includes(id);
      return {
        id,
        text: cancelled ? bullet.value : (choices.texts[id] ?? bullet.value),
        why,
        cancelled,
      };
    }),
  );
}

function tailoredPlace(
  place: ResumeExperience,
  requirements: readonly string[],
  choices: ResumeEditChoices,
): ResumeExperience {
  const active = new Set(
    liftsOf(place, requirements).flatMap(({ id }) => (choices.cancelled.includes(id) ? [] : [id])),
  );
  if (active.size === 0) return place;
  const firstOther = place.bullets.findIndex((item) => !requirementOf(item.value, requirements));
  const isLifted = (bullet: ResumeAssertion) => active.has(editId(place, bullet));
  const lifted = place.bullets.filter(isLifted).map((bullet) => ({
    ...bullet,
    value: choices.texts[editId(place, bullet)] ?? bullet.value,
  }));
  return {
    ...place,
    bullets: [
      ...place.bullets.slice(0, firstOther),
      ...lifted,
      ...place.bullets.slice(firstOther).filter((bullet) => !isLifted(bullet)),
    ],
  };
}

/** Версия под вакансию с правками: нужные пункты выше, отменённые остаются на месте. */
export function tailorResumeSlice(
  slice: TargetedResumeSlice,
  choices: ResumeEditChoices,
): TargetedResumeSlice {
  const requirements = requirementsOf(slice);
  return {
    ...slice,
    document: {
      ...slice.document,
      experience: slice.document.experience.map((place) =>
        tailoredPlace(place, requirements, choices),
      ),
    },
  };
}

/** Числа в изменённом тексте — только те, что есть в исходном пункте профиля. */
export function keepsSourceNumbers(text: string, source: string): boolean {
  const numbers = (value: string) => value.match(/\d+(?:[.,]\d+)*/gu) ?? [];
  const known = new Set(numbers(source));
  return numbers(text).every((item) => known.has(item));
}

/** Исходный текст пункта правки; `null` — такой правки в резюме нет. */
export function editSource(slice: TargetedResumeSlice, id: string): string | null {
  return (
    slice.document.experience
      .flatMap((place) => liftsOf(place, requirementsOf(slice)))
      .find((item) => item.id === id)?.bullet.value ?? null
  );
}

export function withDecision(
  choices: ResumeEditChoices,
  decision: ResumeEditDecision,
  source: string,
): ResumeEditChoices {
  const others = choices.cancelled.filter((id) => id !== decision.id);
  if (decision.action === 'cancel')
    return { ...choices, cancelled: [...others, decision.id].sort() };
  if (decision.action === 'restore') return { ...choices, cancelled: others };
  const rest = Object.fromEntries(
    Object.entries(choices.texts).filter(([id]) => id !== decision.id),
  );
  return {
    cancelled: others,
    texts: decision.text === source ? rest : { ...rest, [decision.id]: decision.text },
  };
}
