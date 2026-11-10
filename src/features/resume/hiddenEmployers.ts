import { isMaskedEmployer } from '../../../shared/employerMask';
import type { ResumeExperienceInput } from './resumeTypes';

type Place = Pick<ResumeExperienceInput, 'employer' | 'employerRealName' | 'employerMaskKept'>;

/** Атрибут формы вопроса: по нему «Проверка резюме» находит первый вопрос. */
export const EMPLOYER_QUESTION_ATTRIBUTE = 'data-employer-question';

/** B639/B640: под маской нет ни настоящего названия, ни ответа «это и есть название». */
export function asksEmployerName(place: Place): boolean {
  const employer = place.employer?.trim() ?? '';
  return (
    Boolean(employer) &&
    !place.employerRealName?.trim() &&
    !place.employerMaskKept &&
    isMaskedEmployer(employer)
  );
}

/** Первое место каждого работодателя со скрытым названием: вопрос задаётся один раз на компанию. */
export function hiddenEmployerPlaces<T extends Place>(experience: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return experience.filter((place) => {
    if (!asksEmployerName(place)) return false;
    const employer = place.employer!.trim();
    if (seen.has(employer)) return false;
    seen.add(employer);
    return true;
  });
}

/** Прокручивает к первому вопросу о названии и ставит фокус в поле; false, если вопроса на экране нет. */
export function focusEmployerQuestion(): boolean {
  const form = document.querySelector<HTMLElement>(`[${EMPLOYER_QUESTION_ATTRIBUTE}]`);
  if (!form) return false;
  form.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  form.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  return true;
}
