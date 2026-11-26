import {
  EMPTY_BUILDER_RESUME,
  RESUME_ABOUT_MAX,
  type BuilderEducation,
  type BuilderJob,
  type BuilderResume,
} from '../../../../shared/resumeBuilder/model';
import type { ResumeDraft, ResumeStudioView } from '../../resume/resumeTypes';
import { monthYear } from '../../site/resumeBuilder/resumeFromFile';
import { statementsOf } from './profileModel';

/** Пределы схемы файла резюме (`builderResumeSchema`): длинное обрезается, а не роняет сборку. */
const cut = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max);
const yearOf = (value?: string) => /(19|20)\d{2}/u.exec(value ?? '')?.[0] ?? '';

function jobsOf(draft: ResumeDraft, statements: ReadonlyMap<string, string>): BuilderJob[] {
  return draft.experience.slice(0, 15).map((entry) => ({
    company: cut(entry.employer, 160),
    city: cut(entry.location, 80),
    role: cut(entry.title, 160),
    start: monthYear(entry.startDate),
    end: entry.current ? '' : monthYear(entry.endDate),
    current: entry.current,
    bullets: entry.bulletMemoryIds
      .flatMap((id) => statements.get(id)?.trim() || [])
      .slice(0, 12)
      .map((text) => cut(text, 400)),
  }));
}

function educationOf(draft: ResumeDraft): BuilderEducation[] {
  return draft.education.slice(0, 6).map((item) => ({
    school: cut(item.institution, 200),
    degree: cut(item.qualification, 200),
    year: yearOf(item.endDate ?? item.startDate),
  }));
}

function languagesOf(draft: ResumeDraft): string {
  return (draft.languages ?? [])
    .flatMap(({ name, cefr }) => (name?.trim() ? `${name.trim()}${cefr ? ` (${cefr})` : ''}` : []))
    .join(', ');
}

/**
 * s01 «Резюме под роль»: профиль в поля файла резюме (тот же сборщик PDF, что у конструктора).
 * Заголовок — роль из условий поиска, иначе заголовок профиля.
 */
export function roleResumeFromProfile(view: ResumeStudioView, title: string): BuilderResume | null {
  const draft = view.draft;
  if (!draft) return null;
  const contact = draft.candidate.contact;
  const skills = (draft.skills ?? []).map((skill) => skill.name.trim()).filter(Boolean);
  return {
    ...EMPTY_BUILDER_RESUME,
    fullName: cut(draft.candidate.fullName, 120),
    title: cut(title, 160),
    city: cut(contact?.location, 80),
    phone: cut(contact?.phone, 40),
    email: cut(contact?.email, 120),
    results: [],
    jobs: jobsOf(draft, statementsOf(view)),
    education: educationOf(draft),
    skills: cut(skills.join(', '), 1_000),
    about: cut(draft.candidate.about, RESUME_ABOUT_MAX),
    languages: cut(languagesOf(draft), 500),
  };
}
