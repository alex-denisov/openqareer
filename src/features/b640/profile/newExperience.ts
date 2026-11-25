import type { ResumeDraft, ResumeExperienceInput } from '../../resume/resumeTypes';
import { applyForm, type ExperienceForm } from './experienceForm';

/** Адрес p07 без записи: место работы заводит сам кандидат. */
export const NEW_ENTRY_ID = 'new';

/** Пустое место работы. Ссылку `manual-` сервер при сохранении заменяет фактом кандидата. */
export function blankEntry(id: string): ResumeExperienceInput {
  return { id, chronologyMemoryId: `manual-${id}`, current: false, bulletMemoryIds: [] };
}

const EMPTY_DRAFT: ResumeDraft = {
  candidate: {},
  experience: [],
  skills: [],
  education: [],
  courses: [],
  tests: [],
  recommendations: [],
  languages: [],
};

/** Черновик с новым местом первым; повтор после сбоя второй записи не заводит. */
export function withNewEntry(
  draft: ResumeDraft | null,
  entry: ResumeExperienceInput,
  form: ExperienceForm,
): ResumeDraft {
  const base = draft ?? EMPTY_DRAFT;
  const known = base.experience.some((item) => item.id === entry.id);
  return applyForm(
    known ? base : { ...base, experience: [entry, ...base.experience] },
    entry.id,
    form,
  );
}
